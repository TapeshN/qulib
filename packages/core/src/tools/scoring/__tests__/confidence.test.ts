/**
 * Unit tests for computeReleaseConfidence (pure scorer).
 *
 * Test plan (P3 spec §6.A):
 * - Fusion math: exact confidenceScore + effectiveWeight with known inputs
 * - Honesty floor: not_applicable + unknown excluded from denominator, present in contributions + honestyNotes
 * - null handling: all-null / empty applicable set → confidenceScore===null + verdict==='block'
 * - Verdict ladder: blocking, ship, caution, hold, block
 * - Policy override: custom passThreshold/weights
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReleaseConfidence } from '../confidence.js';
import type { ConfidenceInput, EvidenceItem } from '../../../schemas/confidence.schema.js';

const NOW = new Date().toISOString();

function makeItem(
  source: EvidenceItem['source'],
  score: number | null,
  weight: number,
  overrides: Partial<EvidenceItem> = {}
): EvidenceItem {
  return {
    source,
    score,
    weight,
    applicability: 'applicable',
    blocking: false,
    evidence: [`${source} evidence`],
    recommendations: [],
    collectedAt: NOW,
    collector: { tool: `tool_${source}` },
    ...overrides,
  };
}

function baseSubject() {
  return { kind: 'release' as const, ref: 'https://example.com', tenantId: 'test' };
}

function baseInput(items: EvidenceItem[], policy?: ConfidenceInput['policy']): ConfidenceInput {
  return { subject: baseSubject(), evidence: items, policy };
}

// ---------------------------------------------------------------------------
// A. Fusion math
// ---------------------------------------------------------------------------

test('fusion math: exact confidenceScore and effectiveWeight with 3 applicable sources', () => {
  const items = [
    makeItem('live-app-quality', 80, 0.30),
    makeItem('test-automation', 60, 0.20),
    makeItem('api-coverage', 40, 0.10),
  ];
  const rc = computeReleaseConfidence(baseInput(items));

  const weightSum = 0.30 + 0.20 + 0.10;
  const expected = Math.round((80 * 0.30 + 60 * 0.20 + 40 * 0.10) / weightSum);
  assert.equal(rc.confidenceScore, expected, `expected ${expected} got ${rc.confidenceScore}`);
  assert.ok(rc.schemaVersion === 1);

  const liveContrib = rc.contributions.find((c) => c.source === 'live-app-quality');
  assert.ok(liveContrib, 'live-app-quality contribution present');
  const expectedEW = 0.30 / weightSum;
  assert.ok(
    Math.abs(liveContrib!.effectiveWeight - expectedEW) < 0.001,
    `effectiveWeight expected ~${expectedEW.toFixed(3)}, got ${liveContrib!.effectiveWeight}`
  );
});

// ---------------------------------------------------------------------------
// B. Honesty floor: not_applicable + unknown excluded from denominator
// ---------------------------------------------------------------------------

test('not_applicable item excluded from denominator but present in contributions and honestyNotes', () => {
  const items = [
    makeItem('live-app-quality', 80, 0.30),
    makeItem('api-coverage', 0, 0.15, { applicability: 'not_applicable', reason: 'no endpoints' }),
  ];
  const rc = computeReleaseConfidence(baseInput(items));

  // Score should only use the live-app-quality item (weight 0.30, score 80).
  assert.equal(rc.confidenceScore, 80, 'not_applicable excluded from denominator');

  const apiContrib = rc.contributions.find((c) => c.source === 'api-coverage');
  assert.ok(apiContrib, 'api-coverage still in contributions');
  assert.equal(apiContrib!.applicability, 'not_applicable');
  assert.equal(apiContrib!.effectiveWeight, 0, 'effectiveWeight 0 for not_applicable');

  assert.ok(
    rc.honestyNotes.some((n) => n.includes('api-coverage')),
    'honestyNotes mentions excluded source'
  );
});

test('unknown item excluded from denominator and narrated in honestyNotes', () => {
  const items = [
    makeItem('live-app-quality', 70, 0.30),
    makeItem('crawl-coverage', null, 0.10, { applicability: 'unknown', reason: 'auth blocked' }),
  ];
  const rc = computeReleaseConfidence(baseInput(items));

  assert.equal(rc.confidenceScore, 70);
  assert.ok(rc.honestyNotes.some((n) => n.includes('crawl-coverage')));

  const crawlContrib = rc.contributions.find((c) => c.source === 'crawl-coverage');
  assert.ok(crawlContrib);
  assert.equal(crawlContrib!.effectiveWeight, 0);
});

// ---------------------------------------------------------------------------
// C. null handling
// ---------------------------------------------------------------------------

test('empty evidence array → confidenceScore null + verdict block', () => {
  const rc = computeReleaseConfidence(baseInput([]));
  assert.equal(rc.confidenceScore, null);
  assert.equal(rc.verdict, 'block');
  assert.ok(rc.blockers.length > 0);
});

test('all items not_applicable → confidenceScore null + verdict block', () => {
  const items = [
    makeItem('api-coverage', 0, 0.15, { applicability: 'not_applicable' }),
    makeItem('crawl-coverage', null, 0.10, { applicability: 'unknown' }),
  ];
  const rc = computeReleaseConfidence(baseInput(items));
  assert.equal(rc.confidenceScore, null);
  assert.equal(rc.verdict, 'block');
});

test('all applicable scores null → confidenceScore null + verdict block', () => {
  const items = [
    makeItem('live-app-quality', null, 0.30),
  ];
  const rc = computeReleaseConfidence(baseInput(items));
  assert.equal(rc.confidenceScore, null);
  assert.equal(rc.verdict, 'block');
});

// ---------------------------------------------------------------------------
// D. Verdict ladder
// ---------------------------------------------------------------------------

test('one blocking item → verdict block regardless of high score', () => {
  const items = [
    makeItem('live-app-quality', 95, 0.30),
    makeItem('accessibility', 90, 0.13),
    makeItem('crawl-coverage', 0, 0.10, { blocking: true, reason: 'critical gap' }),
  ];
  const rc = computeReleaseConfidence(baseInput(items));
  assert.equal(rc.verdict, 'block');
  assert.ok(rc.blockers.length > 0);
});

test('score 85 no blockers → verdict ship', () => {
  const items = [makeItem('live-app-quality', 85, 0.30)];
  const rc = computeReleaseConfidence(baseInput(items));
  assert.equal(rc.confidenceScore, 85);
  assert.equal(rc.verdict, 'ship');
});

test('score 50 → verdict caution (between failThreshold=30 and passThreshold=80)', () => {
  const items = [makeItem('live-app-quality', 50, 0.30)];
  const rc = computeReleaseConfidence(baseInput(items));
  assert.equal(rc.verdict, 'caution');
});

test('score 20 → verdict hold (below failThreshold=30)', () => {
  const items = [makeItem('live-app-quality', 20, 0.30)];
  const rc = computeReleaseConfidence(baseInput(items));
  assert.equal(rc.verdict, 'hold');
});

test('unknown on a requiredSources entry → verdict caution even with high score', () => {
  const items = [
    makeItem('live-app-quality', 90, 0.30),
    makeItem('test-automation', 0, 0.22, { applicability: 'unknown', reason: 'no signal' }),
  ];
  const rc = computeReleaseConfidence(
    baseInput(items, {
      requiredSources: ['test-automation'],
    })
  );
  // score = 90 (test-automation excluded), above passThreshold; but required source is unknown → caution
  assert.equal(rc.verdict, 'caution', `expected caution, got ${rc.verdict}`);
});

// ---------------------------------------------------------------------------
// E. Policy override
// ---------------------------------------------------------------------------

test('custom passThreshold 95 makes score 85 produce caution instead of ship', () => {
  const items = [makeItem('live-app-quality', 85, 0.30)];
  const rc = computeReleaseConfidence(
    baseInput(items, { passThreshold: 95, failThreshold: 30 })
  );
  assert.equal(rc.verdict, 'caution');
});

test('custom failThreshold 50 makes score 40 produce hold instead of caution', () => {
  const items = [makeItem('live-app-quality', 40, 0.30)];
  const rc = computeReleaseConfidence(
    baseInput(items, { passThreshold: 80, failThreshold: 50 })
  );
  assert.equal(rc.verdict, 'hold');
});

test('policy weights override item weight in denominator', () => {
  const items = [
    makeItem('live-app-quality', 80, 0.30),
    makeItem('test-automation', 40, 0.20),
  ];
  // Override live-app-quality weight to 0.50, test-automation to 0.50
  const rc = computeReleaseConfidence(
    baseInput(items, {
      weights: { 'live-app-quality': 0.50, 'test-automation': 0.50 },
    })
  );
  const expected = Math.round((80 * 0.50 + 40 * 0.50) / (0.50 + 0.50));
  assert.equal(rc.confidenceScore, expected);
});

// ---------------------------------------------------------------------------
// F. Schema validity
// ---------------------------------------------------------------------------

test('result parses against ReleaseConfidenceSchema (runtime-import check)', async () => {
  const { ReleaseConfidenceSchema } = await import('../../../schemas/confidence.schema.js');
  const items = [makeItem('live-app-quality', 75, 0.30)];
  const rc = computeReleaseConfidence(baseInput(items));
  const parsed = ReleaseConfidenceSchema.safeParse(rc);
  assert.ok(parsed.success, `schema parse failed: ${JSON.stringify(parsed.error ?? null)}`);
});

test('scoreFormula is documented on the result', () => {
  const items = [makeItem('live-app-quality', 75, 0.30)];
  const rc = computeReleaseConfidence(baseInput(items));
  assert.ok(rc.scoreFormula, 'scoreFormula present');
  assert.match(rc.scoreFormula, /applicable/i);
});
