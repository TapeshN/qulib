/**
 * `score-automation` suite executor for the eval runner (Q2d).
 *
 * `computeAutomationMaturity(repo: RepoAnalysis)` is fully DETERMINISTIC — no
 * network, no LLM. So this suite is graded entirely by deterministic asserts; the
 * judge is invoked only to grade the *narrative* (topRecommendations / guidance
 * prose) when a judge + API key are available, and never gates the case on its own.
 *
 * Golden case shape (validated here, suite-specific):
 *   input.repo      : a RepoAnalysis (the exact arg computeAutomationMaturity takes).
 *                     Mirrors what the `qulib score-automation --repo <path>` CLI
 *                     produces from a real repo, but pinned as data so the eval is
 *                     reproducible and offline.
 *   expected.level            : the 1..5 maturity level the scorer must return.
 *   expected.overallScore     : { min, max } band the overall score must land in
 *                               (a band, not an exact value, so weight tweaks don't
 *                               make a still-correct score regress falsely).
 *   expected.applicability    : optional map dimension -> applicability the scorer
 *                               must report (the honesty contract: not_applicable /
 *                               unknown must NOT read as a real 0).
 *   expected.minTopRecs       : optional minimum count of topRecommendations.
 */
import { z } from 'zod';
import type { EvalCase, EvalCaseResult, EvalOutcome } from '../types.js';
import { RepoAnalysisSchema } from '../../src/schemas/repo-analysis.schema.js';
import { computeAutomationMaturity } from '../../src/tools/scoring/automation-maturity.js';
import { AutomationMaturitySchema } from '../../src/schemas/automation-maturity.schema.js';
import type { AutomationMaturity } from '../../src/schemas/automation-maturity.schema.js';
import { combineCaseOutcome } from './rollup.js';
import { judgeOrSkip, type JudgeImpl } from './judge-bridge.js';

const ApplicabilitySchema = z.enum(['applicable', 'not_applicable', 'unknown']);

const ExpectedSchema = z.object({
  level: z.number().int().min(1).max(5),
  overallScore: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }),
  applicability: z.record(ApplicabilitySchema).optional(),
  minTopRecs: z.number().int().min(0).optional(),
});

const InputSchema = z.object({ repo: RepoAnalysisSchema });

/**
 * Run one score-automation golden case end-to-end. Never throws — asserts capture
 * failure. `judge` is injectable so the judge-active path is testable offline
 * (defaults to Q2c's real judge, which SKIPs without an ANTHROPIC_API_KEY).
 */
export async function runScoreAutomationCase(c: EvalCase, judge?: JudgeImpl): Promise<EvalCaseResult> {
  const start = Date.now();
  const notes: string[] = [];
  let outcome: EvalOutcome = 'PASS';

  const fail = (msg: string): void => {
    notes.push(`FAIL: ${msg}`);
    outcome = 'FAIL';
  };

  const input = InputSchema.safeParse(c.input);
  const expected = ExpectedSchema.safeParse(c.expected);
  if (!input.success) {
    fail(`malformed input.repo (not a RepoAnalysis): ${input.error.message}`);
    return finalize(c, outcome, notes, start);
  }
  if (!expected.success) {
    fail(`malformed expected block: ${expected.error.message}`);
    return finalize(c, outcome, notes, start);
  }

  const maturity = computeAutomationMaturity(input.data.repo);

  // 1) Output must satisfy the schema (shape gate — a wrong shape is a hard FAIL).
  const shape = AutomationMaturitySchema.safeParse(maturity);
  if (!shape.success) {
    fail(`AutomationMaturity output fails its own schema: ${shape.error.message}`);
  } else {
    notes.push('shape: AutomationMaturity schema OK');
  }

  // 2) Level must match exactly.
  if (maturity.level !== expected.data.level) {
    fail(`level expected ${expected.data.level}, got ${maturity.level} (${maturity.label})`);
  } else {
    notes.push(`level: ${maturity.level} (${maturity.label}) OK`);
  }

  // 3) Overall score must land inside the expected band.
  const { min, max } = expected.data.overallScore;
  if (maturity.overallScore < min || maturity.overallScore > max) {
    fail(`overallScore ${maturity.overallScore} outside expected band [${min}, ${max}]`);
  } else {
    notes.push(`overallScore: ${maturity.overallScore} ∈ [${min}, ${max}] OK`);
  }

  // 4) Applicability honesty: each asserted dimension must report the expected
  //    applicability so not_applicable / unknown never silently read as a real 0.
  if (expected.data.applicability) {
    for (const [dim, want] of Object.entries(expected.data.applicability)) {
      const found = maturity.dimensions.find((d) => d.dimension === dim);
      if (!found) {
        fail(`expected dimension "${dim}" missing from output`);
        continue;
      }
      // The scorer omits `applicability` on always-applicable dimensions (breadth,
      // framework, CI) and only populates it on the conditional ones (hygiene, auth,
      // component-ratio). Normalize a missing value to 'applicable' to match the
      // scorer's own `?? 'applicable'` semantics — see computeAutomationMaturity.
      const got = found.applicability ?? 'applicable';
      if (got !== want) {
        fail(`dimension "${dim}" applicability expected "${want}", got "${got}"`);
      } else {
        notes.push(`applicability[${dim}]: ${want} OK`);
        // Honesty corollary: a not_applicable / unknown dimension must carry guidance,
        // not pretend to be a scored 0.
        if (want !== 'applicable' && !(typeof found.guidance === 'string' && found.guidance.length > 0)) {
          fail(`dimension "${dim}" is ${want} but carries no guidance (would read as a false 0)`);
        }
      }
    }
  }

  // 5) Top recommendations present when expected.
  if (expected.data.minTopRecs !== undefined) {
    if (maturity.topRecommendations.length < expected.data.minTopRecs) {
      fail(`expected >= ${expected.data.minTopRecs} topRecommendations, got ${maturity.topRecommendations.length}`);
    } else {
      notes.push(`topRecommendations: ${maturity.topRecommendations.length} >= ${expected.data.minTopRecs} OK`);
    }
  }

  // Judge (optional): grade the human-facing narrative for faithfulness to the
  // computed numbers (no invented scores, N/A dims not reported as failures). SKIP
  // unless a judge + key are present. The judge can only downgrade a PASS — it never
  // rescues a deterministic FAIL. We synthesize the narrative the CLI would print so
  // the judge grades the same prose a human/agent would read.
  const narrative = buildMaturityNarrative(maturity);
  const verdict = await judgeOrSkip({ suite: 'score-automation', narrative, maturity }, judge);

  const caseOutcome = combineCaseOutcome(outcome, verdict.outcome);
  return {
    caseId: c.id,
    suite: 'score-automation',
    outcome: caseOutcome,
    deterministic: { outcome, notes },
    judge: verdict,
    latencyMs: Date.now() - start,
  };
}

function finalize(
  c: EvalCase,
  outcome: EvalOutcome,
  notes: string[],
  start: number
): EvalCaseResult {
  return {
    caseId: c.id,
    suite: 'score-automation',
    outcome,
    deterministic: { outcome, notes },
    latencyMs: Date.now() - start,
  };
}

/**
 * Synthesize the human-facing maturity narrative the `qulib score-automation` CLI
 * would print — the prose the judge grades for faithfulness to the computed numbers.
 * Kept faithful: it states the computed score/level and surfaces each dimension's
 * applicability honestly (N/A and unknown are labeled, never shown as a scored 0).
 */
function buildMaturityNarrative(maturity: AutomationMaturity): string {
  const lines: string[] = [];
  lines.push(`Automation maturity: ${maturity.label} (overall ${maturity.overallScore}/100, level ${maturity.level}/5).`);
  for (const d of maturity.dimensions) {
    const applicability = d.applicability ?? 'applicable';
    if (applicability === 'applicable') {
      lines.push(`- ${d.dimension}: ${d.score}/100.`);
    } else {
      lines.push(`- ${d.dimension}: ${applicability.replace('_', ' ')} (${d.guidance ?? d.reason ?? 'no signal'}).`);
    }
  }
  if (maturity.topRecommendations.length > 0) {
    lines.push('Top recommendations:');
    for (const rec of maturity.topRecommendations) lines.push(`- ${rec}`);
  }
  return lines.join('\n');
}
