/**
 * `confidence` suite executor for the eval runner.
 *
 * P3 — qulib Confidence Layer v1.
 *
 * `computeReleaseConfidence(input: ConfidenceInput)` is fully DETERMINISTIC — pure
 * function, no I/O. This suite is graded entirely by deterministic asserts (no LLM
 * judge needed for the deterministic golden cases; P4 adds an LLM-judge for narrative).
 *
 * Golden case shape:
 *   input.evidence    : EvidenceItem[] (validated by ConfidenceInputSchema)
 *   input.subject     : { kind, ref, tenantId }
 *   input.policy?     : ConfidencePolicySchema-compatible overrides
 *   expected.verdict              : the ConfidenceVerdict the scorer must return
 *   expected.confidenceScore?     : { min, max } band (omitted for block-by-blocker cases)
 *   expected.level?               : { min, max } band
 *   expected.blockersLength?      : exact blockers[] count
 *   expected.honestyNotesMinLength? : minimum honestyNotes count
 *   expected.apiContributionEffectiveWeight? : exact effectiveWeight for 'api-coverage' contribution
 */
import { z } from 'zod';
import type { EvalCase, EvalCaseResult, EvalOutcome } from '../types.js';
import { ConfidenceInputSchema, ReleaseConfidenceSchema, ConfidenceVerdictSchema } from '../../src/schemas/confidence.schema.js';
import { computeReleaseConfidence } from '../../src/tools/scoring/confidence.js';
import { combineCaseOutcome } from './rollup.js';
import { judgeOrSkip, type JudgeImpl } from './judge-bridge.js';

const ExpectedSchema = z.object({
  verdict: ConfidenceVerdictSchema,
  confidenceScore: z
    .object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) })
    .optional(),
  level: z
    .object({ min: z.number().int().min(1).max(5), max: z.number().int().min(1).max(5) })
    .optional(),
  blockersLength: z.number().int().min(0).optional(),
  honestyNotesMinLength: z.number().int().min(0).optional(),
  apiContributionEffectiveWeight: z.number().min(0).max(1).optional(),
});

/**
 * Run one confidence golden case end-to-end. Never throws — asserts capture failure.
 * `judge` is injectable so the judge-active path is testable offline
 * (defaults to the real judge, which SKIPs without an ANTHROPIC_API_KEY).
 */
export async function runConfidenceCase(c: EvalCase, judge?: JudgeImpl): Promise<EvalCaseResult> {
  const start = Date.now();
  const notes: string[] = [];
  let outcome: EvalOutcome = 'PASS';

  const fail = (msg: string): void => {
    notes.push(`FAIL: ${msg}`);
    outcome = 'FAIL';
  };

  // Validate input against ConfidenceInputSchema.
  const inputParsed = ConfidenceInputSchema.safeParse(c.input);
  const expectedParsed = ExpectedSchema.safeParse(c.expected);

  if (!inputParsed.success) {
    fail(`malformed input (not a ConfidenceInput): ${inputParsed.error.message}`);
    return finalize(c, outcome, notes, start);
  }
  if (!expectedParsed.success) {
    fail(`malformed expected block: ${expectedParsed.error.message}`);
    return finalize(c, outcome, notes, start);
  }

  const input = inputParsed.data;
  const expected = expectedParsed.data;

  // Run the pure scorer.
  const rc = computeReleaseConfidence(input);

  // 1) Output must satisfy ReleaseConfidenceSchema (shape gate).
  const shape = ReleaseConfidenceSchema.safeParse(rc);
  if (!shape.success) {
    fail(`ReleaseConfidence output fails its own schema: ${shape.error.message}`);
  } else {
    notes.push('shape: ReleaseConfidenceSchema OK');
  }

  // 2) Verdict must match exactly.
  if (rc.verdict !== expected.verdict) {
    fail(`verdict expected "${expected.verdict}", got "${rc.verdict}"`);
  } else {
    notes.push(`verdict: ${rc.verdict} OK`);
  }

  // 3) confidenceScore band check (optional in expected — omitted for null-score cases).
  if (expected.confidenceScore !== undefined) {
    const { min, max } = expected.confidenceScore;
    if (rc.confidenceScore === null) {
      fail(`confidenceScore expected in [${min}, ${max}], got null`);
    } else if (rc.confidenceScore < min || rc.confidenceScore > max) {
      fail(`confidenceScore ${rc.confidenceScore} outside expected band [${min}, ${max}]`);
    } else {
      notes.push(`confidenceScore: ${rc.confidenceScore} ∈ [${min}, ${max}] OK`);
    }
  }

  // 4) Level band check (optional).
  if (expected.level !== undefined) {
    const { min, max } = expected.level;
    if (rc.level < min || rc.level > max) {
      fail(`level ${rc.level} outside expected band [${min}, ${max}]`);
    } else {
      notes.push(`level: ${rc.level} ∈ [${min}, ${max}] OK`);
    }
  }

  // 5) Blockers length (exact count).
  if (expected.blockersLength !== undefined) {
    if (rc.blockers.length !== expected.blockersLength) {
      fail(`blockers.length expected ${expected.blockersLength}, got ${rc.blockers.length} — [${rc.blockers.join('; ')}]`);
    } else {
      notes.push(`blockers.length: ${rc.blockers.length} OK`);
    }
  }

  // 6) Honesty notes minimum count.
  if (expected.honestyNotesMinLength !== undefined) {
    if (rc.honestyNotes.length < expected.honestyNotesMinLength) {
      fail(`honestyNotes.length expected >= ${expected.honestyNotesMinLength}, got ${rc.honestyNotes.length}`);
    } else {
      notes.push(`honestyNotes.length: ${rc.honestyNotes.length} >= ${expected.honestyNotesMinLength} OK`);
    }
  }

  // 7) api-coverage contribution effectiveWeight (honesty: not_applicable → must be 0).
  if (expected.apiContributionEffectiveWeight !== undefined) {
    const apiContrib = rc.contributions.find((c2) => c2.source === 'api-coverage');
    if (!apiContrib) {
      fail(`expected api-coverage contribution but none found`);
    } else {
      const got = Number(apiContrib.effectiveWeight.toFixed(6));
      const want = Number(expected.apiContributionEffectiveWeight.toFixed(6));
      if (Math.abs(got - want) > 0.0001) {
        fail(`api-coverage effectiveWeight expected ${want}, got ${got}`);
      } else {
        notes.push(`api-coverage effectiveWeight: ${got} ≈ ${want} OK`);
      }
    }
  }

  // Judge (P4): grades the narrative against the confidence-narrative-v1 rubric.
  // SKIPs gracefully when no ANTHROPIC_API_KEY — deterministic asserts remain the CI gate.
  const narrative = buildConfidenceNarrative(rc);
  const verdict = await judgeOrSkip({ suite: 'confidence', narrative, releaseConfidence: rc }, judge);

  const caseOutcome = combineCaseOutcome(outcome, verdict.outcome);
  return {
    caseId: c.id,
    suite: 'confidence',
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
    suite: 'confidence',
    outcome,
    deterministic: { outcome, notes },
    latencyMs: Date.now() - start,
  };
}

/**
 * Synthesize a human-facing narrative for the judge to grade for faithfulness.
 * Kept faithful: states computed verdict/score/level; surfaces each excluded source honestly.
 */
function buildConfidenceNarrative(rc: ReturnType<typeof computeReleaseConfidence>): string {
  const lines: string[] = [];
  const scoreStr = rc.confidenceScore !== null ? `${rc.confidenceScore}/100` : 'null (nothing evaluable)';
  lines.push(`Release confidence: ${rc.verdict} — ${rc.label} (score ${scoreStr}, level ${rc.level}/5).`);
  for (const c of rc.contributions) {
    const scoreLabel = c.score !== null ? `${c.score}/100` : 'null';
    const ewLabel = c.effectiveWeight > 0 ? `ew=${c.effectiveWeight.toFixed(3)}` : 'excluded';
    lines.push(`  - ${c.source}: applicability=${c.applicability} score=${scoreLabel} blocking=${String(c.blocking)} ${ewLabel}`);
  }
  if (rc.blockers.length > 0) {
    lines.push('Blockers:');
    for (const b of rc.blockers) lines.push(`  - ${b}`);
  }
  if (rc.honestyNotes.length > 0) {
    lines.push('Honesty notes:');
    for (const n of rc.honestyNotes) lines.push(`  - ${n}`);
  }
  return lines.join('\n');
}
