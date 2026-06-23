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
  EvidenceSourceKind,
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

/** Model sources with non-zero default weight — the full evidence model for partial-run disclosure. */
const MODEL_SOURCES: EvidenceSourceKind[] = (
  Object.entries(DEFAULT_WEIGHTS)
    .filter(([, weight]) => weight > 0)
    .map(([source]) => source) as EvidenceSourceKind[]
);

const UNCOLLECTED_NEXT_CHECKS: Record<string, string> = {
  'live-app-quality': 'Run analyze_app against the deployed URL to collect live-app quality evidence.',
  'accessibility': 'Run analyze_app against the deployed URL to evaluate accessibility.',
  'crawl-coverage': 'Run analyze_app against the deployed URL to measure crawl coverage.',
  'test-automation': 'Run qulib score-automation against the repo to score test automation maturity.',
  'api-coverage': 'Run qulib score-api against the repo to measure API test coverage.',
  'ci-results': 'Ingest CI status from your pipeline (ci-results source not yet wired).',
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

function resolveModelWeight(source: string, policyWeights: Record<string, number> | undefined): number {
  if (policyWeights && source in policyWeights) {
    return policyWeights[source]!;
  }
  return DEFAULT_WEIGHTS[source] ?? 0;
}

function inferUncollectedReason(
  source: string,
  presentSources: Set<string>
): string {
  const hasAnalyzeEvidence =
    presentSources.has('live-app-quality') ||
    presentSources.has('accessibility') ||
    presentSources.has('crawl-coverage');
  const hasRepoEvidence =
    presentSources.has('test-automation') || presentSources.has('api-coverage');

  switch (source) {
    case 'live-app-quality':
    case 'accessibility':
    case 'crawl-coverage':
      return hasAnalyzeEvidence
        ? 'not collected in this confidence run'
        : 'app-runtime analysis not run — no url provided';
    case 'test-automation':
    case 'api-coverage':
      return hasRepoEvidence
        ? 'not collected in this confidence run'
        : 'repo scoring not run — no repo provided';
    case 'ci-results':
      return 'CI status not ingested — no ci-results source wired';
    default:
      return 'not collected';
  }
}

function buildUncollectedHonestyNote(source: string, reason: string, rawWeight: number): string {
  const pct = Math.round(rawWeight * 100);
  return `'${source}' not collected (${pct}% raw model weight): ${reason}.`;
}

function buildCoverageSummaryNote(
  scoredSourceCount: number,
  modelSourceCount: number,
  rawWeightScored: number,
  rawWeightModel: number
): string {
  const coveragePct = rawWeightModel > 0 ? Math.round((rawWeightScored / rawWeightModel) * 100) : 0;
  return (
    `Partial evidence: verdict computed on ${scoredSourceCount} of ${modelSourceCount} model sources ` +
    `(~${coveragePct}% of raw model weight). Collected weights were renormalized to 100% for the score.`
  );
}

function isPositiveEvidence(text: string): boolean {
  if (/appear covered/i.test(text)) return true;
  if (/Automation maturity: L\d/i.test(text)) return true;
  if (/No a11y gaps/i.test(text)) return true;
  if (/^L\d —/i.test(text)) return true;
  if (/^releaseConfidence=/i.test(text)) return true;
  if (/^coverageScore=/i.test(text)) return true;
  if (/^No .* gaps detected/i.test(text)) return true;
  return false;
}

function extractItemRisks(item: EvidenceItem, passThreshold: number): string[] {
  const risks: string[] = [];

  if (item.blocking) {
    if (item.reason) risks.push(item.reason);
    risks.push(...item.evidence.filter((entry) => !isPositiveEvidence(entry)));
    return risks;
  }

  const applicability = item.applicability ?? 'applicable';
  if (applicability === 'unknown' || item.score === null) {
    if (item.reason) risks.push(`${item.source}: ${item.reason}`);
    risks.push(
      ...item.evidence.filter(
        (entry) => !isPositiveEvidence(entry) && /(gap|critical|high|untested|uncovered|missing|block|fail|warning|auth|blocked)/i.test(entry)
      )
    );
    return risks;
  }

  if (applicability === 'not_applicable') {
    if (item.reason) risks.push(`${item.source}: ${item.reason}`);
    return risks;
  }

  if (item.score !== null && item.score < passThreshold) {
    risks.push(...item.evidence.filter((entry) => !isPositiveEvidence(entry)));
    if (item.score < passThreshold) {
      risks.push(`${item.source} scored ${item.score}/100 — below pass threshold (${passThreshold}).`);
    }
  } else {
    risks.push(
      ...item.evidence.filter(
        (entry) =>
          !isPositiveEvidence(entry) &&
          /(gap|critical|high|untested|uncovered|missing|block|fail|warning|penalty|below)/i.test(entry)
      )
    );
  }

  return risks;
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

  const presentSources = new Set(input.evidence.map((item) => item.source));
  const uncollectedSources = MODEL_SOURCES.filter((source) => !presentSources.has(source));
  const modelWeightSum = MODEL_SOURCES.reduce(
    (sum, source) => sum + resolveModelWeight(source, policy.weights),
    0
  );

  // Honesty notes — partial-run summary first, then uncollected, then degraded/excluded collected sources.
  const honestyNotes: string[] = [];
  if (uncollectedSources.length > 0 || (weightSum > 0 && weightSum < modelWeightSum - 0.001)) {
    honestyNotes.push(
      buildCoverageSummaryNote(applicable.length, MODEL_SOURCES.length, weightSum, modelWeightSum)
    );
  }
  for (const source of uncollectedSources) {
    const rawWeight = resolveModelWeight(source, policy.weights);
    const reason = inferUncollectedReason(source, presentSources);
    honestyNotes.push(buildUncollectedHonestyNote(source, reason, rawWeight));
  }
  for (const item of excluded) {
    honestyNotes.push(buildHonestyNote(item));
  }
  for (const item of blockingItems) {
    if ((item.applicability ?? 'applicable') === 'applicable' && item.score !== null) {
      honestyNotes.push(
        `'${item.source}' is a hard blocker${item.reason ? ': ' + item.reason : ''}.`
      );
    }
  }

  // Top risks — gaps and blockers only; never surface coverage successes as risks.
  const allRisks: string[] = [];
  for (const source of uncollectedSources) {
    const rawWeight = resolveModelWeight(source, policy.weights);
    if (rawWeight >= 0.10) {
      const reason = inferUncollectedReason(source, presentSources);
      allRisks.push(
        `Uncollected high-weight evidence: ${source} (${Math.round(rawWeight * 100)}% raw weight) — ${reason}.`
      );
    }
  }
  for (const item of blockingItems) {
    allRisks.push(...extractItemRisks(item, policy.passThreshold));
  }
  for (const item of [...excluded].sort((a, b) => resolveWeight(a, policy.weights) - resolveWeight(b, policy.weights))) {
    allRisks.push(...extractItemRisks(item, policy.passThreshold));
  }
  for (const item of [...applicable].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))) {
    allRisks.push(...extractItemRisks(item, policy.passThreshold));
  }
  const topRisks = [...new Set(allRisks.filter(Boolean))].slice(0, limit);

  // Recommended next checks — concrete actions for uncollected sources plus per-item recommendations.
  const allRecs: string[] = [];
  for (const source of uncollectedSources) {
    const rec = UNCOLLECTED_NEXT_CHECKS[source];
    if (rec) allRecs.push(rec);
  }
  allRecs.push(...input.evidence.flatMap((item) => item.recommendations ?? []));
  const recommendedNextChecks = [...new Set(allRecs.filter(Boolean))].slice(0, limit);

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
