/**
 * Provenance grading + WSR unit tests.
 *
 * Covers deterministic grading, WSR math, TTL stale decay, ship-gate flip,
 * and witness-coverage taxonomy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceItem } from '../../schemas/confidence.schema.js';
import {
  computeProvenanceScore,
  gradeEvidenceItem,
  GRADE_WEIGHTS,
  WITNESS_TAXONOMY,
} from '../provenance.js';
import { ProvenanceScoreSchema } from '../../schemas/provenance.schema.js';

const REF_TIME = '2026-06-25T12:00:00.000Z';

function makeItem(overrides: Partial<EvidenceItem> & Pick<EvidenceItem, 'source'>): EvidenceItem {
  return {
    score: 80,
    weight: 0.2,
    applicability: 'applicable',
    blocking: false,
    evidence: ['test evidence'],
    recommendations: [],
    collectedAt: '2026-06-25T10:00:00.000Z',
    collector: { tool: 'qulib.analyze' },
    ...overrides,
  };
}

test('gradeEvidenceItem: qulib tool execution → high', () => {
  const item = makeItem({ source: 'live-app-quality', collector: { tool: 'qulib.analyze' } });
  assert.equal(gradeEvidenceItem(item), 'high');
});

test('gradeEvidenceItem: CI with run URL → high', () => {
  const item = makeItem({
    source: 'ci-results',
    collector: { tool: 'qulib.ci-results-adapter', inputRef: 'https://github.com/org/repo/actions/runs/1' },
  });
  assert.equal(gradeEvidenceItem(item), 'high');
});

test('gradeEvidenceItem: HTTP inputRef without qulib tool → mid', () => {
  const item = makeItem({
    source: 'deploy-metadata',
    collector: { tool: 'gh.pr-view', inputRef: 'https://github.com/org/repo/pull/42' },
  });
  assert.equal(gradeEvidenceItem(item), 'mid');
});

test('gradeEvidenceItem: tool without inputRef → low', () => {
  const item = makeItem({
    source: 'test-automation',
    collector: { tool: 'custom-scanner' },
  });
  assert.equal(gradeEvidenceItem(item), 'low');
});

test('gradeEvidenceItem: bare assertion → none', () => {
  const item = makeItem({
    source: 'human-approval',
    collector: { tool: 'bare-assertion' },
  });
  assert.equal(gradeEvidenceItem(item), 'none');
  assert.equal(GRADE_WEIGHTS.none, 0);
});

test('computeProvenanceScore: all witnessed → WSR=1.0 and shipGate=ship', () => {
  const input = {
    subject: { kind: 'release' as const, ref: 'v1.0.0', tenantId: 'default' },
    evidence: [
      makeItem({ source: 'live-app-quality', weight: 0.3, collector: { tool: 'qulib.analyze' } }),
      makeItem({
        source: 'ci-results',
        weight: 0.2,
        collector: { tool: 'qulib.ci-results-adapter', inputRef: 'https://ci.example/run/1' },
      }),
    ],
  };

  const ps = computeProvenanceScore(input, REF_TIME);
  assert.ok(ProvenanceScoreSchema.safeParse(ps).success);
  assert.equal(ps.wsr, 1);
  assert.equal(ps.shipGate, 'ship');
  assert.equal(ps.rubricVersion, 'provenance-v1');
});

test('computeProvenanceScore: mixed witnessed + claimed → deterministic WSR', () => {
  const input = {
    subject: { kind: 'release' as const, ref: 'v1.0.0', tenantId: 'default' },
    evidence: [
      makeItem({ source: 'live-app-quality', weight: 0.5, collector: { tool: 'qulib.analyze' } }),
      makeItem({ source: 'human-approval', weight: 0.5, collector: { tool: 'bare-assertion' } }),
    ],
  };

  const ps1 = computeProvenanceScore(input, REF_TIME);
  const ps2 = computeProvenanceScore(input, REF_TIME);
  assert.equal(ps1.wsr, ps2.wsr);
  assert.ok(ps1.wsr !== null && ps1.wsr > 0 && ps1.wsr < 1);
  assert.equal(ps1.witnessedMass, 0.5);
  assert.equal(ps1.claimedMass, 0.5);
});

test('computeProvenanceScore: stale evidence moves mass to stale bucket', () => {
  const input = {
    subject: { kind: 'release' as const, ref: 'v1.0.0', tenantId: 'default' },
    evidence: [
      makeItem({
        source: 'live-app-quality',
        weight: 1,
        collectedAt: '2026-06-20T10:00:00.000Z',
        collector: { tool: 'qulib.analyze' },
      }),
    ],
    policy: { staleAfterSeconds: 60 * 60 * 24, freshThresholdSeconds: 60 * 60 * 4 },
  };

  const ps = computeProvenanceScore(input, REF_TIME);
  assert.equal(ps.staleMass, 1);
  assert.equal(ps.witnessedMass, 0);
  assert.equal(ps.wsr, 0);
  assert.equal(ps.shipGate, 'no-ship');
});

test('computeProvenanceScore: ship-gate NO-SHIP below threshold', () => {
  const input = {
    subject: { kind: 'release' as const, ref: 'v1.0.0', tenantId: 'default' },
    evidence: [
      makeItem({ source: 'live-app-quality', weight: 0.2, collector: { tool: 'qulib.analyze' } }),
      makeItem({
        source: 'deploy-metadata',
        weight: 0.8,
        collector: { tool: 'human-claim', inputRef: 'https://example.com/pr/1' },
      }),
    ],
    policy: { wsrShipThreshold: 0.6 },
  };

  const ps = computeProvenanceScore(input, REF_TIME);
  assert.equal(ps.shipGate, 'no-ship');
  assert.ok(ps.wsr !== null && ps.wsr < 0.6);
  assert.ok(ps.honestyNotes.some((n) => /NO-SHIP/i.test(n)));
});

test('computeProvenanceScore: same input → same WSR (determinism)', () => {
  const input = {
    subject: { kind: 'release' as const, ref: 'test', tenantId: 'default' },
    evidence: [
      makeItem({ source: 'test-automation', weight: 0.4, collector: { tool: 'qulib.score-automation' } }),
      makeItem({ source: 'api-coverage', weight: 0.3, collector: { tool: 'external', inputRef: 'https://api.example.com' } }),
      makeItem({ source: 'human-approval', weight: 0.3, collector: { tool: 'bare-assertion' } }),
    ],
  };

  const a = computeProvenanceScore(input, REF_TIME);
  const b = computeProvenanceScore(input, REF_TIME);
  assert.equal(a.wsr, b.wsr);
  assert.deepEqual(a.gradedEvidence.map((g) => g.grade), b.gradedEvidence.map((g) => g.grade));
});

test('computeProvenanceScore: witness-coverage gaps for change types', () => {
  const input = {
    subject: { kind: 'release' as const, ref: 'v1.0.0', tenantId: 'default' },
    evidence: [
      makeItem({
        source: 'ci-results',
        weight: 1,
        collector: { tool: 'qulib.ci-results-adapter', inputRef: 'https://ci.example/run/1' },
      }),
    ],
    changeTypes: ['dependency-bump' as const, 'refactor' as const],
  };

  const ps = computeProvenanceScore(input, REF_TIME);
  assert.equal(ps.witnessCoverage.length, 2);
  const depBump = ps.witnessCoverage.find((w) => w.changeType === 'dependency-bump');
  assert.ok(depBump?.satisfied);
  const refactor = ps.witnessCoverage.find((w) => w.changeType === 'refactor');
  assert.equal(refactor?.satisfied, false);
});

test('WITNESS_TAXONOMY is pinned and non-empty', () => {
  assert.ok(WITNESS_TAXONOMY.length >= 5);
  assert.ok(WITNESS_TAXONOMY.every((w) => w.requiredWitness.length > 0));
});
