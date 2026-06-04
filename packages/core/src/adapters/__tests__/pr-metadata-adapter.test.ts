/**
 * Unit tests for prMetadataToEvidence (P4 — PR-metadata evidence adapter).
 *
 * Test strategy: node:test + node:assert/strict. Fully offline — pure function.
 * Every test asserts a behavior that can fail; no trivial smoke checks.
 *
 * Coverage:
 *   A. noPr=true → not_applicable with reason
 *   B. All checks pending → unknown applicability, reason mentions pending
 *   C. APPROVED + all checks green + mergeable → high score (>= 95)
 *   D. CHANGES_REQUESTED → score deducted, recommendation to address review
 *   E. Failing status checks → score deducted, evidence lists failed checks
 *   F. CONFLICTING merge state → score deducted, recommendation to resolve
 *   G. No URL provided → evidence strings do not fabricate a URL
 *   H. PR number + URL in evidence when provided
 *   I. Schema round-trip: output parses EvidenceItemSchema (runtime-import check)
 *   J. Source is deploy-metadata and weight is non-zero
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prMetadataToEvidence, type PrMetadataInput, type StatusCheck } from '../pr-metadata-adapter.js';

const NOW_ISO = '2026-06-04T12:00:00.000Z';

function greenChecks(n = 3): StatusCheck[] {
  return Array.from({ length: n }, (_, i) => ({ state: 'SUCCESS', name: `check-${i + 1}` }));
}

function base(overrides: Partial<PrMetadataInput> = {}): PrMetadataInput {
  return {
    number: 42,
    url: 'https://github.com/TapeshN/qulib/pull/42',
    reviewDecision: 'APPROVED',
    statusCheckRollup: greenChecks(3),
    mergeable: 'MERGEABLE',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. No PR
// ---------------------------------------------------------------------------

test('A: noPr=true → not_applicable with reason', () => {
  const item = prMetadataToEvidence({ noPr: true });
  assert.equal(item.applicability, 'not_applicable');
  assert.ok(item.reason, 'reason must be present for not_applicable');
  assert.match(item.reason!, /no pr|no pull request/i);
});

// ---------------------------------------------------------------------------
// B. All checks pending
// ---------------------------------------------------------------------------

test('B: all checks pending → unknown applicability, reason mentions pending', () => {
  const pending: StatusCheck[] = [
    { state: 'PENDING', name: 'build' },
    { state: 'PENDING', name: 'test' },
  ];
  const item = prMetadataToEvidence(base({ statusCheckRollup: pending }), NOW_ISO);
  assert.equal(item.applicability, 'unknown');
  assert.ok(item.reason, 'reason required for unknown');
  assert.match(item.reason!, /pending/i);
});

// ---------------------------------------------------------------------------
// C. Fully green
// ---------------------------------------------------------------------------

test('C: APPROVED + all green checks + MERGEABLE → score >= 95', () => {
  const item = prMetadataToEvidence(base(), NOW_ISO);
  assert.equal(item.applicability, 'applicable');
  assert.ok(item.score >= 95, `score ${item.score} should be >= 95 for a perfect PR`);
});

test('C: evidence mentions approval status', () => {
  const item = prMetadataToEvidence(base(), NOW_ISO);
  assert.ok(item.evidence.some((e) => /APPROVED/i.test(e)));
});

// ---------------------------------------------------------------------------
// D. CHANGES_REQUESTED
// ---------------------------------------------------------------------------

test('D: CHANGES_REQUESTED → score deducted vs APPROVED baseline', () => {
  const changesRequested = prMetadataToEvidence(base({ reviewDecision: 'CHANGES_REQUESTED' }), NOW_ISO);
  const approved = prMetadataToEvidence(base({ reviewDecision: 'APPROVED' }), NOW_ISO);
  assert.ok(changesRequested.score < approved.score, 'CHANGES_REQUESTED must lower the score');
  assert.ok(changesRequested.recommendations.some((r) => /address|review|comment/i.test(r)));
});

test('D: CHANGES_REQUESTED appears in evidence', () => {
  const item = prMetadataToEvidence(base({ reviewDecision: 'CHANGES_REQUESTED' }), NOW_ISO);
  assert.ok(item.evidence.some((e) => /CHANGES_REQUESTED/i.test(e)));
});

// ---------------------------------------------------------------------------
// E. Failing status checks
// ---------------------------------------------------------------------------

test('E: one failing check → score lower than all-green, evidence mentions failure', () => {
  const checks: StatusCheck[] = [
    { state: 'SUCCESS', name: 'lint' },
    { state: 'FAILURE', name: 'tests', targetUrl: 'https://ci.example.com/run/1' },
  ];
  const item = prMetadataToEvidence(base({ statusCheckRollup: checks }), NOW_ISO);
  const allGreen = prMetadataToEvidence(base(), NOW_ISO);
  assert.ok(item.score < allGreen.score, 'failing check must lower score');
  assert.ok(item.evidence.some((e) => /tests.*FAIL|FAIL.*tests/i.test(e) || /1 fail/i.test(e)));
  assert.ok(item.recommendations.some((r) => /fix.*check|failing.*check/i.test(r)));
});

test('E: failing check URL appears in evidence when provided (not fabricated)', () => {
  const url = 'https://ci.example.com/run/777';
  const checks: StatusCheck[] = [{ state: 'FAILURE', name: 'ci', targetUrl: url }];
  const item = prMetadataToEvidence(base({ statusCheckRollup: checks }), NOW_ISO);
  assert.ok(item.evidence.some((e) => e.includes(url)));
});

test('E: no fabricated check URLs when targetUrl not provided', () => {
  const checks: StatusCheck[] = [{ state: 'FAILURE', name: 'build' }];
  const item = prMetadataToEvidence(base({ statusCheckRollup: checks }), NOW_ISO);
  for (const e of item.evidence) {
    if (/FAIL/i.test(e) && /build/i.test(e)) {
      assert.ok(
        !/https?:\/\//i.test(e),
        `failing check evidence should not contain a URL when none provided: "${e}"`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// F. Merge conflicts
// ---------------------------------------------------------------------------

test('F: CONFLICTING → score lower than MERGEABLE, recommendation to resolve', () => {
  const conflicting = prMetadataToEvidence(base({ mergeable: 'CONFLICTING' }), NOW_ISO);
  const clean = prMetadataToEvidence(base(), NOW_ISO);
  assert.ok(conflicting.score < clean.score, 'CONFLICTING must lower the score');
  assert.ok(conflicting.recommendations.some((r) => /conflict|resolve/i.test(r)));
});

test('F: CONFLICTING appears in evidence', () => {
  const item = prMetadataToEvidence(base({ mergeable: 'CONFLICTING' }), NOW_ISO);
  assert.ok(item.evidence.some((e) => /CONFLICT/i.test(e)));
});

// ---------------------------------------------------------------------------
// G. No URL
// ---------------------------------------------------------------------------

test('G: no PR URL → evidence strings do not contain a fabricated URL', () => {
  const item = prMetadataToEvidence(
    base({ url: undefined, statusCheckRollup: greenChecks(2) }),
    NOW_ISO
  );
  for (const e of item.evidence) {
    assert.ok(
      !/https?:\/\//i.test(e),
      `should not fabricate a URL when none provided: "${e}"`
    );
  }
});

// ---------------------------------------------------------------------------
// H. PR number + URL in evidence
// ---------------------------------------------------------------------------

test('H: PR number appears in evidence when provided', () => {
  const item = prMetadataToEvidence(base({ number: 99 }), NOW_ISO);
  assert.ok(item.evidence.some((e) => /PR #99|#99/i.test(e)));
});

test('H: PR URL appears in evidence when provided', () => {
  const url = 'https://github.com/TapeshN/qulib/pull/99';
  const item = prMetadataToEvidence(base({ url }), NOW_ISO);
  assert.ok(item.evidence.some((e) => e.includes(url)));
});

// ---------------------------------------------------------------------------
// I. Schema round-trip
// ---------------------------------------------------------------------------

test('I: applicable output parses EvidenceItemSchema at runtime', async () => {
  const { EvidenceItemSchema } = await import('../../schemas/confidence.schema.js');
  const item = prMetadataToEvidence(base(), NOW_ISO);
  const parsed = EvidenceItemSchema.safeParse(item);
  assert.ok(parsed.success, `EvidenceItemSchema parse failed: ${JSON.stringify(parsed.error ?? null)}`);
});

test('I: not_applicable output parses EvidenceItemSchema at runtime', async () => {
  const { EvidenceItemSchema } = await import('../../schemas/confidence.schema.js');
  const item = prMetadataToEvidence({ noPr: true });
  const parsed = EvidenceItemSchema.safeParse(item);
  assert.ok(parsed.success, `EvidenceItemSchema parse failed (noPr): ${JSON.stringify(parsed.error ?? null)}`);
});

test('I: unknown output (pending checks) parses EvidenceItemSchema at runtime', async () => {
  const { EvidenceItemSchema } = await import('../../schemas/confidence.schema.js');
  const pending = [{ state: 'PENDING', name: 'build' }, { state: 'PENDING', name: 'test' }];
  const item = prMetadataToEvidence(base({ statusCheckRollup: pending }), NOW_ISO);
  const parsed = EvidenceItemSchema.safeParse(item);
  assert.ok(parsed.success, `EvidenceItemSchema parse failed (unknown): ${JSON.stringify(parsed.error ?? null)}`);
});

// ---------------------------------------------------------------------------
// J. Source + weight
// ---------------------------------------------------------------------------

test('J: source is deploy-metadata', () => {
  const item = prMetadataToEvidence(base(), NOW_ISO);
  assert.equal(item.source, 'deploy-metadata');
});

test('J: weight is non-zero', () => {
  const item = prMetadataToEvidence(base(), NOW_ISO);
  assert.ok(item.weight > 0, `weight must be > 0, got ${item.weight}`);
});

test('J: score is clamped to [0, 100]', () => {
  const item = prMetadataToEvidence(base({ mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED' }), NOW_ISO);
  assert.ok(item.score >= 0 && item.score <= 100, `score ${item.score} out of [0, 100]`);
});
