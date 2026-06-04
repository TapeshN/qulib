/**
 * Judge bridge — the single adapter between the eval runner (Q2d) and the
 * LLM-as-judge (Q2c, evals/judge/). This is the ONLY runner file that knows the
 * judge's concrete API, so if Q2c's signature shifts, only this file changes.
 *
 * Q2c contract (evals/judge/judge.ts):
 *   - judgeScaffoldSpec(subject, options)      → Promise<JudgeVerdict>
 *   - judgeMaturityNarrative(subject, options) → Promise<JudgeVerdict>
 *   Both already: return a SKIP verdict when no ANTHROPIC_API_KEY (doctrine #6),
 *   pin judgeModel + rubricVersion, record token cost, and refuse to grade a
 *   subject produced by the judge model (no self-grading, doctrine #11).
 *
 * So this bridge stays thin: it builds the suite-specific request, delegates, and
 * NEVER throws — any unexpected judge error degrades to a SKIP verdict so a flaky
 * judge can't fail an otherwise-green deterministic suite. The deterministic asserts
 * in each run-* module remain the hard CI gate; the judge can only downgrade a PASS.
 *
 * The `JudgeImpl` seam lets unit tests inject a deterministic stub and exercise the
 * delegation path fully offline (no key, no network) without touching evals/judge/.
 */
import type { JudgeVerdict, EvalSuite } from '../types.js';
import type { GeneratedTest, NeutralScenario } from '../../src/schemas/gap-analysis.schema.js';
import type { AutomationMaturity } from '../../src/schemas/automation-maturity.schema.js';
import {
  judgeScaffoldSpec as realJudgeScaffoldSpec,
  judgeMaturityNarrative as realJudgeMaturityNarrative,
} from '../judge/judge.js';
import type { ScaffoldSpecSubject, MaturityNarrativeSubject } from '../judge/subjects.js';

/** What the runner hands the bridge for a scaffold case (one generated spec + its grounding). */
export interface ScaffoldJudgeRequest {
  suite: 'scaffold';
  test: GeneratedTest;
  scenario: NeutralScenario;
  discoveredRoutes: string[];
}

/** What the runner hands the bridge for a score-automation case (narrative + truth set). */
export interface MaturityJudgeRequest {
  suite: 'score-automation';
  narrative: string;
  maturity: AutomationMaturity;
}

export type JudgeRequest = ScaffoldJudgeRequest | MaturityJudgeRequest;

/** Injectable judge implementation (defaults to Q2c's real module; tests pass a stub). */
export interface JudgeImpl {
  judgeScaffoldSpec(subject: ScaffoldSpecSubject): Promise<JudgeVerdict>;
  judgeMaturityNarrative(subject: MaturityNarrativeSubject): Promise<JudgeVerdict>;
}

const defaultJudge: JudgeImpl = {
  judgeScaffoldSpec: (subject) => realJudgeScaffoldSpec(subject),
  judgeMaturityNarrative: (subject) => realJudgeMaturityNarrative(subject),
};

/** A SKIP verdict with zero cost — used whenever the judge cannot honestly run. */
export function skipVerdict(note: string): JudgeVerdict {
  return {
    outcome: 'SKIP',
    score: 0,
    dimensions: [{ dimension: 'judge-availability', score: 0, rationale: note }],
    judgeModel: 'none',
    rubricVersion: 'none',
  };
}

/** True when a judge could run (API key present). Lets the runner report the judge mode. */
export function judgeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;
}

/**
 * Grade one case via Q2c's judge, or SKIP. Never throws — a judge error degrades to
 * a SKIP verdict (with the error note). Q2c already SKIPs internally when no key is
 * set, so the no-key path flows through naturally and is reported as SKIP.
 */
export async function judgeOrSkip(req: JudgeRequest, judge: JudgeImpl = defaultJudge): Promise<JudgeVerdict> {
  try {
    if (req.suite === 'scaffold') {
      return await judge.judgeScaffoldSpec({
        test: req.test,
        scenario: req.scenario,
        discoveredRoutes: req.discoveredRoutes,
      });
    }
    return await judge.judgeMaturityNarrative({
      narrative: req.narrative,
      maturity: req.maturity,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return skipVerdict(`Judge call failed (${message}) — degraded to SKIP; deterministic asserts still ran.`);
  }
}

/**
 * Reduce the per-spec judge verdicts of a multi-scenario scaffold case into one
 * case-level verdict: worst outcome wins (FAIL>WARN>SKIP>PASS for safety), score is
 * the mean of non-SKIP verdicts, cost is summed. Keeps the judge identity pinned.
 */
export function reduceScaffoldVerdicts(verdicts: JudgeVerdict[]): JudgeVerdict {
  if (verdicts.length === 0) return skipVerdict('No specs to judge.');
  const order: Record<string, number> = { FAIL: 3, WARN: 2, SKIP: 1, PASS: 0 };
  const worst = verdicts.reduce((acc, v) => (order[v.outcome] > order[acc.outcome] ? v : acc), verdicts[0]);
  const scored = verdicts.filter((v) => v.outcome !== 'SKIP');
  const score =
    scored.length === 0 ? 0 : Math.round((scored.reduce((s, v) => s + v.score, 0) / scored.length) * 1000) / 1000;
  const cost = verdicts.reduce(
    (acc, v) => {
      if (v.cost) {
        acc.inputTokens += v.cost.inputTokens;
        acc.outputTokens += v.cost.outputTokens;
        acc.any = true;
        if (v.cost.dataQuality === 'estimated') acc.estimated = true;
      }
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, any: false, estimated: false }
  );
  return {
    outcome: worst.outcome,
    score,
    dimensions: worst.dimensions,
    judgeModel: worst.judgeModel,
    rubricVersion: worst.rubricVersion,
    ...(cost.any && {
      cost: {
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        dataQuality: cost.estimated ? ('estimated' as const) : ('actual' as const),
      },
    }),
  };
}
