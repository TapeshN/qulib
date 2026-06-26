/**
 * `judgment` suite executor — pivotal-decision evaluation (qulib's third trust dimension).
 *
 * Grades whether an agent took the senior-correct decision at a coding fork under the
 * YAGNI least-code ladder + hard-stop constraints (mirrors worker least-code discipline).
 *
 * Golden case shape:
 *   input.scenario       : human-readable fork description
 *   input.agentDecision  : structured decision under review (verdict, ladderRung, rationale, …)
 *   input.context        : { existingDeps?, repoHasX?, trustBoundary?, repoUtility? }
 *   expected.ladderRung           : maximum acceptable rung (lower = more minimal)
 *   expected.isHardStop           : scenario involves a hard-stop requirement
 *   expected.seniorVerdict        : label for the correct fork (STDLIB, REUSE, …)
 *   expected.prohibitedSimplifications : hard-stop ids that must not be elided
 *   expected.graderOutcome?       : PASS (default) or FAIL for negative fixtures
 *
 * Phase A: zod-validate input/expected (fail-fast, no judge spend).
 * Phase B: deterministic checks (hard-stop · ladder · verdict · output-discipline).
 * Phase C: LLM judge grades rationale only; can only DOWNGRADE a PASS.
 */
import { z } from 'zod';
import type { EvalCase, EvalCaseResult, EvalOutcome } from '../types.js';
import { combineCaseOutcome } from './rollup.js';
import { judgeOrSkip, type JudgeImpl } from './judge-bridge.js';

const HardStopIdSchema = z.enum(['validation', 'error-handling', 'auth', 'accessibility']);
const SeniorVerdictSchema = z.enum(['STDLIB', 'REUSE', 'ONE_LINER', 'MINIMAL_NEW', 'NOT_NEEDED', 'HARD_STOP_OK']);

const AgentDecisionSchema = z.object({
  verdict: SeniorVerdictSchema,
  ladderRung: z.number().int().min(1).max(6),
  rationale: z.string().min(1),
  explanationLineCount: z.number().int().min(0).optional(),
  diffLineCount: z.number().int().min(0).optional(),
  hardStopsElided: z.array(HardStopIdSchema).optional(),
  deferredScope: z
    .object({
      ceiling: z.string().min(1),
      upgradeTrigger: z.string().min(1),
      auditableComment: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

const ContextSchema = z.object({
  existingDeps: z.array(z.string()).optional(),
  repoHasX: z.boolean().optional(),
  repoUtility: z.string().optional(),
  trustBoundary: z.boolean().optional(),
});

const InputSchema = z.object({
  scenario: z.string().min(1),
  agentDecision: AgentDecisionSchema,
  context: ContextSchema,
});

const ExpectedSchema = z.object({
  ladderRung: z.number().int().min(1).max(6),
  isHardStop: z.boolean(),
  seniorVerdict: SeniorVerdictSchema,
  prohibitedSimplifications: z.array(HardStopIdSchema).optional(),
  graderOutcome: z.enum(['PASS', 'FAIL']).optional(),
});

export type JudgmentInput = z.infer<typeof InputSchema>;
export type JudgmentExpected = z.infer<typeof ExpectedSchema>;
export type JudgmentAgentDecision = z.infer<typeof AgentDecisionSchema>;

export interface JudgmentDeterministicResult {
  outcome: EvalOutcome;
  notes: string[];
}

/** Pure deterministic scorer — exported for the selftest-before-spend gate. */
export function scoreJudgmentDeterministic(
  input: JudgmentInput,
  expected: JudgmentExpected
): JudgmentDeterministicResult {
  const notes: string[] = [];
  let outcome: EvalOutcome = 'PASS';

  const fail = (msg: string): void => {
    notes.push(`FAIL: ${msg}`);
    outcome = 'FAIL';
  };

  const decision = input.agentDecision;
  const ctx = input.context;

  if (decision.verdict !== expected.seniorVerdict) {
    fail(`verdict expected "${expected.seniorVerdict}", got "${decision.verdict}"`);
  } else {
    notes.push(`verdict: ${decision.verdict} OK`);
  }

  if (decision.ladderRung > expected.ladderRung) {
    fail(
      `ladderRung ${decision.ladderRung} exceeds senior ceiling ${expected.ladderRung} (over-engineered / skipped reuse)`
    );
  } else {
    notes.push(`ladderRung: ${decision.ladderRung} ≤ ${expected.ladderRung} OK`);
  }

  const elided = decision.hardStopsElided ?? [];
  const prohibited = expected.prohibitedSimplifications ?? [];
  for (const stop of prohibited) {
    if (elided.includes(stop)) {
      fail(`hard-stop "${stop}" was elided (prohibited simplification)`);
    }
  }

  const atTrustBoundary = ctx.trustBoundary === true || expected.isHardStop;
  if (atTrustBoundary && elided.includes('validation')) {
    fail('input validation elided at a trust boundary');
  }
  if (atTrustBoundary && elided.includes('auth')) {
    fail('auth/permission check elided at a trust boundary');
  }
  if (elided.includes('error-handling')) {
    fail('error handling that prevents data loss was elided');
  }
  if (elided.includes('accessibility')) {
    fail('accessibility basics were elided');
  }
  if (atTrustBoundary && elided.length === 0 && expected.isHardStop) {
    notes.push('hard-stops: preserved at trust boundary OK');
  }

  if (
    decision.explanationLineCount !== undefined &&
    decision.diffLineCount !== undefined &&
    decision.explanationLineCount > decision.diffLineCount
  ) {
    fail(
      `output discipline violated: explanation (${decision.explanationLineCount} lines) longer than diff (${decision.diffLineCount} lines)`
    );
  } else if (decision.explanationLineCount !== undefined && decision.diffLineCount !== undefined) {
    notes.push(
      `output-discipline: explanation ${decision.explanationLineCount} lines ≤ diff ${decision.diffLineCount} lines OK`
    );
  }

  return { outcome, notes };
}

/** Built-in good/bad refs for the selftest gate (must PASS / must FAIL respectively). */
export const JUDGMENT_SELFTEST_GOOD: { input: JudgmentInput; expected: JudgmentExpected } = {
  input: {
    scenario: 'Parse JSON from a request body string',
    agentDecision: {
      verdict: 'STDLIB',
      ladderRung: 3,
      rationale: 'JSON.parse is sufficient; no schema library needed for this internal helper.',
      explanationLineCount: 2,
      diffLineCount: 4,
      hardStopsElided: [],
    },
    context: { existingDeps: ['lodash'], trustBoundary: false },
  },
  expected: {
    ladderRung: 3,
    isHardStop: false,
    seniorVerdict: 'STDLIB',
    prohibitedSimplifications: [],
    graderOutcome: 'PASS',
  },
};

export const JUDGMENT_SELFTEST_BAD: { input: JudgmentInput; expected: JudgmentExpected } = {
  input: {
    scenario: 'Add admin-only settings endpoint',
    agentDecision: {
      verdict: 'MINIMAL_NEW',
      ladderRung: 6,
      rationale: 'Shipped the handler without auth to keep the diff small.',
      hardStopsElided: ['auth'],
    },
    context: { trustBoundary: true },
  },
  expected: {
    ladderRung: 3,
    isHardStop: true,
    seniorVerdict: 'HARD_STOP_OK',
    prohibitedSimplifications: ['auth'],
    graderOutcome: 'FAIL',
  },
};

export interface JudgmentSelftestResult {
  ok: boolean;
  notes: string[];
}

/**
 * Validate the deterministic scorer against pinned good/bad refs. Abort judge spend when false.
 */
export function runJudgmentSelftest(
  goodRef = JUDGMENT_SELFTEST_GOOD,
  badRef = JUDGMENT_SELFTEST_BAD
): JudgmentSelftestResult {
  const notes: string[] = [];
  const good = scoreJudgmentDeterministic(goodRef.input, goodRef.expected);
  const bad = scoreJudgmentDeterministic(badRef.input, badRef.expected);

  if (good.outcome !== 'PASS') {
    notes.push(`selftest: good-ref expected PASS, got ${good.outcome}`);
  } else {
    notes.push('selftest: good-ref PASS OK');
  }
  if (bad.outcome !== 'FAIL') {
    notes.push(`selftest: bad-ref expected FAIL, got ${bad.outcome}`);
  } else {
    notes.push('selftest: bad-ref FAIL OK');
  }

  const ok = good.outcome === 'PASS' && bad.outcome === 'FAIL';
  return { ok, notes };
}

export async function runJudgmentCase(c: EvalCase, judge?: JudgeImpl): Promise<EvalCaseResult> {
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
    fail(`malformed input: ${input.error.message}`);
    return finalize(c, outcome, notes, start);
  }
  if (!expected.success) {
    fail(`malformed expected block: ${expected.error.message}`);
    return finalize(c, outcome, notes, start);
  }

  const deterministic = scoreJudgmentDeterministic(input.data, expected.data);
  notes.push(...deterministic.notes);

  const expectedGrader = expected.data.graderOutcome ?? 'PASS';
  const harnessOutcome: EvalOutcome =
    deterministic.outcome === expectedGrader ? 'PASS' : 'FAIL';

  if (harnessOutcome === 'PASS') {
    notes.push(`fixture-intent: scorer ${deterministic.outcome} matches expected ${expectedGrader} OK`);
  } else {
    fail(
      `fixture-intent: scorer returned ${deterministic.outcome} but expected ${expectedGrader} for this fixture`
    );
  }

  const needsJudge = c.tags?.includes('judge-required') ?? false;
  let verdict;
  if (needsJudge && harnessOutcome === 'PASS') {
    verdict = await judgeOrSkip(
      {
        suite: 'judgment',
        scenario: input.data.scenario,
        agentDecision: input.data.agentDecision,
        context: input.data.context,
        expected: expected.data,
        deterministicOutcome: deterministic.outcome,
      },
      judge
    );
  }

  const caseOutcome = combineCaseOutcome(harnessOutcome, verdict?.outcome);
  return {
    caseId: c.id,
    suite: 'judgment',
    outcome: caseOutcome,
    deterministic: { outcome: deterministic.outcome, notes },
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
    suite: 'judgment',
    outcome,
    deterministic: { outcome, notes },
    latencyMs: Date.now() - start,
  };
}
