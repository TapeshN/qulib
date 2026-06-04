/**
 * PR-metadata evidence adapter (P4 — evidence collectors).
 *
 * Maps a pull-request review/checks payload (as returned by `gh pr view --json
 * reviewDecision,statusCheckRollup,mergeable,number,url,additions,deletions`)
 * into an `EvidenceItem` for `computeReleaseConfidence`, using the
 * `deploy-metadata` source kind — the closest P3-reserved kind for
 * PR-level ship-readiness.
 *
 * Design:
 *   - Pure function. The caller fetches the `gh` JSON; this adapter scores it.
 *   - Applicability:
 *       `applicable`     — a PR exists and review/check state is readable
 *       `not_applicable` — no PR for this ref (direct push, script, etc.)
 *       `unknown`        — PR exists but checks are still pending / state ambiguous
 *   - Score formula (0..100):
 *       Base 60 points:  PR is open and merge-ready (no conflicts)
 *       +20: reviewDecision === 'APPROVED'
 *       +20: all status checks pass (statusCheckRollup every entry state === 'SUCCESS')
 *       Deductions:
 *         -10: any failing status check  (per failing check, capped at 20)
 *         -15: reviewDecision === 'CHANGES_REQUESTED'
 *   - The adapter NEVER fabricates a PR number or URL; if absent from the payload
 *     the evidence strings omit them (WAVE-GUARDRAILS: no fabricated data).
 */

import type { EvidenceItem, EvidenceSourceKind } from '../schemas/confidence.schema.js';

const PR_META_WEIGHT = 0.07; // conservative; real weight rebalanced by the aggregator

/**
 * Status-check entry shape from `gh pr view --json statusCheckRollup`.
 * Only the fields we actually use — extra fields are harmlessly ignored.
 */
export interface StatusCheck {
  /** e.g. "SUCCESS", "FAILURE", "PENDING", "SKIPPED", "NEUTRAL" */
  state: string;
  /** CI job/check name — optional, used for the evidence string */
  name?: string;
  /** Direct URL to the check — never fabricated; omit rather than invent */
  targetUrl?: string;
}

/** GitHub review decision values as returned by the `gh` CLI. */
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null | undefined;

/** Mergeable state as returned by `gh pr view --json mergeable`. */
export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null | undefined;

/**
 * Raw PR payload the caller provides. All fields are optional — the adapter
 * degrades gracefully when partial data is available.
 */
export interface PrMetadataInput {
  /** PR number. Never fabricated — omit if absent. */
  number?: number;
  /** PR URL. Never fabricated — omit if absent. */
  url?: string;
  /** Review decision from the `gh` response. null/undefined = no review yet. */
  reviewDecision?: ReviewDecision;
  /** Array of status check entries (the `statusCheckRollup` field). */
  statusCheckRollup?: StatusCheck[];
  /**
   * Whether the PR is currently mergeable (no conflicts).
   * null/UNKNOWN counts as unknown-state.
   */
  mergeable?: MergeableState;
  /** ISO-8601 when this payload was collected. Defaults to now. */
  collectedAt?: string;
  /**
   * Set to true when there is explicitly NO PR for this ref (e.g. direct push).
   * Produces a `not_applicable` contribution so the aggregator abstains honestly.
   */
  noPr?: boolean;
}

/**
 * Produce a `deploy-metadata` EvidenceItem from a PR metadata payload.
 * Returns `not_applicable` when `noPr` is true, `unknown` when checks are
 * pending or state is ambiguous, and `applicable` with a real score otherwise.
 */
export function prMetadataToEvidence(input: PrMetadataInput, collectedAt?: string): EvidenceItem {
  const now = collectedAt ?? input.collectedAt ?? new Date().toISOString();
  const source: EvidenceSourceKind = 'deploy-metadata';
  const weight = PR_META_WEIGHT;

  // Explicit no-PR case.
  if (input.noPr) {
    return {
      source,
      score: 0,
      weight,
      applicability: 'not_applicable',
      blocking: false,
      evidence: ['No pull request exists for this ref (direct push or pre-PR state).'],
      recommendations: [],
      reason: 'No PR for this ref — PR review and check signal not applicable.',
      collectedAt: now,
      collector: { tool: 'qulib.pr-metadata-adapter' },
    };
  }

  const prLabel = input.number != null ? `PR #${input.number}` : 'PR';
  const prRef = input.url ?? null;

  // Checks-pending / UNKNOWN mergeable → unknown applicability (cannot score honestly).
  const allChecks = input.statusCheckRollup ?? [];
  const pending = allChecks.filter((c) => c.state === 'PENDING');
  if (
    (pending.length > 0 && allChecks.length > 0 && pending.length === allChecks.length) ||
    input.mergeable === 'UNKNOWN'
  ) {
    const evidence: string[] = [
      `${prLabel}: status checks still pending (${pending.length}/${allChecks.length}).`,
      ...(prRef ? [`${prRef}`] : []),
    ];
    return {
      source,
      score: 0,
      weight,
      applicability: 'unknown',
      blocking: false,
      evidence,
      recommendations: ['Wait for all status checks to complete before shipping.'],
      reason: `${prLabel} checks are still pending — cannot score PR readiness honestly.`,
      collectedAt: now,
      collector: { tool: 'qulib.pr-metadata-adapter', inputRef: prRef ?? undefined },
    };
  }

  // Score computation.
  let score = 60; // base: a PR exists and is evaluable

  // Mergeability.
  if (input.mergeable === 'CONFLICTING') {
    score -= 30; // merge conflicts are a hard deduction
  }

  // Review decision.
  const rd = input.reviewDecision;
  if (rd === 'APPROVED') {
    score += 20;
  } else if (rd === 'CHANGES_REQUESTED') {
    score -= 15;
  }
  // REVIEW_REQUIRED or null/undefined: no bonus, no deduction (reviewer not yet assigned)

  // Status checks.
  const passing = allChecks.filter((c) => c.state === 'SUCCESS' || c.state === 'NEUTRAL' || c.state === 'SKIPPED');
  const failing = allChecks.filter((c) => c.state === 'FAILURE' || c.state === 'ERROR');

  if (allChecks.length > 0 && failing.length === 0) {
    score += 20; // all checks green
  }
  // Deduct per failing check (capped at −20).
  score -= Math.min(20, failing.length * 10);

  score = Math.max(0, Math.min(100, score));

  // Build evidence strings — never fabricated.
  const evidence: string[] = [];
  const reviewStr = rd === 'APPROVED'
    ? 'APPROVED'
    : rd === 'CHANGES_REQUESTED'
      ? 'CHANGES_REQUESTED'
      : rd === 'REVIEW_REQUIRED'
        ? 'REVIEW_REQUIRED'
        : 'no review yet';
  const mergeStr =
    input.mergeable === 'MERGEABLE'
      ? 'mergeable'
      : input.mergeable === 'CONFLICTING'
        ? 'CONFLICTING (merge conflicts)'
        : 'merge state unknown';

  evidence.push(`${prLabel}: review=${reviewStr}, ${mergeStr}.`);

  if (allChecks.length > 0) {
    evidence.push(
      `Status checks: ${passing.length} passed, ${failing.length} failed, ${pending.length} pending of ${allChecks.length} total.`
    );
    for (const f of failing.slice(0, 3)) {
      evidence.push(`  Check FAILED: ${f.name ?? 'unnamed'}${f.targetUrl ? ` (${f.targetUrl})` : ''}`);
    }
  } else {
    evidence.push('No status checks configured for this PR.');
  }

  if (prRef) evidence.push(prRef);

  // Recommendations.
  const recommendations: string[] = [];
  if (rd === 'CHANGES_REQUESTED') recommendations.push('Address review comments before shipping.');
  if (rd === 'REVIEW_REQUIRED' || rd == null) recommendations.push('Request and obtain PR approval before shipping.');
  if (failing.length > 0) recommendations.push(`Fix ${failing.length} failing status check(s) before merging.`);
  if (input.mergeable === 'CONFLICTING') recommendations.push('Resolve merge conflicts before shipping.');

  return {
    source,
    score,
    weight,
    applicability: 'applicable',
    blocking: false,
    evidence,
    recommendations,
    collectedAt: now,
    collector: { tool: 'qulib.pr-metadata-adapter', inputRef: prRef ?? undefined },
  };
}
