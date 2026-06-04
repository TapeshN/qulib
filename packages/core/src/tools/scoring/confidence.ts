/**
 * Release Confidence Aggregator — pure scorer.
 *
 * P3 — qulib Confidence Layer v1.
 *
 * Pure function: no I/O, no side effects. All I/O (CLI, MCP) lives in the wiring layer.
 * Algorithm mirrors computeAutomationMaturity's denominator-renormalization math, generalized
 * to operate over a heterogeneous evidence bundle.
 *
 * Score formula:
 *   confidenceScore = round( Σ score_i * weight_i / Σ weight_i )
 *   where i ∈ { applicable items with score !== null }
 *
 * Excluded from denominator: not_applicable | unknown | score === null items.
 * Each excluded item is reported in contributions + narrated in honestyNotes.
 *
 * Verdict ladder (mirrors agent-summary.ts deriveGate, lifted to fused score):
 *   any blocking item              → block
 *   confidenceScore === null       → block  (nothing evaluable; honesty floor)
 *   confidenceScore < failThreshold → hold
 *   unknown on a requiredSource OR
 *   confidenceScore < passThreshold → caution
 *   else                           → ship
 */

import type {
  ConfidenceInput,
  ConfidencePolicy,
  EvidenceItem,
  ReleaseConfidence,
  ConfidenceVerdict,
} from '../../schemas/confidence.schema.js';
import { ReleaseConfidenceSchema, ConfidencePolicySchema } from '../../schemas/confidence.schema.js';
import { scoreLevel } from './levels.js';

// ---------------------------------------------------------------------------
// Default per-source weights (sum over the qulib-native set ≈ 0.90; renormalized at runtime)
// Rationale grounded in §2.4 of the P3 spec.
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS: Record<string, number> = {
  'live-app-quality': 0.30,
  'test-automation': 0.22,
  'api-coverage': 0.15,
  'accessibility': 0.13,
  'crawl-coverage': 0.10,
  'ci-results': 0.10,
  // External sources reserved for P4 — zero weight until wired:
  'deploy-metadata': 0.0,
  'error-telemetry': 0.0,
  'feature-flags': 0.0,
  'doc-health': 0.0,
  'human-approval': 0.0,
  'agent-evidence': 0.0,
};

interface ResolvedPolicy {
  passThreshold: number;
  failThreshold: number;
  maxListLength: number;
  requiredSources: string[];
  weights: ConfidencePolicy['weights'];
}

function resolvePolicy(p: ConfidencePolicy | undefined): ResolvedPolicy {
  const base = ConfidencePolicySchema.parse(p ?? {});
  return {
    passThreshold: base.passThreshold,
    failThreshold: base.failThreshold,
    maxListLength: base.maxListLength,
    requiredSources: base.requiredSources,
    weights: base.weights,
  };
}

function resolveWeight(item: EvidenceItem, policyWeights: Record<string, number> | undefined): number {
  if (policyWeights && item.source in policyWeights) {
    return policyWeights[item.source]!;
  }
  return item.weight > 0 ? item.weight : (DEFAULT_WEIGHTS[item.source] ?? 0.10);
}

function buildHonestyNote(item: EvidenceItem): string {
  const base = `'${item.source}' source`;
  if (item.applicability === 'not_applicable') {
    return `${base} is not applicable${item.reason ? ': ' + item.reason : ' for this subject'}.`;
  }
  if (item.applicability === 'unknown') {
    return `${base} could not produce a reliable score${item.reason ? ': ' + item.reason : ''}.`;
  }
  if (item.score === null) {
    return `${base} ran but returned a null score${item.reason ? ': ' + item.reason : ''}.`;
  }
  return `${base} has partial or degraded signal.`;
}

/**
 * Compute the fused Release Confidence result from an evidence bundle.
 *
 * Pure function — deterministic over the same input.
 */
export function computeReleaseConfidence(input: ConfidenceInput): ReleaseConfidence {
  const policy = resolvePolicy(input.policy);
  const now = new Date().toISOString();
  const limit = policy.maxListLength;

  // Partition evidence into applicable (score !== null) vs excluded.
  const applicable = input.evidence.filter(
    (item) =>
      (item.applicability ?? 'applicable') === 'applicable' &&
      item.score !== null &&
      !item.blocking
  );
  const excluded = input.evidence.filter(
    (item) =>
      (item.applicability ?? 'applicable') !== 'applicable' ||
      item.score === null
  );
  // Blocking items are evaluated separately from the score.
  const blockingItems = input.evidence.filter((item) => item.blocking);

  // Compute weighted score over applicable set.
  let confidenceScore: number | null = null;
  const weightSum = applicable.reduce((s, item) => s + resolveWeight(item, policy.weights), 0);
  if (weightSum > 0) {
    const numerator = applicable.reduce(
      (s, item) => s + (item.score ?? 0) * resolveWeight(item, policy.weights),
      0
    );
    confidenceScore = Math.round(numerator / weightSum);
  }

  // Build contributions (all evidence, not just applicable).
  const contributions = input.evidence.map((item) => {
    const w = resolveWeight(item, policy.weights);
    const isApplicableNonNull =
      (item.applicability ?? 'applicable') === 'applicable' &&
      item.score !== null &&
      !item.blocking;
    return {
      source: item.source,
      score: item.score,
      weight: w,
      effectiveWeight: isApplicableNonNull && weightSum > 0 ? w / weightSum : 0,
      applicability: item.applicability ?? 'applicable' as const,
      blocking: item.blocking ?? false,
    };
  });

  // Determine verdict.
  let verdict: ConfidenceVerdict = 'ship';
  const blockers: string[] = [];

  if (blockingItems.length > 0) {
    verdict = 'block';
    for (const b of blockingItems) {
      blockers.push(
        `'${b.source}' is a hard blocker${b.reason ? ': ' + b.reason : ''}.`
      );
    }
  } else if (confidenceScore === null) {
    verdict = 'block';
    blockers.push('No applicable evidence produced a score — nothing evaluable (honesty floor).');
  } else if (confidenceScore < policy.failThreshold) {
    verdict = 'hold';
  } else {
    // Check if any required source is 'unknown'.
    const unknownRequired = input.evidence.filter(
      (item) =>
        policy.requiredSources.includes(item.source) &&
        (item.applicability ?? 'applicable') === 'unknown'
    );
    if (unknownRequired.length > 0 || confidenceScore < policy.passThreshold) {
      verdict = 'caution';
    }
  }

  // Level / label from shared ladder.
  const { level, label } = scoreLevel(confidenceScore ?? 0);

  // Honesty notes — one per degraded/excluded source.
  const honestyNotes: string[] = [];
  for (const item of excluded) {
    honestyNotes.push(buildHonestyNote(item));
  }
  // Also note any blocking items that aren't in the excluded set.
  for (const item of blockingItems) {
    if ((item.applicability ?? 'applicable') === 'applicable' && item.score !== null) {
      honestyNotes.push(
        `'${item.source}' is a hard blocker${item.reason ? ': ' + item.reason : ''}.`
      );
    }
  }

  // Top risks — merge evidence across sources, severity-sorted by position.
  const allRisks: string[] = [
    ...blockingItems.flatMap((item) => item.evidence),
    ...input.evidence
      .filter((item) => (item.applicability ?? 'applicable') === 'applicable')
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
      .flatMap((item) => item.evidence),
  ];
  const topRisks = [...new Set(allRisks)].slice(0, limit);

  // Recommended next checks — merge and deduplicate.
  const allRecs: string[] = input.evidence.flatMap((item) => item.recommendations ?? []);
  const recommendedNextChecks = [...new Set(allRecs)].slice(0, limit);

  const result = {
    schemaVersion: 1 as const,
    computedAt: now,
    subject: input.subject,
    confidenceScore,
    verdict,
    level,
    label,
    contributions,
    topRisks,
    recommendedNextChecks,
    honestyNotes: honestyNotes.slice(0, limit),
    blockers,
    scoreFormula:
      'confidenceScore = round( Σ (score * weight) / Σ weight ) for applicable, non-null, non-blocking evidence only. ' +
      'not_applicable, unknown, and null-score items are excluded from the denominator but reported in contributions and honestyNotes.',
  };

  return ReleaseConfidenceSchema.parse(result);
}
