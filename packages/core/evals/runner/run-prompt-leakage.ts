/**
 * `prompt-leakage` suite executor for the eval runner.
 *
 * `detectPromptLeakage(route)` is a DETERMINISTIC pure function — no I/O, no LLM.
 * This suite is graded entirely by deterministic asserts; no LLM judge is required.
 *
 * Golden case shape (evals/golden/prompt-leakage/*.json):
 *   input.path          : route path under test
 *   input.bodySnippet?  : captured HTML/response body snippet
 *   input.headers?      : response headers map
 *   expected.gapsLength?  : exact count of returned gaps
 *   expected.hasCategory? : 'prompt-leakage' — every gap must carry this category
 *   expected.minSeverity? : at least one gap must meet this severity bar
 *   expected.zeroGaps?    : true when the route must produce no gaps
 */
import { z } from 'zod';
import type { EvalCase, EvalCaseResult, EvalOutcome } from '../types.js';
import type { Gap } from '../../src/schemas/gap-analysis.schema.js';
import { detectPromptLeakage } from '../../src/tools/scoring/prompt-leakage.js';
import { combineCaseOutcome } from './rollup.js';

const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);

const InputSchema = z.object({
  path: z.string().min(1),
  bodySnippet: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

const ExpectedSchema = z.object({
  gapsLength: z.number().int().min(0).optional(),
  hasCategory: z.literal('prompt-leakage').optional(),
  minSeverity: SeveritySchema.optional(),
  zeroGaps: z.boolean().optional(),
});

const SEVERITY_RANK: Record<Gap['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Run one prompt-leakage golden case end-to-end. Never throws — asserts capture failure.
 */
export async function runPromptLeakageCase(c: EvalCase): Promise<EvalCaseResult> {
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

  const { path, bodySnippet, headers } = inputParsed.data;
  const expected = expectedParsed.data;

  const gaps = detectPromptLeakage({ path, bodySnippet, headers });

  if (expected.zeroGaps === true) {
    if (gaps.length !== 0) {
      fail(`zeroGaps: expected 0 gaps, got ${gaps.length}`);
    } else {
      notes.push('zeroGaps: 0 OK');
    }
  }

  if (expected.gapsLength !== undefined) {
    if (gaps.length !== expected.gapsLength) {
      fail(`gapsLength: expected ${expected.gapsLength}, got ${gaps.length}`);
    } else {
      notes.push(`gapsLength: ${gaps.length} OK`);
    }
  }

  if (expected.hasCategory !== undefined) {
    if (gaps.length === 0) {
      fail(`hasCategory: expected gaps with category "${expected.hasCategory}", got none`);
    } else {
      for (const gap of gaps) {
        if (gap.category !== expected.hasCategory) {
          fail(`hasCategory: expected "${expected.hasCategory}", got "${gap.category}" on gap ${gap.id}`);
        }
      }
      if (outcome === 'PASS') notes.push(`hasCategory: ${expected.hasCategory} OK`);
    }
  }

  if (expected.minSeverity !== undefined) {
    const minRank = SEVERITY_RANK[expected.minSeverity];
    const best = gaps.reduce((max, g) => Math.max(max, SEVERITY_RANK[g.severity]), 0);
    if (best < minRank) {
      fail(
        `minSeverity: expected at least one "${expected.minSeverity}" gap, got severities [${gaps.map((g) => g.severity).join(', ')}]`
      );
    } else {
      notes.push(`minSeverity: ${expected.minSeverity} OK`);
    }
  }

  const caseOutcome = combineCaseOutcome(outcome, 'PASS');
  return {
    caseId: c.id,
    suite: 'prompt-leakage',
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
    suite: 'prompt-leakage',
    outcome,
    deterministic: { outcome, notes },
    latencyMs: Date.now() - start,
  };
}
