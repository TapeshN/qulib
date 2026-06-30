/**
 * Runtime-import check for qulib_score_provenance MCP tool logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProvenanceScore,
  ProvenanceScoreSchema,
  gradeEvidenceItem,
} from '@qulib/core';
import type { EvidenceItem } from '@qulib/core';

const REF = '2026-06-25T12:00:00.000Z';

function makeItem(source: EvidenceItem['source'], tool: string, weight = 0.5): EvidenceItem {
  return {
    source,
    score: 80,
    weight,
    applicability: 'applicable',
    blocking: false,
    evidence: ['evidence line'],
    recommendations: [],
    collectedAt: '2026-06-25T10:00:00.000Z',
    collector: { tool },
  };
}

test('qulib_score_provenance pipeline: output parses ProvenanceScoreSchema', () => {
  const ps = computeProvenanceScore(
    {
      subject: { kind: 'release', ref: 'v1.0.0', tenantId: 'test' },
      evidence: [
        makeItem('live-app-quality', 'qulib.analyze'),
        makeItem('human-approval', 'bare-assertion'),
      ],
    },
    REF
  );

  assert.ok(ProvenanceScoreSchema.safeParse(ps).success);
});

test('qulib_score_provenance pipeline: ship-gate NO-SHIP when mostly claimed', () => {
  const ps = computeProvenanceScore(
    {
      subject: { kind: 'release', ref: 'v1.0.0', tenantId: 'test' },
      evidence: [
        makeItem('live-app-quality', 'qulib.analyze', 0.2),
        makeItem('human-approval', 'bare-assertion', 0.8),
      ],
      policy: { wsrShipThreshold: 0.6 },
    },
    REF
  );

  assert.equal(ps.shipGate, 'no-ship');
  assert.ok(ps.wsr !== null && ps.wsr < 0.6);
});

test('qulib_score_provenance pipeline: deterministic WSR on repeat', () => {
  const input = {
    subject: { kind: 'release' as const, ref: 'v1.0.0', tenantId: 'test' },
    evidence: [
      makeItem('ci-results', 'qulib.ci-results-adapter', 0.5),
      makeItem('test-automation', 'qulib.score-automation', 0.5),
    ],
  };

  const a = computeProvenanceScore(input, REF);
  const b = computeProvenanceScore(input, REF);
  assert.equal(a.wsr, b.wsr);
  assert.equal(a.shipGate, b.shipGate);
});

test('gradeEvidenceItem exported for MCP consumers', () => {
  const grade = gradeEvidenceItem(makeItem('ci-results', 'qulib.ci-results-adapter'));
  assert.equal(grade, 'high');
});
