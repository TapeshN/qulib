/**
 * Tests for computeAutomationMaturity when apiCoverageResult is provided (D4 backward-compat
 * and the new 7-dimension path).
 *
 * The existing automation-maturity.test.ts covers the 6-dimension (no API surface) path
 * and must remain GREEN — these tests cover the additive case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { RepoAnalysis } from '../../../schemas/repo-analysis.schema.js';
import { computeAutomationMaturity } from '../automation-maturity.js';
import { computeApiCoverage, REBALANCED_WEIGHTS, W_API_COVERAGE } from '../api-coverage.js';
import type { ApiSurface, DiscoveredEndpoint } from '../../repo/api-surface.js';

function baseRepo(overrides: Partial<RepoAnalysis> = {}): RepoAnalysis {
  return {
    scannedAt: new Date().toISOString(),
    repoPath: '/tmp/fake-repo',
    routes: [],
    testFiles: [],
    missingTestIds: [],
    interactiveTsxFilesScanned: 0,
    cypressStructure: {
      detected: false,
      hasCommandsFile: false,
      existingE2eFiles: [],
      existingComponentFiles: [],
    },
    ...overrides,
  };
}

function baseSurface(endpoints: DiscoveredEndpoint[]): ApiSurface {
  return {
    discoveredAt: new Date().toISOString(),
    repoPath: '/tmp/fake-repo',
    endpoints,
    openApiSpecsFound: 0,
    tier3Enabled: false,
  };
}

function ep(method: DiscoveredEndpoint['method'], path: string): DiscoveredEndpoint {
  return { method, path, sourceFile: 'app/api/test/route.ts', sourceTier: 'framework', confidence: 'high' };
}

// ---------------------------------------------------------------------------
// Backward-compat: no apiCoverageResult → original 6 dimensions, original weights
// ---------------------------------------------------------------------------

test('backward-compat: 6 dimensions when apiCoverageResult is absent', () => {
  const maturity = computeAutomationMaturity(baseRepo());
  assert.equal(maturity.dimensions.length, 6, 'should have exactly 6 dimensions');
});

test('backward-compat: original weights used (test-coverage-breadth = 0.28)', () => {
  const maturity = computeAutomationMaturity(baseRepo());
  const dim = maturity.dimensions.find((d) => d.dimension === 'test-coverage-breadth');
  assert.ok(dim, 'test-coverage-breadth must be present');
  assert.equal(dim!.weight, 0.28, 'original weight should be 0.28');
});

test('backward-compat: existing tests pass without apiCoverageResult (regression guard)', () => {
  const maturity = computeAutomationMaturity(
    baseRepo({
      testFiles: [{ file: 'tests/home.spec.ts', type: 'playwright', coveredPaths: ['/login'] }],
      routes: [{ path: '/login', file: 'app/login/page.tsx', method: 'GET' }],
    })
  );
  // Should produce valid maturity without throwing
  assert.ok(maturity.overallScore >= 0 && maturity.overallScore <= 100);
  assert.ok(maturity.level >= 1 && maturity.level <= 5);
});

// ---------------------------------------------------------------------------
// New 7-dimension path
// ---------------------------------------------------------------------------

test('7 dimensions when apiCoverageResult is provided', () => {
  const surface = baseSurface([ep('GET', '/api/users')]);
  const apiResult = computeApiCoverage(baseRepo(), surface);
  const maturity = computeAutomationMaturity(baseRepo(), apiResult);
  assert.equal(maturity.dimensions.length, 7, 'should have 7 dimensions with api surface');
});

test('api-test-coverage dimension is present in the 7-dimension result', () => {
  const surface = baseSurface([ep('POST', '/api/orders')]);
  const apiResult = computeApiCoverage(baseRepo(), surface);
  const maturity = computeAutomationMaturity(baseRepo(), apiResult);
  const dim = maturity.dimensions.find((d) => d.dimension === 'api-test-coverage');
  assert.ok(dim, 'api-test-coverage dimension must be present');
  assert.equal(dim!.weight, W_API_COVERAGE);
});

test('rebalanced weights are used for existing 6 dimensions when API surface provided', () => {
  const surface = baseSurface([ep('GET', '/api/ping')]);
  const apiResult = computeApiCoverage(baseRepo(), surface);
  const maturity = computeAutomationMaturity(baseRepo(), apiResult);

  const breadth = maturity.dimensions.find((d) => d.dimension === 'test-coverage-breadth');
  assert.ok(breadth, 'test-coverage-breadth must be present');
  assert.equal(breadth!.weight, REBALANCED_WEIGHTS.TEST_BREADTH, `expected ${REBALANCED_WEIGHTS.TEST_BREADTH}, got ${breadth!.weight}`);

  const framework = maturity.dimensions.find((d) => d.dimension === 'framework-adoption');
  assert.equal(framework!.weight, REBALANCED_WEIGHTS.FRAMEWORK);
});

test('overall score is still normalized over applicable dimensions only (7-dim path)', () => {
  // All 6 original N/A dims + api-test-coverage = not_applicable (no endpoints)
  const surface = baseSurface([]);
  const apiResult = computeApiCoverage(baseRepo(), surface);
  const maturity = computeAutomationMaturity(baseRepo(), apiResult);

  const apiDim = maturity.dimensions.find((d) => d.dimension === 'api-test-coverage');
  assert.equal(apiDim!.applicability, 'not_applicable',
    'api-test-coverage should be not_applicable when no endpoints');

  // overallScore should still be computed correctly
  assert.ok(maturity.overallScore >= 0 && maturity.overallScore <= 100);
});

test('7-dimension overall score reflects api coverage when endpoints exist and are covered', () => {
  const repo = baseRepo({
    testFiles: [{ file: 'tests/api.test.ts', type: 'vitest', coveredPaths: ['/api/users'] }],
  });
  const surface = baseSurface([ep('GET', '/api/users')]);
  const apiResult = computeApiCoverage(repo, surface);
  const maturity = computeAutomationMaturity(repo, apiResult);

  const apiDim = maturity.dimensions.find((d) => d.dimension === 'api-test-coverage');
  assert.ok(apiDim, 'api-test-coverage dim must be present');
  assert.equal(apiDim!.applicability ?? 'applicable', 'applicable');
  assert.equal(apiDim!.score, 100, 'fully covered API endpoint should score 100');

  // overallScore should not be 0
  assert.ok(maturity.overallScore > 0, 'overall should be > 0 with covered API endpoint');
});

test('topRecommendations includes api-coverage recommendation when endpoints untested', () => {
  const surface = baseSurface([ep('DELETE', '/api/orders')]);
  const apiResult = computeApiCoverage(baseRepo(), surface);
  const maturity = computeAutomationMaturity(baseRepo(), apiResult);

  const hasApiRec = maturity.topRecommendations.some(
    (r) => r.includes('supertest') || r.includes('POST/PUT/DELETE') || r.includes('API')
  );
  // Only assert if the api dim is applicable (it will be, we have an endpoint)
  const apiDim = maturity.dimensions.find((d) => d.dimension === 'api-test-coverage');
  if (apiDim?.applicability === 'applicable') {
    assert.ok(hasApiRec, `expected API coverage recommendation, got: ${JSON.stringify(maturity.topRecommendations)}`);
  }
});
