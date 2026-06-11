/**
 * `analyze-diff` suite executor for the eval runner.
 *
 * `analyzeRunDiff(from, to)` is a DETERMINISTIC pure function — no I/O.
 * This suite is graded entirely by deterministic asserts; no LLM judge is
 * required because the output shape is exact (not a narrative).
 *
 * Golden case shape (evals/golden/analyze-diff/*.json):
 *   input.from                   : GapAnalysis ("before" report)
 *   input.to                     : GapAnalysis ("after" report)
 *   expected.addedLength         : exact count of added findings
 *   expected.removedLength       : exact count of removed findings
 *   expected.changedLength       : exact count of severity-changed findings
 *   expected.confidenceDelta?    : exact numeric delta (omit if null expected)
 *   expected.confidenceDeltaIsNull? : true if delta must be null (null-confidence case)
 *   expected.direction           : 'improved' | 'regressed' | 'unchanged' | 'unknown'
 *   expected.summaryContains     : substring that must appear in the summary
 *   expected.addedPaths?         : array of paths that must appear in added[]
 *   expected.removedPaths?       : array of paths that must appear in removed[]
 *   expected.changedPaths?       : array of paths that must appear in changed[]
 *   expected.changedStatuses?    : array of statuses that must appear in changed[] items
 */
import { z } from 'zod';
import type { EvalCase, EvalCaseResult, EvalOutcome } from '../types.js';
import { GapAnalysisSchema } from '../../src/schemas/gap-analysis.schema.js';
import { analyzeRunDiff } from '../../src/cli/analyze-diff-run.js';
import { combineCaseOutcome } from './rollup.js';

const ExpectedSchema = z.object({
  addedLength: z.number().int().min(0),
  removedLength: z.number().int().min(0),
  changedLength: z.number().int().min(0),
  confidenceDelta: z.number().optional(),
  confidenceDeltaIsNull: z.boolean().optional(),
  direction: z.enum(['improved', 'regressed', 'unchanged', 'unknown']),
  summaryContains: z.string().min(1),
  addedPaths: z.array(z.string()).optional(),
  removedPaths: z.array(z.string()).optional(),
  changedPaths: z.array(z.string()).optional(),
  changedStatuses: z.array(z.string()).optional(),
});

const InputSchema = z.object({
  from: GapAnalysisSchema,
  to: GapAnalysisSchema,
});

/**
 * Run one analyze-diff golden case end-to-end. Never throws — asserts capture failure.
 */
export async function runAnalyzeDiffCase(c: EvalCase): Promise<EvalCaseResult> {
  const start = Date.now();
  const notes: string[] = [];
  let outcome: EvalOutcome = 'PASS';

  const fail = (msg: string): void => {
    notes.push(`FAIL: ${msg}`);
    outcome = 'FAIL';
  };

  const inputParsed = InputSchema.safeParse(c.input);
  const expectedParsed = ExpectedSchema.safeParse(c.expected);

  if (!inputParsed.success) {
    fail(`malformed input: ${inputParsed.error.message}`);
    return finalize(c, outcome, notes, start);
  }
  if (!expectedParsed.success) {
    fail(`malformed expected block: ${expectedParsed.error.message}`);
    return finalize(c, outcome, notes, start);
  }

  const { from, to } = inputParsed.data;
  const expected = expectedParsed.data;

  // Run the pure diff function.
  const result = analyzeRunDiff(from, to);

  // 1) added length
  if (result.added.length !== expected.addedLength) {
    fail(`added.length: expected ${expected.addedLength}, got ${result.added.length}`);
  } else {
    notes.push(`added.length: ${result.added.length} OK`);
  }

  // 2) removed length
  if (result.removed.length !== expected.removedLength) {
    fail(`removed.length: expected ${expected.removedLength}, got ${result.removed.length}`);
  } else {
    notes.push(`removed.length: ${result.removed.length} OK`);
  }

  // 3) changed length
  if (result.changed.length !== expected.changedLength) {
    fail(`changed.length: expected ${expected.changedLength}, got ${result.changed.length}`);
  } else {
    notes.push(`changed.length: ${result.changed.length} OK`);
  }

  // 4) confidenceDelta (exact numeric) — mutually exclusive with confidenceDeltaIsNull
  if (expected.confidenceDeltaIsNull === true) {
    if (result.confidenceDelta !== null) {
      fail(`confidenceDelta: expected null, got ${result.confidenceDelta}`);
    } else {
      notes.push('confidenceDelta: null OK');
    }
  } else if (expected.confidenceDelta !== undefined) {
    if (result.confidenceDelta !== expected.confidenceDelta) {
      fail(`confidenceDelta: expected ${expected.confidenceDelta}, got ${result.confidenceDelta}`);
    } else {
      notes.push(`confidenceDelta: ${result.confidenceDelta} OK`);
    }
  }

  // 5) direction
  if (result.direction !== expected.direction) {
    fail(`direction: expected "${expected.direction}", got "${result.direction}"`);
  } else {
    notes.push(`direction: ${result.direction} OK`);
  }

  // 6) summary substring
  if (!result.summary.toLowerCase().includes(expected.summaryContains.toLowerCase())) {
    fail(`summary does not contain "${expected.summaryContains}": "${result.summary}"`);
  } else {
    notes.push(`summary contains "${expected.summaryContains}" OK`);
  }

  // 7) addedPaths (each must appear)
  if (expected.addedPaths) {
    for (const path of expected.addedPaths) {
      if (!result.added.some((g) => g.path === path)) {
        fail(`added paths: expected "${path}" but not found`);
      } else {
        notes.push(`added path "${path}" OK`);
      }
    }
  }

  // 8) removedPaths
  if (expected.removedPaths) {
    for (const path of expected.removedPaths) {
      if (!result.removed.some((g) => g.path === path)) {
        fail(`removed paths: expected "${path}" but not found`);
      } else {
        notes.push(`removed path "${path}" OK`);
      }
    }
  }

  // 9) changedPaths
  if (expected.changedPaths) {
    for (const path of expected.changedPaths) {
      if (!result.changed.some((g) => g.path === path)) {
        fail(`changed paths: expected "${path}" but not found`);
      } else {
        notes.push(`changed path "${path}" OK`);
      }
    }
  }

  // 10) changedStatuses (each status must appear in at least one changed item)
  if (expected.changedStatuses) {
    for (const status of expected.changedStatuses) {
      if (!result.changed.some((g) => g.status === status)) {
        fail(`changed statuses: expected "${status}" but not found`);
      } else {
        notes.push(`changed status "${status}" OK`);
      }
    }
  }

  const caseOutcome = combineCaseOutcome(outcome, 'PASS');
  return {
    caseId: c.id,
    suite: 'analyze-diff',
    outcome: caseOutcome,
    deterministic: { outcome, notes },
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
    suite: 'analyze-diff',
    outcome,
    deterministic: { outcome, notes },
    latencyMs: Date.now() - start,
  };
}
