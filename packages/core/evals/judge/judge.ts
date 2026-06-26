/**
 * LLM-as-judge (Q2c — eval-judge).
 *
 * Grades a non-deterministic qulib artifact (a generated test spec, or a maturity
 * narrative) against a PINNED rubric and returns a `JudgeVerdict` (evals/types.ts).
 *
 * Contract (root CLAUDE.md doctrine #11):
 *   - Judge model AND rubric version are pinned + recorded on every verdict.
 *   - Judge cost (token usage) is recorded from the provider usage block.
 *   - A model NEVER grades its own turn: the judge is a fresh provider call that
 *     receives the candidate strictly as data, and `runJudge` refuses when the
 *     subject was produced by the same model as the judge.
 *   - No `ANTHROPIC_API_KEY` ⇒ verdict outcome is SKIP (acknowledged missing
 *     dependency, doctrine #6) — never a silent FAIL.
 *
 * Provider reuse: defaults to `createProvider()` from src/llm/provider-registry.ts
 * (the same Anthropic client the rest of qulib uses), but accepts an injected
 * `JudgeLlm` so unit tests can run fully offline with a stub.
 */

import { createProvider } from '../../src/llm/provider-registry.js';
import type { JudgeVerdict, JudgeDimensionScore } from '../types.js';
import type { Rubric } from './rubrics.js';
import { getRubric, scoreToOutcome, validateRubric } from './rubrics.js';
import { buildJudgePrompt, parseJudgeResponse, type JudgeSubject } from './prompt.js';
import type { ScaffoldSpecSubject, MaturityNarrativeSubject, ConfidenceNarrativeSubject, JudgmentDecisionSubject } from './subjects.js';
import { buildScaffoldSubject, buildMaturitySubject, buildConfidenceSubject, buildJudgmentSubject } from './subjects.js';

/**
 * Default pinned judge model. Judging is a reasoning task (grounding/no-hallucination
 * checks), so we pin a synthesize-tier model rather than the cheap router-tier Haiku
 * that the qulib generation path defaults to — and we pin it explicitly so a verdict
 * is reproducible. Overridable via QULIB_JUDGE_MODEL or `RunJudgeOptions.judgeModel`.
 * The ACTUAL model id returned by the provider usage block is recorded on the verdict.
 */
export const DEFAULT_JUDGE_MODEL = 'claude-sonnet-4-5-20250929';

/** Output-token budget for a judge reply. Verdicts are small JSON — this is ample. */
const JUDGE_MAX_OUTPUT_TOKENS = 1024;

/** Minimal seam over an LLM call so tests can inject a deterministic stub. */
export interface JudgeLlm {
  readonly model: string;
  call(
    prompt: string,
    maxOutputTokens: number
  ): Promise<{
    text: string;
    usage: { model: string; inputTokens: number; outputTokens: number; dataQuality: 'actual' | 'estimated' };
  }>;
}

export interface RunJudgeOptions {
  /** Pinned judge model id. Defaults to QULIB_JUDGE_MODEL or DEFAULT_JUDGE_MODEL. */
  judgeModel?: string;
  /** Inject a provider (tests). Defaults to createProvider() bound to the judge model. */
  llm?: JudgeLlm;
  /**
   * Treat the judge as unavailable (force SKIP) without consulting the environment.
   * Defaults to `!process.env.ANTHROPIC_API_KEY`.
   */
  skip?: boolean;
}

/** A SKIP verdict (judge unavailable). Score 0; recorded with the pinned identifiers. */
function skipVerdict(rubric: Rubric, judgeModel: string, reason: string): JudgeVerdict {
  return {
    outcome: 'SKIP',
    score: 0,
    dimensions: [{ dimension: 'judge', score: 0, rationale: reason }],
    judgeModel,
    rubricVersion: rubric.version,
  };
}

/**
 * Aggregate parsed dimension scores against a rubric into a weighted 0..1 score +
 * the per-dimension `JudgeDimensionScore[]` for the verdict. Missing dimensions
 * (the judge omitted one) are scored 0 with an explanatory rationale so an omission
 * is penalized, not silently dropped. Pure + deterministic.
 */
export function aggregate(
  rubric: Rubric,
  parsed: ReadonlyArray<{ key: string; score: number; rationale: string }>
): { score: number; dimensions: JudgeDimensionScore[] } {
  const byKey = new Map(parsed.map((p) => [p.key, p]));
  const dimensions: JudgeDimensionScore[] = [];
  let weighted = 0;
  for (const dim of rubric.dimensions) {
    const got = byKey.get(dim.key);
    const score = got ? got.score : 0;
    const rationale = got ? got.rationale : 'judge omitted this dimension — scored 0';
    dimensions.push({ dimension: dim.key, score, rationale });
    weighted += score * dim.weight;
  }
  // Weights sum to 1 (validated), so `weighted` is already in [0,1]; round for stability.
  const score = Math.round(weighted * 1000) / 1000;
  return { score, dimensions };
}

/**
 * Grade one subject against a rubric and return a `JudgeVerdict`.
 *
 * SKIP path: when no key is configured (or `options.skip`), returns a SKIP verdict
 * immediately — no network call.
 *
 * Self-grade guard: if `subject.subjectModel` equals the judge model, throws — a
 * model must never judge its own turn (doctrine #11). The runner is expected to
 * pick a judge model distinct from the generation model.
 */
export async function runJudge(
  rubric: Rubric,
  subject: JudgeSubject,
  options: RunJudgeOptions = {}
): Promise<JudgeVerdict> {
  const rubricError = validateRubric(rubric);
  if (rubricError) throw new Error(`invalid rubric: ${rubricError}`);

  const judgeModel = options.judgeModel ?? process.env.QULIB_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;

  // Never let a model grade its own turn.
  if (subject.subjectModel && subject.subjectModel === judgeModel) {
    throw new Error(
      `refusing to judge: subject was produced by the judge model "${judgeModel}" (a model must not grade its own turn). Pick a distinct judge model.`
    );
  }

  const skip = options.skip ?? !process.env.ANTHROPIC_API_KEY;
  if (skip) {
    return skipVerdict(rubric, judgeModel, 'ANTHROPIC_API_KEY not set — judge skipped (deterministic asserts still run).');
  }

  const llm: JudgeLlm = options.llm ?? createProvider({ llmModel: judgeModel });
  const prompt = buildJudgePrompt(rubric, subject);

  let text: string;
  let usage: JudgeLlm extends never ? never : Awaited<ReturnType<JudgeLlm['call']>>['usage'];
  try {
    const res = await llm.call(prompt, JUDGE_MAX_OUTPUT_TOKENS);
    text = res.text;
    usage = res.usage;
  } catch (err) {
    // A judge transport failure is a FAIL of the eval run, recorded honestly.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      outcome: 'FAIL',
      score: 0,
      dimensions: [{ dimension: 'judge', score: 0, rationale: `judge call failed: ${msg}` }],
      judgeModel,
      rubricVersion: rubric.version,
    };
  }

  let parsed;
  try {
    parsed = parseJudgeResponse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      outcome: 'FAIL',
      score: 0,
      dimensions: [{ dimension: 'judge', score: 0, rationale: `unparseable judge response: ${msg}` }],
      judgeModel: usage.model || judgeModel,
      rubricVersion: rubric.version,
      cost: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, dataQuality: usage.dataQuality },
    };
  }

  const { score, dimensions } = aggregate(rubric, parsed.dimensions);
  const outcome = scoreToOutcome(
    rubric,
    score,
    dimensions.map((d) => ({ key: d.dimension, score: d.score }))
  );

  return {
    outcome,
    score,
    dimensions,
    // Record the model the provider actually reported (falls back to the pinned id).
    judgeModel: usage.model || judgeModel,
    rubricVersion: rubric.version,
    cost: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, dataQuality: usage.dataQuality },
  };
}

/** Grade a generated scaffold spec. Builds scaffold grounding (routes + scenario) then judges. */
export function judgeScaffoldSpec(
  subject: ScaffoldSpecSubject,
  options: RunJudgeOptions = {}
): Promise<JudgeVerdict> {
  return runJudge(getRubric('scaffold'), buildScaffoldSubject(subject), options);
}

/** Grade a maturity narrative. Builds maturity grounding (computed numbers + evidence) then judges. */
export function judgeMaturityNarrative(
  subject: MaturityNarrativeSubject,
  options: RunJudgeOptions = {}
): Promise<JudgeVerdict> {
  return runJudge(getRubric('score-automation'), buildMaturitySubject(subject), options);
}

/** Grade a release-confidence narrative. Builds grounding from the computed result then judges. */
export function judgeConfidenceNarrative(
  subject: ConfidenceNarrativeSubject,
  options: RunJudgeOptions = {}
): Promise<JudgeVerdict> {
  return runJudge(getRubric('confidence'), buildConfidenceSubject(subject), options);
}

/** Grade an agent pivotal-decision rationale against judgment-v1. */
export function judgeJudgmentDecision(
  subject: JudgmentDecisionSubject,
  options: RunJudgeOptions = {}
): Promise<JudgeVerdict> {
  return runJudge(getRubric('judgment'), buildJudgmentSubject(subject), options);
}
