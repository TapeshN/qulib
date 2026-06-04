/**
 * Adapter tests for buildConfidenceInputFromQulib.
 *
 * Test plan (P3 spec §6.B):
 * - auth-required AnalyzeResult → live-app-quality applicability='unknown' + non-silent-pass
 * - blocked AnalyzeResult → live-app-quality blocking=true
 * - clean AnalyzeResult → applicable with real score
 * - ApiCoverageResult with 0 endpoints → api-coverage applicability='not_applicable' passed through
 * - AutomationMaturity → test-automation EvidenceItem with overallScore
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfidenceInputFromQulib } from '../confidence-from-qulib.js';
import type { AnalyzeResult } from '../../../analyze.js';
import type { AutomationMaturity } from '../../../schemas/automation-maturity.schema.js';
import type { ApiCoverageResult } from '../api-coverage.js';

const NOW = new Date().toISOString();

function makeAnalyzeResult(overrides: Partial<AnalyzeResult> = {}): AnalyzeResult {
  return {
    status: 'complete',
    coverageScore: 85,
    releaseConfidence: 75,
    gaps: [],
    gapAnalysis: {
      analyzedAt: NOW,
      mode: 'url-only',
      releaseConfidence: 75,
      coveragePagesScanned: 10,
      coverageBudgetExceeded: false,
      gaps: [],
      scenarios: [],
      generatedTests: [],
    },
    routeInventory: {
      scannedAt: NOW,
      baseUrl: 'https://example.com',
      routes: [],
      pagesSkipped: 0,
      budgetExceeded: false,
    },
    repoInventory: null,
    decisionLog: [],
    publicSurface: null,
    ...overrides,
  };
}

function makeMaturity(overallScore = 70): AutomationMaturity {
  return {
    computedAt: NOW,
    repoPath: '/tmp/fake-repo',
    overallScore,
    level: 3,
    label: `L3 — building maturity`,
    dimensions: [],
    topRecommendations: ['Add more tests'],
  };
}

function makeApiCoverage(applicability: 'applicable' | 'not_applicable'): ApiCoverageResult {
  return {
    dimension: {
      dimension: 'api-test-coverage',
      score: applicability === 'applicable' ? 80 : 0,
      weight: 0.15,
      evidence: applicability === 'applicable' ? ['2/2 endpoints covered'] : ['0 endpoints discovered'],
      recommendations: [],
      applicability,
      reason: applicability === 'not_applicable' ? 'No API endpoints discovered.' : undefined,
    },
    endpointCoverage: [],
    untestedHighSeverityCount: 0,
    untestedMediumSeverityCount: 0,
  };
}

const baseSubject = { kind: 'release' as const, ref: 'https://example.com', tenantId: 'test' };

// ---------------------------------------------------------------------------
// AnalyzeResult → live-app-quality
// ---------------------------------------------------------------------------

test('auth-required analyze → live-app-quality applicability=unknown (never silent pass)', () => {
  const result = makeAnalyzeResult({
    gapAnalysis: {
      analyzedAt: NOW,
      mode: 'auth-required',
      releaseConfidence: null,
      coveragePagesScanned: 0,
      coverageBudgetExceeded: false,
      gaps: [],
      scenarios: [],
      generatedTests: [],
    },
    releaseConfidence: null,
  });

  const input = buildConfidenceInputFromQulib({ analyze: result, subject: baseSubject });
  const liveItem = input.evidence.find((e) => e.source === 'live-app-quality');
  assert.ok(liveItem, 'live-app-quality item present');
  assert.equal(liveItem!.applicability, 'unknown', 'auth-required must be unknown, not applicable');
  assert.equal(liveItem!.score, null, 'score must be null when auth-required');
  assert.equal(liveItem!.blocking, false, 'auth-wall alone is not a hard blocker (it is degraded signal)');
});

test('blocked analyze → live-app-quality blocking=true', () => {
  const result = makeAnalyzeResult({
    status: 'blocked',
    releaseConfidence: null,
    gapAnalysis: {
      analyzedAt: NOW,
      mode: 'url-only',
      releaseConfidence: null,
      coveragePagesScanned: 0,
      coverageBudgetExceeded: false,
      gaps: [],
      scenarios: [],
      generatedTests: [],
    },
  });

  const input = buildConfidenceInputFromQulib({ analyze: result, subject: baseSubject });
  const liveItem = input.evidence.find((e) => e.source === 'live-app-quality');
  assert.ok(liveItem, 'live-app-quality item present');
  assert.equal(liveItem!.blocking, true, 'blocked scan must produce blocking=true');
  assert.equal(liveItem!.score, null);
});

test('critical gap → live-app-quality blocking=true', () => {
  const result = makeAnalyzeResult({
    gaps: [{
      id: 'g1', path: '/home', severity: 'critical', reason: 'crash',
      category: 'console-error',
    }],
    gapAnalysis: {
      analyzedAt: NOW,
      mode: 'url-only',
      releaseConfidence: 40,
      coveragePagesScanned: 5,
      coverageBudgetExceeded: false,
      gaps: [{
        id: 'g1', path: '/home', severity: 'critical', reason: 'crash',
        category: 'console-error',
      }],
      scenarios: [],
      generatedTests: [],
    },
    releaseConfidence: 40,
  });

  const input = buildConfidenceInputFromQulib({ analyze: result, subject: baseSubject });
  const liveItem = input.evidence.find((e) => e.source === 'live-app-quality');
  assert.ok(liveItem);
  assert.equal(liveItem!.blocking, true, 'critical gap must produce blocking=true');
});

test('clean analyze → live-app-quality applicable with real score', () => {
  const result = makeAnalyzeResult({ releaseConfidence: 80, coverageScore: 90 });
  const input = buildConfidenceInputFromQulib({ analyze: result, subject: baseSubject });
  const liveItem = input.evidence.find((e) => e.source === 'live-app-quality');
  assert.ok(liveItem);
  assert.equal(liveItem!.applicability, 'applicable');
  assert.equal(liveItem!.score, 80);
  assert.equal(liveItem!.blocking, false);
});

test('clean analyze → accessibility EvidenceItem present', () => {
  const input = buildConfidenceInputFromQulib({ analyze: makeAnalyzeResult(), subject: baseSubject });
  const a11y = input.evidence.find((e) => e.source === 'accessibility');
  assert.ok(a11y, 'accessibility item present');
  assert.equal(a11y!.source, 'accessibility');
});

test('clean analyze → crawl-coverage EvidenceItem present', () => {
  const input = buildConfidenceInputFromQulib({ analyze: makeAnalyzeResult(), subject: baseSubject });
  const crawl = input.evidence.find((e) => e.source === 'crawl-coverage');
  assert.ok(crawl, 'crawl-coverage item present');
});

test('low-coverage warning → crawl-coverage applicability=unknown', () => {
  const result = makeAnalyzeResult({
    gapAnalysis: {
      analyzedAt: NOW,
      mode: 'url-only',
      releaseConfidence: 70,
      coveragePagesScanned: 2,
      coverageBudgetExceeded: false,
      coverageWarning: 'low-coverage',
      gaps: [],
      scenarios: [],
      generatedTests: [],
    },
  });
  const input = buildConfidenceInputFromQulib({ analyze: result, subject: baseSubject });
  const crawl = input.evidence.find((e) => e.source === 'crawl-coverage');
  assert.ok(crawl);
  assert.equal(crawl!.applicability, 'unknown', 'low-coverage should be unknown, not applicable');
});

// ---------------------------------------------------------------------------
// AutomationMaturity → test-automation
// ---------------------------------------------------------------------------

test('maturity → test-automation EvidenceItem with overallScore', () => {
  const input = buildConfidenceInputFromQulib({
    maturity: makeMaturity(65),
    subject: baseSubject,
  });
  const auto = input.evidence.find((e) => e.source === 'test-automation');
  assert.ok(auto, 'test-automation item present');
  assert.equal(auto!.score, 65);
  assert.equal(auto!.applicability, 'applicable');
  assert.equal(auto!.collector.tool, 'qulib_score_automation');
});

// ---------------------------------------------------------------------------
// ApiCoverageResult → api-coverage
// ---------------------------------------------------------------------------

test('api-coverage 0 endpoints → not_applicable carried through verbatim', () => {
  const input = buildConfidenceInputFromQulib({
    apiCoverage: makeApiCoverage('not_applicable'),
    subject: baseSubject,
  });
  const api = input.evidence.find((e) => e.source === 'api-coverage');
  assert.ok(api, 'api-coverage item present');
  assert.equal(api!.applicability, 'not_applicable');
  assert.equal(api!.score, 0);
});

test('api-coverage applicable passes through score', () => {
  const input = buildConfidenceInputFromQulib({
    apiCoverage: makeApiCoverage('applicable'),
    subject: baseSubject,
  });
  const api = input.evidence.find((e) => e.source === 'api-coverage');
  assert.ok(api);
  assert.equal(api!.applicability, 'applicable');
  assert.equal(api!.score, 80);
  assert.equal(api!.collector.tool, 'qulib_score_api');
});
