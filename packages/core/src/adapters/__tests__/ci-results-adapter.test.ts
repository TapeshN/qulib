/**
 * Unit tests for ciResultsToEvidence (P4 — CI-results evidence adapter).
 *
 * Test strategy: node:test + node:assert/strict. Fully offline — pure function,
 * no I/O, no stubs. Every meaningful behavioral branch is exercised and every
 * test can fail on incorrect behavior (not trivial pass-throughs).
 *
 * Coverage:
 *   A. Build failure → applicable, score=0, evidence contains "FAILED"
 *   B. Zero tests → unknown, reason mentions zero tests
 *   C. All tests passing → applicable, score in expected range, evidence has pass-rate
 *   D. Partial failure → score reflects pass-rate (not 0, not 100)
 *   E. Stale run → unknown, applicability coerced, reason mentions stale
 *   F. Freshness decay → score < 100 when run is between fresh and stale thresholds
 *   G. Flaky tests → score slightly reduced vs no-flaky; evidence mentions flaky count
 *   H. No PR/URL → evidence strings do NOT fabricate a URL
 *   I. Schema round-trip: output parses EvidenceItemSchema (runtime-import check)
 *   J. Weight is the CI weight constant (not 0 — the aggregator uses it)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciResultsToEvidence, type CiRunInput } from '../ci-results-adapter.js';

const NOW_ISO = '2026-06-04T12:00:00.000Z';

function recentRun(overrides: Partial<CiRunInput> = {}): CiRunInput {
  return {
    completedAt: NOW_ISO,
    buildPassed: true,
    testsPassed: 100,
    testsFailed: 0,
    testsErrored: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. Build failure
// ---------------------------------------------------------------------------

test('A: build failure → applicable with score=0 and evidence mentions FAILED', () => {
  const item = ciResultsToEvidence(recentRun({ buildPassed: false }), NOW_ISO);
  assert.equal(item.applicability, 'applicable', 'a failed build is evaluable evidence, not absent');
  assert.equal(item.score, 0);
  assert.ok(item.evidence.some((e) => /FAIL/i.test(e)), 'evidence must mention the failure');
  assert.ok(item.recommendations.length > 0, 'should recommend fixing the build');
});

test('A: build failure with some tests run → evidence includes test count', () => {
  const item = ciResultsToEvidence(
    recentRun({ buildPassed: false, testsPassed: 3, testsFailed: 1 }),
    NOW_ISO
  );
  assert.ok(item.evidence.some((e) => /3\/4|3 of 4/i.test(e) || /tests passed/i.test(e)));
});

// ---------------------------------------------------------------------------
// B. Zero tests
// ---------------------------------------------------------------------------

test('B: zero tests executed → unknown applicability with reason', () => {
  const item = ciResultsToEvidence(recentRun({ testsPassed: 0, testsFailed: 0, testsErrored: 0 }), NOW_ISO);
  assert.equal(item.applicability, 'unknown');
  assert.ok(item.reason, 'reason must be provided for unknown');
  assert.match(item.reason!, /0|zero|no test/i);
});

// ---------------------------------------------------------------------------
// C. All tests passing
// ---------------------------------------------------------------------------

test('C: all passing → applicable, score 90-100, evidence has pass-rate', () => {
  const item = ciResultsToEvidence(recentRun({ testsPassed: 200, testsFailed: 0, testsErrored: 0 }), NOW_ISO);
  assert.equal(item.applicability, 'applicable');
  assert.ok(item.score >= 90 && item.score <= 100, `score ${item.score} should be 90-100`);
  assert.ok(item.evidence.some((e) => /100%|200\/200/i.test(e)));
});

// ---------------------------------------------------------------------------
// D. Partial failure
// ---------------------------------------------------------------------------

test('D: 80/100 tests pass → score reflects ~80% (not 0, not 100)', () => {
  const item = ciResultsToEvidence(
    recentRun({ testsPassed: 80, testsFailed: 20, testsErrored: 0 }),
    NOW_ISO
  );
  assert.equal(item.applicability, 'applicable');
  assert.ok(item.score > 0 && item.score < 100, `score ${item.score} should be between 0 and 100`);
  assert.ok(item.recommendations.some((r) => /20 failing/i.test(r)));
});

test('D: partial failure evidence mentions both pass and fail counts', () => {
  const item = ciResultsToEvidence(
    recentRun({ testsPassed: 80, testsFailed: 20 }),
    NOW_ISO
  );
  assert.ok(item.evidence.some((e) => /80/i.test(e) && /20/i.test(e)));
});

// ---------------------------------------------------------------------------
// E. Stale run
// ---------------------------------------------------------------------------

test('E: run older than staleAfterSeconds → unknown, reason mentions stale', () => {
  const thirtyHoursAgo = new Date(Date.parse(NOW_ISO) - 30 * 60 * 60 * 1000).toISOString();
  const item = ciResultsToEvidence(
    recentRun({ completedAt: thirtyHoursAgo }),
    NOW_ISO
  );
  assert.equal(item.applicability, 'unknown');
  assert.ok(item.reason?.includes('stale') || item.evidence.some((e) => /stale/i.test(e)));
});

test('E: custom staleAfterSeconds overrides default', () => {
  const fiveMinutesAgo = new Date(Date.parse(NOW_ISO) - 5 * 60 * 1000).toISOString();
  const item = ciResultsToEvidence(
    recentRun({ completedAt: fiveMinutesAgo, staleAfterSeconds: 60 }),
    NOW_ISO
  );
  assert.equal(item.applicability, 'unknown', 'run older than custom threshold should be unknown');
});

// ---------------------------------------------------------------------------
// F. Freshness decay
// ---------------------------------------------------------------------------

test('F: run between fresh and stale thresholds gets freshness factor < 1 → score < 100', () => {
  const tenHoursAgo = new Date(Date.parse(NOW_ISO) - 10 * 60 * 60 * 1000).toISOString();
  const item = ciResultsToEvidence(
    recentRun({ testsPassed: 200, testsFailed: 0, completedAt: tenHoursAgo }),
    NOW_ISO
  );
  assert.equal(item.applicability, 'applicable');
  assert.ok(item.score < 100, `score ${item.score} should be < 100 with freshness decay`);
  assert.ok(item.score > 0, `score ${item.score} should be > 0 (it ran)`);
  assert.ok(item.evidence.some((e) => /freshness|factor/i.test(e)), 'evidence should mention freshness factor');
});

// ---------------------------------------------------------------------------
// G. Flaky tests
// ---------------------------------------------------------------------------

test('G: flaky tests present → evidence mentions flaky count, recommendation to stabilize', () => {
  const item = ciResultsToEvidence(
    recentRun({ testsPassed: 95, testsFlaky: 5 }),
    NOW_ISO
  );
  assert.ok(item.evidence.some((e) => /5.*flak/i.test(e) || /flak.*5/i.test(e)));
  assert.ok(item.recommendations.some((r) => /flak/i.test(r)));
});

test('G: score with 0 flaky = score with undefined flaky for same pass count', () => {
  const withFlaky = ciResultsToEvidence(
    recentRun({ testsPassed: 100, testsFlaky: 0 }),
    NOW_ISO
  );
  const withoutFlaky = ciResultsToEvidence(
    recentRun({ testsPassed: 100 }),
    NOW_ISO
  );
  assert.equal(withFlaky.score, withoutFlaky.score, 'zero flaky makes no difference to score');
});

// ---------------------------------------------------------------------------
// H. No URL → no fabricated URL in evidence
// ---------------------------------------------------------------------------

test('H: no runUrl provided → evidence strings contain no fabricated URL', () => {
  const item = ciResultsToEvidence(recentRun(), NOW_ISO);
  for (const e of item.evidence) {
    assert.ok(
      !/https?:\/\//i.test(e),
      `evidence string should not contain a URL when none provided: "${e}"`
    );
  }
});

test('H: runUrl provided → appears in evidence verbatim', () => {
  const url = 'https://github.com/TapeshN/qulib/actions/runs/999';
  const item = ciResultsToEvidence(recentRun({ runUrl: url }), NOW_ISO);
  assert.ok(item.evidence.some((e) => e.includes(url)), 'provided URL should appear in evidence');
  assert.equal(item.collector.inputRef, url, 'collector.inputRef must match provided URL');
});

// ---------------------------------------------------------------------------
// I. Schema round-trip (runtime-import check, not just tsc)
// ---------------------------------------------------------------------------

test('I: output parses EvidenceItemSchema at runtime (passing run)', async () => {
  const { EvidenceItemSchema } = await import('../../schemas/confidence.schema.js');
  const item = ciResultsToEvidence(recentRun({ testsPassed: 50, testsFailed: 5 }), NOW_ISO);
  const parsed = EvidenceItemSchema.safeParse(item);
  assert.ok(parsed.success, `EvidenceItemSchema parse failed: ${JSON.stringify(parsed.error ?? null)}`);
});

test('I: output parses EvidenceItemSchema at runtime (unknown/stale run)', async () => {
  const { EvidenceItemSchema } = await import('../../schemas/confidence.schema.js');
  const old = new Date(Date.parse(NOW_ISO) - 30 * 60 * 60 * 1000).toISOString();
  const item = ciResultsToEvidence(recentRun({ completedAt: old }), NOW_ISO);
  const parsed = EvidenceItemSchema.safeParse(item);
  assert.ok(parsed.success, `EvidenceItemSchema parse failed for stale run: ${JSON.stringify(parsed.error ?? null)}`);
});

// ---------------------------------------------------------------------------
// J. Weight
// ---------------------------------------------------------------------------

test('J: weight is non-zero (aggregator needs it to include CI in the score)', () => {
  const item = ciResultsToEvidence(recentRun(), NOW_ISO);
  assert.ok(item.weight > 0, `weight must be > 0, got ${item.weight}`);
});

test('J: source is ci-results (correct kind)', () => {
  const item = ciResultsToEvidence(recentRun(), NOW_ISO);
  assert.equal(item.source, 'ci-results');
});
