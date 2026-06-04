/**
 * CI-results evidence adapter (P4 — evidence collectors).
 *
 * Maps a CI run summary (test pass/fail counts, build status, optional flakiness
 * data) into an `EvidenceItem` for `computeReleaseConfidence`, using the
 * `ci-results` source kind reserved in confidence.schema.ts.
 *
 * Design:
 *   - Pure function — no I/O, no side effects. The caller owns fetching the CI data
 *     (e.g. from the `gh` API or a CI provider webhook); this adapter scores + maps.
 *   - Applicability:
 *       `applicable`     — a real run with ≥1 test executed
 *       `not_applicable` — no CI run on record for this ref (e.g. no CI configured)
 *       `unknown`        — run exists but results are incomplete/in-progress
 *   - Score formula: pass-rate * build-weight * freshness-factor
 *       pass-rate     = passed / (passed + failed + errored)  [0..1]
 *       build-weight  = 0.85 if build succeeded, 0.0 if build failed (a build failure
 *                       overrides the test pass-rate — tests that never ran are not "passing")
 *       freshness      = 1.0 when ageSeconds < FRESH_THRESHOLD, decaying linearly to
 *                       MIN_FRESHNESS over STALE_THRESHOLD. Beyond STALE_THRESHOLD the
 *                       applicability is coerced to `unknown` (matches §2.6 rule 3 of the spec).
 *   - A build failure OR 0 tests passing marks evidence ['critical'] and forces a
 *     blocking recommendation (the aggregator uses recommendations for narrative).
 *   - Multi-tenant: tenantId flows through unchanged (caller sets it on the EvidenceItem
 *     via the `collector.tool` string; the full tenant stamp is the subject, not the item).
 */

import type { EvidenceItem, EvidenceSourceKind } from '../schemas/confidence.schema.js';

// Freshness constants (seconds). Configurable at call-site via CiRunInput.
const DEFAULT_FRESH_THRESHOLD_S = 60 * 60 * 4; // 4 h
const DEFAULT_STALE_THRESHOLD_S = 60 * 60 * 24; // 24 h
const MIN_FRESHNESS = 0.5; // floor before we coerce to unknown

const CI_WEIGHT = 0.10; // matches DEFAULT_WEIGHTS['ci-results'] in confidence.ts

/**
 * Raw CI run data the caller provides (from `gh run view --json`, provider API, etc.).
 * Only the counts matter for scoring; everything else is for evidence strings + provenance.
 */
export interface CiRunInput {
  /** ISO-8601 timestamp when the run completed. */
  completedAt: string;
  /** Whether the CI build step itself succeeded (compilation, lint, etc. — before tests). */
  buildPassed: boolean;
  /** Number of test cases that passed. */
  testsPassed: number;
  /** Number of test cases that failed (hard). */
  testsFailed: number;
  /** Number of test cases that errored (infra/setup failure, not assertion failure). */
  testsErrored: number;
  /**
   * Optional: number of tests that were flaky (passed on retry). Presence lowers score
   * slightly but doesn't fail the run — flaky tests are a warn, not a block.
   */
  testsFlaky?: number;
  /**
   * Optional: CI provider URL for the run (e.g. `https://github.com/…/actions/runs/…`).
   * Never fabricated — omit rather than invent.
   */
  runUrl?: string;
  /** Optional: CI workflow/pipeline name for the evidence string. */
  workflowName?: string;
  /**
   * Optional: collector freshness budget override (seconds). Defaults to 24 h for stale.
   */
  staleAfterSeconds?: number;
}

/**
 * Produce a `ci-results` EvidenceItem from a raw CI run summary.
 *
 * Deterministic and pure. Returns `not_applicable` when the run is absent, `unknown`
 * when stale or incomplete, and `applicable` with a real score otherwise.
 */
export function ciResultsToEvidence(run: CiRunInput, collectedAt?: string): EvidenceItem {
  const now = collectedAt ?? new Date().toISOString();
  const source: EvidenceSourceKind = 'ci-results';
  const weight = CI_WEIGHT;

  // Freshness computation.
  const ageMs = Date.parse(now) - Date.parse(run.completedAt);
  const ageS = Math.max(0, ageMs / 1000);
  const staleThreshold = run.staleAfterSeconds ?? DEFAULT_STALE_THRESHOLD_S;

  if (ageS > staleThreshold) {
    return {
      source,
      score: 0,
      weight,
      applicability: 'unknown',
      blocking: false,
      evidence: [
        `CI run completed at ${run.completedAt} — stale (${Math.round(ageS / 3600)}h > ${staleThreshold / 3600}h threshold).`,
      ],
      recommendations: ['Re-run CI against the current commit before shipping.'],
      reason: `CI run is stale (${Math.round(ageS / 3600)}h old, threshold ${staleThreshold / 3600}h).`,
      collectedAt: now,
      collector: { tool: 'qulib.ci-results-adapter' },
    };
  }

  const total = run.testsPassed + run.testsFailed + run.testsErrored;

  // Build failure: tests may not even have run — score 0, blocking recommendation.
  if (!run.buildPassed) {
    const evidence = [`Build FAILED (${run.workflowName ?? 'CI workflow'}).`];
    if (total > 0) evidence.push(`${run.testsPassed}/${total} tests passed before build failure.`);
    if (run.runUrl) evidence.push(`Run: ${run.runUrl}`);
    return {
      source,
      score: 0,
      weight,
      applicability: 'applicable',
      blocking: false, // the aggregator decides blocking; we report honestly
      evidence,
      recommendations: ['Fix the build failure before shipping.'],
      collectedAt: now,
      collector: { tool: 'qulib.ci-results-adapter', inputRef: run.runUrl },
    };
  }

  // No tests ran at all — cannot score honestly.
  if (total === 0) {
    return {
      source,
      score: 0,
      weight,
      applicability: 'unknown',
      blocking: false,
      evidence: [
        `Build passed (${run.workflowName ?? 'CI workflow'}) but 0 tests executed.`,
        ...(run.runUrl ? [`Run: ${run.runUrl}`] : []),
      ],
      recommendations: ['Add a test suite to CI for a meaningful confidence signal.'],
      reason: 'Build passed but zero tests were executed — no test signal.',
      collectedAt: now,
      collector: { tool: 'qulib.ci-results-adapter', inputRef: run.runUrl },
    };
  }

  // Normal case: compute pass-rate.
  const passRate = run.testsPassed / total; // 0..1
  const freshnessRatio =
    ageS <= DEFAULT_FRESH_THRESHOLD_S
      ? 1.0
      : MIN_FRESHNESS +
        (1 - MIN_FRESHNESS) *
          (1 - (ageS - DEFAULT_FRESH_THRESHOLD_S) / (staleThreshold - DEFAULT_FRESH_THRESHOLD_S));
  const rawScore = passRate * freshnessRatio;
  const score = Math.round(Math.max(0, Math.min(100, rawScore * 100)));

  const evidence: string[] = [];
  evidence.push(
    `${run.testsPassed}/${total} tests passed` +
      (run.testsFailed > 0 ? ` (${run.testsFailed} failed)` : '') +
      (run.testsErrored > 0 ? ` (${run.testsErrored} errored)` : '') +
      ` — ${Math.round(passRate * 100)}% pass-rate.`
  );
  if (run.workflowName) evidence.push(`Workflow: ${run.workflowName}.`);
  if (run.testsFlaky && run.testsFlaky > 0) {
    evidence.push(`${run.testsFlaky} test(s) flaky (passed on retry).`);
  }
  if (run.runUrl) evidence.push(`Run: ${run.runUrl}`);
  if (freshnessRatio < 1.0) {
    evidence.push(`Freshness factor ${freshnessRatio.toFixed(2)} applied (run age ${Math.round(ageS / 3600)}h).`);
  }

  const recommendations: string[] = [];
  if (run.testsFailed > 0) recommendations.push(`Fix ${run.testsFailed} failing test(s) before shipping.`);
  if (run.testsErrored > 0) recommendations.push(`Investigate ${run.testsErrored} errored test(s) (infra/setup).`);
  if (run.testsFlaky && run.testsFlaky > 0) {
    recommendations.push(`Stabilize ${run.testsFlaky} flaky test(s) to improve signal quality.`);
  }

  return {
    source,
    score,
    weight,
    applicability: 'applicable',
    blocking: false,
    evidence,
    recommendations,
    collectedAt: now,
    collector: { tool: 'qulib.ci-results-adapter', inputRef: run.runUrl },
  };
}
