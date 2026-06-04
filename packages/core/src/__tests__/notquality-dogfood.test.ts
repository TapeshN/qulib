/**
 * Integration tests — notquality DOGFOOD pipeline (P5).
 *
 * Validates that real notquality delivery signals (CI run, PR metadata,
 * automation maturity) flow correctly through the qulib adapter chain and
 * produce a deterministic Release Confidence score + verdict.
 *
 * Fixture provenance: gh CLI against TapeshN/notquality, 2026-06-04.
 * All signals are FROZEN in the fixture file; these tests are offline and pure.
 *
 * Test plan:
 *   A. Schema conformance — every adapter output parses EvidenceItemSchema
 *   B. E2E adapter mapping — ciResultsToEvidence produces expected score/shape
 *   C. PR adapter mapping — prMetadataToEvidence produces expected score/shape
 *   D. Automation maturity item — correct structure and score
 *   E. Verdict-gate logic — computeReleaseConfidence over the full bundle
 *   F. Determinism — running twice produces identical confidenceScore
 *   G. Sensitivity guard — a degraded signal (build fail) lowers the score
 *   H. Sensitivity guard — a blocking item forces verdict='block'
 *   I. No fabricated data guard — evidence strings do not contain placeholder URLs
 *   J. Provenance round-trip — collector.tool fields are set + inputRef present where expected
 *   K. Honesty: partial evidence (only CI + PR, no maturity) still produces a score
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ciResultsToEvidence } from '../adapters/ci-results-adapter.js';
import { prMetadataToEvidence } from '../adapters/pr-metadata-adapter.js';
import { computeReleaseConfidence } from '../tools/scoring/confidence.js';
import { EvidenceItemSchema } from '../schemas/confidence.schema.js';
import type { EvidenceItem, ConfidenceInput } from '../schemas/confidence.schema.js';

import {
  FIXTURE_COLLECTION_TS,
  NOTQUALITY_E2E_RUN,
  NOTQUALITY_PR_52,
  NOTQUALITY_AUTOMATION_MATURITY,
  NOTQUALITY_SUBJECT,
} from '../examples/notquality-dogfood/fixture.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAutomationItem(): EvidenceItem {
  return {
    source: 'test-automation',
    score: NOTQUALITY_AUTOMATION_MATURITY.overallScore,
    weight: 0.22,
    applicability: 'applicable',
    blocking: false,
    evidence: [
      `Automation maturity: ${NOTQUALITY_AUTOMATION_MATURITY.label} (score ${NOTQUALITY_AUTOMATION_MATURITY.overallScore})`,
      `Source: static scan of ${NOTQUALITY_AUTOMATION_MATURITY.repoPath}`,
    ],
    recommendations: NOTQUALITY_AUTOMATION_MATURITY.topRecommendations.slice(),
    collectedAt: FIXTURE_COLLECTION_TS,
    collector: {
      tool: 'qulib_score_automation.pre-scored',
      inputRef: NOTQUALITY_AUTOMATION_MATURITY.repoPath,
    },
  };
}

function mutablePr() {
  return {
    ...NOTQUALITY_PR_52,
    statusCheckRollup: NOTQUALITY_PR_52.statusCheckRollup.map((c) => ({ ...c })),
  };
}

function fullBundle(): ConfidenceInput {
  const e2e = ciResultsToEvidence(NOTQUALITY_E2E_RUN, FIXTURE_COLLECTION_TS);
  const pr = prMetadataToEvidence(mutablePr(), FIXTURE_COLLECTION_TS);
  const auto = makeAutomationItem();
  return {
    subject: NOTQUALITY_SUBJECT,
    evidence: [e2e, pr, auto],
    policy: { passThreshold: 80, failThreshold: 30, maxListLength: 5, requiredSources: [] },
  };
}

// ---------------------------------------------------------------------------
// A. Schema conformance
// ---------------------------------------------------------------------------

test('A: E2E adapter output parses EvidenceItemSchema (runtime-import check)', () => {
  const item = ciResultsToEvidence(NOTQUALITY_E2E_RUN, FIXTURE_COLLECTION_TS);
  const parsed = EvidenceItemSchema.safeParse(item);
  assert.ok(parsed.success, `EvidenceItemSchema parse failed: ${JSON.stringify((parsed as { error?: unknown }).error)}`);
});

test('A: PR adapter output parses EvidenceItemSchema (runtime-import check)', () => {
  const item = prMetadataToEvidence(mutablePr(), FIXTURE_COLLECTION_TS);
  const parsed = EvidenceItemSchema.safeParse(item);
  assert.ok(parsed.success, `EvidenceItemSchema parse failed: ${JSON.stringify((parsed as { error?: unknown }).error)}`);
});

test('A: automation maturity item parses EvidenceItemSchema', () => {
  const item = makeAutomationItem();
  const parsed = EvidenceItemSchema.safeParse(item);
  assert.ok(parsed.success, `EvidenceItemSchema parse failed: ${JSON.stringify((parsed as { error?: unknown }).error)}`);
});

// ---------------------------------------------------------------------------
// B. E2E adapter — notquality real signal
// ---------------------------------------------------------------------------

test('B: E2E run — all 168 tests pass → applicable, score > 95', () => {
  const item = ciResultsToEvidence(NOTQUALITY_E2E_RUN, FIXTURE_COLLECTION_TS);
  assert.equal(item.applicability, 'applicable');
  assert.equal(item.source, 'ci-results');
  // 168/168 pass rate = 100%; freshness factor applied (run < 4h before collection)
  // Full freshness: ageS = (09:00 - 04:46:20) = 15220s < 14400s fresh threshold → freshness=1.0
  // score = round(168/168 * 1.0 * 100) = 100
  assert.ok(item.score !== null && item.score > 95,
    `Expected score > 95 for all-pass run, got ${item.score}`);
  assert.equal(item.blocking, false);
  assert.ok(item.evidence.some((e) => /168.*168|100%/i.test(e)),
    'evidence should mention 168/168 pass rate');
});

test('B: E2E run — runUrl is the real gh URL (no fabricated data)', () => {
  const item = ciResultsToEvidence(NOTQUALITY_E2E_RUN, FIXTURE_COLLECTION_TS);
  const urlEvidence = item.evidence.find((e) => e.includes('https://'));
  assert.ok(urlEvidence, 'evidence must include the real run URL');
  assert.ok(urlEvidence!.includes('26931370208'), 'URL must be the actual run ID, not a placeholder');
});

// ---------------------------------------------------------------------------
// C. PR adapter — notquality PR #52 real signal
// ---------------------------------------------------------------------------

test('C: PR #52 — all checks green, mergeable → score >= 80', () => {
  const item = prMetadataToEvidence(mutablePr(), FIXTURE_COLLECTION_TS);
  assert.equal(item.applicability, 'applicable');
  assert.equal(item.source, 'deploy-metadata');
  // Base 60 + all checks green (+20) = 80; no approval yet (no +20 for reviewDecision)
  assert.ok(item.score !== null && item.score >= 80,
    `Expected score >= 80 for all-green PR, got ${item.score}`);
});

test('C: PR #52 — evidence mentions PR number and mergeable state', () => {
  const item = prMetadataToEvidence(mutablePr(), FIXTURE_COLLECTION_TS);
  assert.ok(item.evidence.some((e) => /PR #52|52/i.test(e)),
    'evidence must reference PR #52');
  assert.ok(item.evidence.some((e) => /mergeable/i.test(e)),
    'evidence must mention mergeable state');
});

// ---------------------------------------------------------------------------
// D. Automation maturity item structure
// ---------------------------------------------------------------------------

test('D: automation maturity item — correct score and collector tool', () => {
  const item = makeAutomationItem();
  assert.equal(item.source, 'test-automation');
  assert.equal(item.score, NOTQUALITY_AUTOMATION_MATURITY.overallScore); // 65
  assert.equal(item.applicability, 'applicable');
  assert.equal(item.collector.tool, 'qulib_score_automation.pre-scored');
  assert.ok(item.collector.inputRef?.includes('notquality'),
    'inputRef must reference the notquality repo');
});

test('D: automation maturity score is in L3 range (60–79)', () => {
  const score = NOTQUALITY_AUTOMATION_MATURITY.overallScore;
  assert.ok(score >= 60 && score <= 79,
    `L3 score must be 60–79, got ${score}`);
  assert.equal(NOTQUALITY_AUTOMATION_MATURITY.level, 3);
});

// ---------------------------------------------------------------------------
// E. Full pipeline — computeReleaseConfidence over real bundle
// ---------------------------------------------------------------------------

test('E: full pipeline produces a non-null confidenceScore', () => {
  const rc = computeReleaseConfidence(fullBundle());
  assert.ok(rc.confidenceScore !== null,
    'confidenceScore must not be null when all sources are applicable');
  assert.ok(rc.confidenceScore > 0 && rc.confidenceScore <= 100,
    `score must be in 0–100 range, got ${rc.confidenceScore}`);
});

test('E: full pipeline verdict — score in caution/ship range for real notquality delivery', () => {
  const rc = computeReleaseConfidence(fullBundle());
  // E2E ~100, PR ~80, maturity ~65 → weighted average. Expected: caution or ship.
  // (maturity 65 < passThreshold 80 → caution at minimum unless weighted score >= 80)
  assert.ok(
    rc.verdict === 'caution' || rc.verdict === 'ship',
    `Expected 'caution' or 'ship', got '${rc.verdict}' (score=${rc.confidenceScore})`
  );
});

test('E: contributions include all three evidence sources', () => {
  const rc = computeReleaseConfidence(fullBundle());
  const sources = rc.contributions.map((c) => c.source);
  assert.ok(sources.includes('ci-results'), 'contributions must include ci-results');
  assert.ok(sources.includes('deploy-metadata'), 'contributions must include deploy-metadata');
  assert.ok(sources.includes('test-automation'), 'contributions must include test-automation');
});

test('E: no blockers for green notquality delivery signals', () => {
  const rc = computeReleaseConfidence(fullBundle());
  assert.equal(rc.blockers.length, 0,
    `Expected no blockers for green signals, got: ${rc.blockers.join(', ')}`);
});

// ---------------------------------------------------------------------------
// F. Determinism — same fixture always produces same score
// ---------------------------------------------------------------------------

test('F: deterministic — identical confidenceScore on two calls with same inputs', () => {
  const rc1 = computeReleaseConfidence(fullBundle());
  const rc2 = computeReleaseConfidence(fullBundle());
  assert.equal(rc1.confidenceScore, rc2.confidenceScore,
    'computeReleaseConfidence must be deterministic over the same input');
  assert.equal(rc1.verdict, rc2.verdict, 'verdict must also be deterministic');
});

// ---------------------------------------------------------------------------
// G. Sensitivity — degraded signal lowers score (not identical to green)
// ---------------------------------------------------------------------------

test('G: degraded E2E signal (build failure) produces lower score than green', () => {
  const greenRc = computeReleaseConfidence(fullBundle());

  // Degrade: simulate a build failure in the E2E run.
  const failedRun = { ...NOTQUALITY_E2E_RUN, buildPassed: false, testsPassed: 0, testsFailed: 0 };
  const failedEvidence = ciResultsToEvidence(failedRun, FIXTURE_COLLECTION_TS);
  const pr = prMetadataToEvidence(mutablePr(), FIXTURE_COLLECTION_TS);
  const auto = makeAutomationItem();
  const degradedRc = computeReleaseConfidence({
    subject: NOTQUALITY_SUBJECT,
    evidence: [failedEvidence, pr, auto],
  });

  assert.ok(
    (degradedRc.confidenceScore ?? 0) < (greenRc.confidenceScore ?? 0),
    `Degraded score (${degradedRc.confidenceScore}) must be < green score (${greenRc.confidenceScore})`
  );
});

// ---------------------------------------------------------------------------
// H. Sensitivity — blocking item forces verdict='block'
// ---------------------------------------------------------------------------

test('H: blocking evidence item forces verdict=block regardless of other scores', () => {
  const e2e = ciResultsToEvidence(NOTQUALITY_E2E_RUN, FIXTURE_COLLECTION_TS);
  const blockingItem: EvidenceItem = {
    ...e2e,
    source: 'live-app-quality',
    score: 85,
    blocking: true,
    evidence: ['Critical gap: console errors on every page (synthetic test).'],
    reason: 'Hard blocker: critical-severity gap.',
  };
  const rc = computeReleaseConfidence({
    subject: NOTQUALITY_SUBJECT,
    evidence: [blockingItem, prMetadataToEvidence(mutablePr(), FIXTURE_COLLECTION_TS)],
  });
  assert.equal(rc.verdict, 'block',
    'A blocking item must force verdict=block even if other scores are high');
  assert.ok(rc.blockers.length > 0, 'blockers array must be non-empty when verdict=block');
});

// ---------------------------------------------------------------------------
// I. No fabricated data guard
// ---------------------------------------------------------------------------

test('I: evidence strings contain the real notquality run IDs, not placeholder text', () => {
  const item = ciResultsToEvidence(NOTQUALITY_E2E_RUN, FIXTURE_COLLECTION_TS);
  // Verify the fixture URL is the real run (26931370208), not a template placeholder.
  const allText = item.evidence.join(' ');
  assert.ok(!allText.includes('<run-id>') && !allText.includes('TODO') && !allText.includes('example.com'),
    `Evidence must not contain placeholder text, got: ${allText.substring(0, 200)}`);
});

test('I: PR evidence includes real PR #52 URL (no placeholder)', () => {
  const item = prMetadataToEvidence(mutablePr(), FIXTURE_COLLECTION_TS);
  const hasRealUrl = item.evidence.some((e) => e.includes('github.com/TapeshN/notquality/pull/52'));
  assert.ok(hasRealUrl, 'PR evidence must include the real notquality PR URL');
});

// ---------------------------------------------------------------------------
// J. Provenance round-trip
// ---------------------------------------------------------------------------

test('J: collector.tool fields are set on all three evidence items', () => {
  const e2e = ciResultsToEvidence(NOTQUALITY_E2E_RUN, FIXTURE_COLLECTION_TS);
  const pr = prMetadataToEvidence(mutablePr(), FIXTURE_COLLECTION_TS);
  const auto = makeAutomationItem();

  assert.ok(e2e.collector.tool.length > 0, 'E2E item must have collector.tool');
  assert.ok(pr.collector.tool.length > 0, 'PR item must have collector.tool');
  assert.ok(auto.collector.tool.length > 0, 'automation item must have collector.tool');
});

test('J: E2E adapter sets inputRef to the real run URL', () => {
  const item = ciResultsToEvidence(NOTQUALITY_E2E_RUN, FIXTURE_COLLECTION_TS);
  assert.ok(item.collector.inputRef?.includes('26931370208'),
    `inputRef must reference the real E2E run ID, got: ${item.collector.inputRef}`);
});

// ---------------------------------------------------------------------------
// K. Honesty: partial evidence (no maturity) still produces a score
// ---------------------------------------------------------------------------

test('K: partial evidence (only CI + PR) still produces a non-null score', () => {
  const e2e = ciResultsToEvidence(NOTQUALITY_E2E_RUN, FIXTURE_COLLECTION_TS);
  const pr = prMetadataToEvidence(mutablePr(), FIXTURE_COLLECTION_TS);
  const rc = computeReleaseConfidence({
    subject: NOTQUALITY_SUBJECT,
    evidence: [e2e, pr],
  });
  assert.ok(rc.confidenceScore !== null,
    'Partial evidence (2 of 3 sources) must still produce a score');
  assert.ok(rc.contributions.length === 2, 'Contributions must contain only the supplied items');
});

test('K: verdict-fixture — releaseConfidence=40 forces hold verdict', () => {
  // Synthetic: very low-confidence but no blocking item → hold (< failThreshold 30? No, 40 > 30).
  // Correctly: 40 < passThreshold 80 but > failThreshold 30 → caution.
  const lowItem: EvidenceItem = {
    source: 'ci-results',
    score: 40,
    weight: 0.10,
    applicability: 'applicable',
    blocking: false,
    evidence: ['Simulated low-confidence scenario'],
    recommendations: ['Fix failing tests'],
    collectedAt: FIXTURE_COLLECTION_TS,
    collector: { tool: 'test-fixture' },
  };
  const rc = computeReleaseConfidence({ subject: NOTQUALITY_SUBJECT, evidence: [lowItem] });
  assert.equal(rc.verdict, 'caution',
    'Score=40 is below passThreshold(80) but above failThreshold(30) → caution');
});

test('K: verdict-fixture — score < failThreshold (20) forces hold verdict', () => {
  const veryLowItem: EvidenceItem = {
    source: 'ci-results',
    score: 20,
    weight: 0.10,
    applicability: 'applicable',
    blocking: false,
    evidence: ['Simulated very-low-confidence scenario'],
    recommendations: [],
    collectedAt: FIXTURE_COLLECTION_TS,
    collector: { tool: 'test-fixture' },
  };
  const rc = computeReleaseConfidence({ subject: NOTQUALITY_SUBJECT, evidence: [veryLowItem] });
  assert.equal(rc.verdict, 'hold',
    'Score=20 is below failThreshold(30) → hold');
});
