/**
 * `provenance` suite executor for the eval runner.
 *
 * Grades deterministic WSR + ship-gate from golden cases. No LLM judge.
 */
import { z } from 'zod';
import type { EvalCase, EvalCaseResult, EvalOutcome } from '../types.js';
import {
  ProvenanceInputSchema,
  ProvenanceScoreSchema,
  ProvenanceRubricVersionSchema,
  ShipGateSchema,
} from '../../src/schemas/provenance.schema.js';
import { computeProvenanceScore } from '../../src/tools/scoring/provenance.js';

const ExpectedSchema = z.object({
  wsr: z.number().min(0).max(1).optional(),
  wsrExact: z.number().min(0).max(1).optional(),
  wsrMax: z.number().min(0).max(1).optional(),
  shipGate: ShipGateSchema.optional(),
  rubricVersion: ProvenanceRubricVersionSchema.optional(),
  staleMassMin: z.number().min(0).optional(),
});

const InputEnvelopeSchema = ProvenanceInputSchema.extend({
  referenceTime: z.string().datetime().optional(),
});

export async function runProvenanceCase(c: EvalCase): Promise<EvalCaseResult> {
  const start = Date.now();
  const notes: string[] = [];
  let outcome: EvalOutcome = 'PASS';

  const fail = (msg: string): void => {
    notes.push(`FAIL: ${msg}`);
    outcome = 'FAIL';
  };

  const inputParsed = InputEnvelopeSchema.safeParse(c.input);
  const expectedParsed = ExpectedSchema.safeParse(c.expected);

  if (!inputParsed.success) {
    fail(`malformed input: ${inputParsed.error.message}`);
    return finalize(c, outcome, notes, start);
  }
  if (!expectedParsed.success) {
    fail(`malformed expected block: ${expectedParsed.error.message}`);
    return finalize(c, outcome, notes, start);
  }

  const { referenceTime, ...provenanceInput } = inputParsed.data;
  const expected = expectedParsed.data;

  const ps = computeProvenanceScore(provenanceInput, referenceTime);

  const shape = ProvenanceScoreSchema.safeParse(ps);
  if (!shape.success) {
    fail(`ProvenanceScore output fails schema: ${shape.error.message}`);
  } else {
    notes.push('shape: ProvenanceScoreSchema OK');
  }

  if (expected.rubricVersion !== undefined && ps.rubricVersion !== expected.rubricVersion) {
    fail(`rubricVersion expected "${expected.rubricVersion}", got "${ps.rubricVersion}"`);
  } else if (expected.rubricVersion !== undefined) {
    notes.push(`rubricVersion: ${ps.rubricVersion} OK`);
  }

  if (expected.wsr !== undefined) {
    if (ps.wsr === null || Math.abs(ps.wsr - expected.wsr) > 0.0001) {
      fail(`wsr expected ${expected.wsr}, got ${ps.wsr}`);
    } else {
      notes.push(`wsr: ${ps.wsr} OK`);
    }
  }

  if (expected.wsrExact !== undefined) {
    if (ps.wsr === null || Math.abs(ps.wsr - expected.wsrExact) > 0.0001) {
      fail(`wsr expected exactly ${expected.wsrExact}, got ${ps.wsr}`);
    } else {
      notes.push(`wsr exact: ${ps.wsr} OK`);
    }
  }

  if (expected.wsrMax !== undefined) {
    if (ps.wsr === null || ps.wsr >= expected.wsrMax) {
      fail(`wsr expected < ${expected.wsrMax}, got ${ps.wsr}`);
    } else {
      notes.push(`wsr ${ps.wsr} < ${expected.wsrMax} OK`);
    }
  }

  if (expected.shipGate !== undefined) {
    if (ps.shipGate !== expected.shipGate) {
      fail(`shipGate expected "${expected.shipGate}", got "${ps.shipGate}"`);
    } else {
      notes.push(`shipGate: ${ps.shipGate} OK`);
    }
  }

  if (expected.staleMassMin !== undefined) {
    if (ps.staleMass < expected.staleMassMin) {
      fail(`staleMass expected >= ${expected.staleMassMin}, got ${ps.staleMass}`);
    } else {
      notes.push(`staleMass: ${ps.staleMass} >= ${expected.staleMassMin} OK`);
    }
  }

  // Determinism check: second run must match.
  const ps2 = computeProvenanceScore(provenanceInput, referenceTime);
  if (ps.wsr !== ps2.wsr) {
    fail(`determinism violated: wsr ${ps.wsr} !== ${ps2.wsr} on repeat`);
  } else {
    notes.push('determinism: repeat WSR OK');
  }

  return finalize(c, outcome, notes, start);
}

function finalize(
  c: EvalCase,
  outcome: EvalOutcome,
  notes: string[],
  start: number
): EvalCaseResult {
  return {
    caseId: c.id,
    suite: 'provenance',
    outcome,
    deterministic: { outcome, notes },
    latencyMs: Date.now() - start,
  };
}
