/**
 * `evidence` suite executor for the eval runner.
 *
 * Closes the P4/P5 eval-coverage gap: the evidence COLLECTORS that feed
 * `computeReleaseConfidence` (ci-results-adapter, pr-metadata-adapter) and the P5
 * notquality DOGFOOD fusion path shipped after qulibVersion 0.8.2 with unit tests
 * but no golden eval suite wired into `npm run eval` / the ledger. Root doctrine #11:
 * everything ships wrapped in evaluation — a collector with no scored golden run is
 * an un-evaluated surface. This suite scores those collectors against a frozen golden
 * corpus and appends a real ledger row.
 *
 * Three collector kinds, discriminated by `input.collector`:
 *   - "ci-results"  → runs `ciResultsToEvidence(input.run)`           → asserts EvidenceItem
 *   - "pr-metadata" → runs `prMetadataToEvidence(input.pr)`           → asserts EvidenceItem
 *   - "fusion"      → runs the FULL dogfood path (collectors → computeReleaseConfidence)
 *                     → asserts the fused ReleaseConfidence, then the judge grades the
 *                       narrative against confidence-narrative-v1 (SKIP without a key).
 *
 * Honesty: deterministic asserts are the hard CI gate and ALWAYS run. The LLM-judge
 * only grades the fusion narrative and can only downgrade a PASS; it SKIPs without an
 * ANTHROPIC_API_KEY (the deterministic asserts still gate). A collector-only case
 * carries no judge — its outcome is purely the deterministic verdict.
 *
 * Golden case shape (suite-specific `input`/`expected`):
 *   input.collector  : "ci-results" | "pr-metadata" | "fusion"
 *   input.run        : CiRunInput            (ci-results cases)
 *   input.pr         : PrMetadataInput       (pr-metadata cases)
 *   input.fusion     : { run, pr, automation, policy? } (fusion cases)
 *   input.collectedAt: ISO-8601 freeze timestamp (keeps freshness deterministic)
 *
 *   expected.source              : the EvidenceSourceKind the collector must emit
 *   expected.applicability       : 'applicable' | 'not_applicable' | 'unknown'
 *   expected.scoreExact?         : exact 0..100 score (collector cases)
 *   expected.scoreBand?          : { min, max } score band (collector cases)
 *   expected.scoreNull?          : true if score must be null
 *   expected.blocking?           : exact blocking flag
 *   expected.evidenceIncludes?   : substrings every one of which must appear in some evidence line
 *   expected.evidenceExcludes?   : substrings NONE of which may appear (no-fabrication guard)
 *   expected.recommendationsMinLength? : minimum recommendations[] count
 *   // fusion-only:
 *   expected.verdict?            : the fused ConfidenceVerdict
 *   expected.confidenceScore?    : { min, max } band on the fused score
 *   expected.level?              : { min, max } band on the fused level
 *   expected.contributionSources?: every source that must appear in contributions[]
 */
import { z } from 'zod';
import type { EvalCase, EvalCaseResult, EvalOutcome } from '../types.js';
import {
  EvidenceItemSchema,
  ConfidenceInputSchema,
  ReleaseConfidenceSchema,
  ConfidenceVerdictSchema,
  type EvidenceItem,
} from '../../src/schemas/confidence.schema.js';
import { ciResultsToEvidence, type CiRunInput } from '../../src/adapters/ci-results-adapter.js';
import { prMetadataToEvidence, type PrMetadataInput } from '../../src/adapters/pr-metadata-adapter.js';
import { computeReleaseConfidence } from '../../src/tools/scoring/confidence.js';
import { combineCaseOutcome } from './rollup.js';
import { judgeOrSkip, type JudgeImpl } from './judge-bridge.js';

// --- Suite-specific input/expected validators -------------------------------

const CollectorKind = z.enum(['ci-results', 'pr-metadata', 'fusion']);

/**
 * Loose validator — the precise CiRunInput/PrMetadataInput shapes are owned by the
 * adapters themselves (and re-validated via EvidenceItemSchema on their output). We
 * only assert the envelope here so a malformed case fails loud (GL-005 / fail-once).
 */
const InputSchema = z
  .object({
    collector: CollectorKind,
    collectedAt: z.string().datetime().optional(),
    run: z.record(z.unknown()).optional(),
    pr: z.record(z.unknown()).optional(),
    fusion: z
      .object({
        run: z.record(z.unknown()),
        pr: z.record(z.unknown()),
        automation: z.record(z.unknown()).optional(),
        policy: z.record(z.unknown()).optional(),
      })
      .optional(),
  })
  .passthrough();

const ExpectedSchema = z.object({
  source: z.string().optional(),
  applicability: z.enum(['applicable', 'not_applicable', 'unknown']).optional(),
  scoreExact: z.number().min(0).max(100).optional(),
  scoreBand: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
  scoreNull: z.boolean().optional(),
  blocking: z.boolean().optional(),
  evidenceIncludes: z.array(z.string()).optional(),
  evidenceExcludes: z.array(z.string()).optional(),
  recommendationsMinLength: z.number().int().min(0).optional(),
  // fusion-only
  verdict: ConfidenceVerdictSchema.optional(),
  confidenceScore: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).optional(),
  level: z.object({ min: z.number().int().min(1).max(5), max: z.number().int().min(1).max(5) }).optional(),
  contributionSources: z.array(z.string()).optional(),
});

type Expected = z.infer<typeof ExpectedSchema>;

/**
 * Run one evidence golden case end-to-end. Never throws — asserts capture failure.
 * `judge` is injectable so the judge-active path is testable offline (defaults to the
 * real judge, which SKIPs without an ANTHROPIC_API_KEY).
 */
export async function runEvidenceCase(c: EvalCase, judge?: JudgeImpl): Promise<EvalCaseResult> {
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
    fail(`malformed evidence input: ${inputParsed.error.message}`);
    return finalize(c, outcome, notes, start);
  }
  if (!expectedParsed.success) {
    fail(`malformed expected block: ${expectedParsed.error.message}`);
    return finalize(c, outcome, notes, start);
  }
  const input = inputParsed.data;
  const expected = expectedParsed.data;
  const collectedAt = input.collectedAt;

  // ---- Collector cases (ci-results | pr-metadata) ----
  if (input.collector === 'ci-results' || input.collector === 'pr-metadata') {
    let item: EvidenceItem;
    try {
      item =
        input.collector === 'ci-results'
          ? ciResultsToEvidence(input.run as unknown as CiRunInput, collectedAt)
          : prMetadataToEvidence(input.pr as unknown as PrMetadataInput, collectedAt);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      fail(`collector threw: ${m}`);
      return finalize(c, outcome, notes, start);
    }

    // 1) The produced EvidenceItem must satisfy its own schema (shape gate — the item
    //    is what the scorer consumes, so a malformed item poisons every downstream score).
    const shape = EvidenceItemSchema.safeParse(item);
    if (!shape.success) {
      fail(`EvidenceItem fails EvidenceItemSchema: ${shape.error.message}`);
    } else {
      notes.push('shape: EvidenceItemSchema OK');
    }

    assertEvidenceItem(item, expected, notes, fail);
    return finalize(c, outcome, notes, start);
  }

  // ---- Fusion case (full dogfood path) ----
  const fusion = input.fusion;
  if (!fusion) {
    fail('collector="fusion" requires input.fusion { run, pr, automation? }');
    return finalize(c, outcome, notes, start);
  }

  let rc: ReturnType<typeof computeReleaseConfidence>;
  let evidence: EvidenceItem[];
  try {
    const e2e = ciResultsToEvidence(fusion.run as unknown as CiRunInput, collectedAt);
    const pr = prMetadataToEvidence(fusion.pr as unknown as PrMetadataInput, collectedAt);
    evidence = [e2e, pr];
    if (fusion.automation) {
      const automation = EvidenceItemSchema.parse({
        collectedAt: collectedAt ?? new Date().toISOString(),
        ...fusion.automation,
      });
      evidence.push(automation);
    }
    const confInput = ConfidenceInputSchema.parse({
      subject: { kind: 'release', ref: c.id, tenantId: 'notquality' },
      evidence,
      ...(fusion.policy ? { policy: fusion.policy } : {}),
    });
    rc = computeReleaseConfidence(confInput);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    fail(`fusion path threw: ${m}`);
    return finalize(c, outcome, notes, start);
  }

  // Output must satisfy ReleaseConfidenceSchema (shape gate).
  const shape = ReleaseConfidenceSchema.safeParse(rc);
  if (!shape.success) {
    fail(`ReleaseConfidence output fails its own schema: ${shape.error.message}`);
  } else {
    notes.push('shape: ReleaseConfidenceSchema OK');
  }

  if (expected.verdict !== undefined) {
    if (rc.verdict !== expected.verdict) fail(`verdict expected "${expected.verdict}", got "${rc.verdict}"`);
    else notes.push(`verdict: ${rc.verdict} OK`);
  }
  if (expected.confidenceScore !== undefined) {
    const { min, max } = expected.confidenceScore;
    if (rc.confidenceScore === null) fail(`confidenceScore expected in [${min}, ${max}], got null`);
    else if (rc.confidenceScore < min || rc.confidenceScore > max)
      fail(`confidenceScore ${rc.confidenceScore} outside [${min}, ${max}]`);
    else notes.push(`confidenceScore: ${rc.confidenceScore} ∈ [${min}, ${max}] OK`);
  }
  if (expected.level !== undefined) {
    const { min, max } = expected.level;
    if (rc.level < min || rc.level > max) fail(`level ${rc.level} outside [${min}, ${max}]`);
    else notes.push(`level: ${rc.level} ∈ [${min}, ${max}] OK`);
  }
  if (expected.contributionSources !== undefined) {
    const got = new Set(rc.contributions.map((cc) => cc.source));
    for (const src of expected.contributionSources) {
      if (!got.has(src as never)) fail(`expected contribution source "${src}" not found in [${[...got].join(', ')}]`);
      else notes.push(`contribution source: ${src} OK`);
    }
  }

  // Judge (P4): grade the dogfood narrative for faithfulness to the fused result.
  // SKIPs gracefully without ANTHROPIC_API_KEY — deterministic asserts remain the gate.
  const narrative = buildFusionNarrative(rc, evidence);
  const verdict = await judgeOrSkip({ suite: 'confidence', narrative, releaseConfidence: rc }, judge);
  const caseOutcome = combineCaseOutcome(outcome, verdict.outcome);
  return {
    caseId: c.id,
    suite: 'evidence',
    outcome: caseOutcome,
    deterministic: { outcome, notes },
    judge: verdict,
    latencyMs: Date.now() - start,
  };
}

/** Apply the EvidenceItem-level deterministic asserts shared by collector cases. */
function assertEvidenceItem(
  item: EvidenceItem,
  expected: Expected,
  notes: string[],
  fail: (msg: string) => void
): void {
  if (expected.source !== undefined) {
    if (item.source !== expected.source) fail(`source expected "${expected.source}", got "${item.source}"`);
    else notes.push(`source: ${item.source} OK`);
  }
  if (expected.applicability !== undefined) {
    if (item.applicability !== expected.applicability)
      fail(`applicability expected "${expected.applicability}", got "${item.applicability}"`);
    else notes.push(`applicability: ${item.applicability} OK`);
  }
  if (expected.scoreNull === true) {
    if (item.score !== null) fail(`score expected null, got ${item.score}`);
    else notes.push('score: null OK');
  }
  if (expected.scoreExact !== undefined) {
    if (item.score !== expected.scoreExact) fail(`score expected exactly ${expected.scoreExact}, got ${item.score}`);
    else notes.push(`score: ${item.score} OK`);
  }
  if (expected.scoreBand !== undefined) {
    const { min, max } = expected.scoreBand;
    if (item.score === null) fail(`score expected in [${min}, ${max}], got null`);
    else if (item.score < min || item.score > max) fail(`score ${item.score} outside [${min}, ${max}]`);
    else notes.push(`score: ${item.score} ∈ [${min}, ${max}] OK`);
  }
  if (expected.blocking !== undefined) {
    if (item.blocking !== expected.blocking) fail(`blocking expected ${expected.blocking}, got ${item.blocking}`);
    else notes.push(`blocking: ${item.blocking} OK`);
  }
  if (expected.recommendationsMinLength !== undefined) {
    if (item.recommendations.length < expected.recommendationsMinLength)
      fail(`recommendations.length expected >= ${expected.recommendationsMinLength}, got ${item.recommendations.length}`);
    else notes.push(`recommendations.length: ${item.recommendations.length} OK`);
  }
  const blob = item.evidence.join('\n');
  if (expected.evidenceIncludes !== undefined) {
    for (const sub of expected.evidenceIncludes) {
      if (!blob.includes(sub)) fail(`evidence missing required substring "${sub}"`);
      else notes.push(`evidence includes: "${sub}" OK`);
    }
  }
  if (expected.evidenceExcludes !== undefined) {
    for (const sub of expected.evidenceExcludes) {
      // No-fabrication guard: a forbidden substring (e.g. a PR URL the input never gave)
      // appearing means the collector invented data — a hard FAIL.
      if (blob.includes(sub)) fail(`evidence contains forbidden (fabricated?) substring "${sub}"`);
      else notes.push(`evidence excludes: "${sub}" OK`);
    }
  }
}

function finalize(c: EvalCase, outcome: EvalOutcome, notes: string[], start: number): EvalCaseResult {
  return {
    caseId: c.id,
    suite: 'evidence',
    outcome,
    deterministic: { outcome, notes },
    latencyMs: Date.now() - start,
  };
}

/**
 * Synthesize a faithful dogfood-style narrative for the judge. Mirrors the
 * notquality-dogfood report: states the fused verdict/score/level and surfaces each
 * collector's contribution honestly (excluded sources are named as excluded, never
 * as failures). Faithful by construction — every number comes straight from `rc`.
 */
function buildFusionNarrative(
  rc: ReturnType<typeof computeReleaseConfidence>,
  evidence: EvidenceItem[]
): string {
  const lines: string[] = [];
  const scoreStr = rc.confidenceScore !== null ? `${rc.confidenceScore}/100` : 'null (insufficient evidence)';
  lines.push(`Dogfood release confidence: ${rc.verdict} — ${rc.label} (score ${scoreStr}, level ${rc.level}/5).`);
  lines.push(`Fused from ${evidence.length} real delivery signals:`);
  for (const c of rc.contributions) {
    const scoreLabel = c.score !== null ? `${c.score}/100` : 'null';
    const ewLabel = c.effectiveWeight > 0 ? `ew=${c.effectiveWeight.toFixed(3)}` : 'excluded';
    lines.push(`  - ${c.source}: applicability=${c.applicability} score=${scoreLabel} ${ewLabel}`);
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
