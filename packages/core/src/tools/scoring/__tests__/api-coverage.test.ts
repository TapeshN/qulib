import test from 'node:test';
import assert from 'node:assert/strict';
import { computeApiCoverage, REBALANCED_WEIGHTS, W_API_COVERAGE } from '../api-coverage.js';
import type { RepoAnalysis } from '../../../schemas/repo-analysis.schema.js';
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

function baseSurface(endpoints: DiscoveredEndpoint[], overrides: Partial<ApiSurface> = {}): ApiSurface {
  return {
    discoveredAt: new Date().toISOString(),
    repoPath: '/tmp/fake-repo',
    endpoints,
    openApiSpecsFound: 0,
    tier3Enabled: false,
    ...overrides,
  };
}

function ep(
  method: DiscoveredEndpoint['method'],
  path: string,
  sourceFile = 'app/api/test/route.ts',
  tier: DiscoveredEndpoint['sourceTier'] = 'framework'
): DiscoveredEndpoint {
  return { method, path, sourceFile, sourceTier: tier, confidence: 'high' };
}

// ---------------------------------------------------------------------------
// Not-applicable: no endpoints
// ---------------------------------------------------------------------------

test('api-test-coverage is not_applicable when no endpoints discovered', () => {
  const result = computeApiCoverage(baseRepo(), baseSurface([]));
  const dim = result.dimension;
  assert.equal(dim.dimension, 'api-test-coverage');
  assert.equal(dim.applicability, 'not_applicable');
  assert.equal(dim.score, 0);
  assert.ok(typeof dim.reason === 'string' && dim.reason.length > 0, 'reason must be set');
  assert.ok(typeof dim.guidance === 'string' && dim.guidance.length > 0, 'guidance must be set');
  assert.equal(result.endpointCoverage.length, 0);
});

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

test('score is 100 when all endpoints are covered', () => {
  const repo = baseRepo({
    testFiles: [
      { file: 'tests/users.test.ts', type: 'vitest', coveredPaths: ['/api/users'] },
    ],
  });
  const surface = baseSurface([ep('GET', '/api/users')]);
  const result = computeApiCoverage(repo, surface);
  assert.equal(result.dimension.score, 100);
  assert.equal(result.untestedHighSeverityCount, 0);
  assert.equal(result.untestedMediumSeverityCount, 0);
});

test('score is 0 when no endpoints are covered', () => {
  const repo = baseRepo({ testFiles: [] });
  const surface = baseSurface([ep('POST', '/api/orders'), ep('DELETE', '/api/orders')]);
  const result = computeApiCoverage(repo, surface);
  assert.equal(result.dimension.score, 0);
  assert.equal(result.untestedHighSeverityCount, 2, 'POST and DELETE are high severity');
  assert.equal(result.untestedMediumSeverityCount, 0);
});

test('score is proportional: 1 of 2 covered = 50', () => {
  const repo = baseRepo({
    testFiles: [
      // users.test.ts covers /api/users (GET), but billing has no test
      { file: 'tests/users.test.ts', type: 'vitest', coveredPaths: ['/api/users'] },
    ],
  });
  const surface = baseSurface([ep('GET', '/api/users'), ep('DELETE', '/api/billing')]);
  const result = computeApiCoverage(repo, surface);
  assert.equal(result.dimension.score, 50);
  assert.equal(result.untestedHighSeverityCount, 1, 'DELETE /api/billing is high severity');
});

// ---------------------------------------------------------------------------
// Coverage matching
// ---------------------------------------------------------------------------

test('direct coveredPath match covers an endpoint', () => {
  const repo = baseRepo({
    testFiles: [{ file: 'tests/ping.test.ts', type: 'vitest', coveredPaths: ['/api/ping'] }],
  });
  const surface = baseSurface([ep('GET', '/api/ping')]);
  const result = computeApiCoverage(repo, surface);
  assert.equal(result.endpointCoverage[0]?.covered, true);
  assert.equal(result.endpointCoverage[0]?.coveringTestFile, 'tests/ping.test.ts');
});

test('heuristic: test filename token match covers endpoint', () => {
  const repo = baseRepo({
    testFiles: [{ file: 'tests/orders.test.ts', type: 'vitest', coveredPaths: [] }],
  });
  const surface = baseSurface([ep('POST', '/api/orders')]);
  const result = computeApiCoverage(repo, surface);
  assert.equal(result.endpointCoverage[0]?.covered, true,
    'filename token "orders" should match /api/orders');
});

test('endpoint is NOT covered when no coveredPaths or filename match', () => {
  const repo = baseRepo({
    testFiles: [{ file: 'tests/auth.test.ts', type: 'vitest', coveredPaths: ['/login'] }],
  });
  const surface = baseSurface([ep('DELETE', '/api/billing')]);
  const result = computeApiCoverage(repo, surface);
  assert.equal(result.endpointCoverage[0]?.covered, false);
  assert.equal(result.untestedHighSeverityCount, 1);
});

// ---------------------------------------------------------------------------
// Severity classification
// ---------------------------------------------------------------------------

test('POST/PUT/DELETE/PATCH endpoints are high severity', () => {
  const surface = baseSurface([
    ep('POST', '/api/x'),
    ep('PUT', '/api/x'),
    ep('DELETE', '/api/x'),
    ep('PATCH', '/api/x'),
  ]);
  const result = computeApiCoverage(baseRepo(), surface);
  for (const cov of result.endpointCoverage) {
    assert.equal(cov.severity, 'high', `expected high for ${cov.method}`);
  }
});

test('GET endpoints are medium severity', () => {
  const surface = baseSurface([ep('GET', '/api/users')]);
  const result = computeApiCoverage(baseRepo(), surface);
  assert.equal(result.endpointCoverage[0]?.severity, 'medium');
});

// ---------------------------------------------------------------------------
// Evidence and recommendations
// ---------------------------------------------------------------------------

test('evidence lists per-endpoint coverage status', () => {
  const repo = baseRepo({
    testFiles: [{ file: 'tests/users.test.ts', type: 'vitest', coveredPaths: ['/api/users'] }],
  });
  const surface = baseSurface([ep('GET', '/api/users'), ep('POST', '/api/orders')]);
  const result = computeApiCoverage(repo, surface);
  const evText = result.dimension.evidence.join(' ');
  assert.ok(evText.includes('/api/users'), 'evidence should mention /api/users');
  assert.ok(evText.includes('/api/orders'), 'evidence should mention /api/orders');
});

test('OpenAPI spec note appears in evidence when specs are found', () => {
  const surface = baseSurface([ep('GET', '/api/ping', 'openapi.yaml', 'openapi')], {
    openApiSpecsFound: 1,
  });
  const result = computeApiCoverage(baseRepo(), surface);
  const evText = result.dimension.evidence[0] ?? '';
  assert.ok(evText.includes('OpenAPI'), `expected "OpenAPI" in evidence[0], got: ${evText}`);
});

test('recommendations list untested high-severity endpoints', () => {
  const surface = baseSurface([ep('DELETE', '/api/users')]);
  const result = computeApiCoverage(baseRepo(), surface);
  assert.ok(result.dimension.recommendations.length > 0, 'should have recommendations');
  assert.ok(
    result.dimension.recommendations[0]?.includes('supertest') ||
    result.dimension.recommendations[0]?.includes('POST/PUT/DELETE'),
    `expected recommendation to mention mutation methods, got: ${result.dimension.recommendations[0]}`
  );
});

// ---------------------------------------------------------------------------
// Weight constants
// ---------------------------------------------------------------------------

test('W_API_COVERAGE is 0.15', () => {
  assert.equal(W_API_COVERAGE, 0.15);
});

test('REBALANCED_WEIGHTS sum to 0.85 (leaving room for api-test-coverage 0.15)', () => {
  const sum = Object.values(REBALANCED_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(
    Math.abs(sum - 0.85) < 0.001,
    `REBALANCED_WEIGHTS should sum to 0.85, got ${sum}`
  );
});

test('all 7 weights sum to 1.0 when combined', () => {
  const combinedSum = Object.values(REBALANCED_WEIGHTS).reduce((a, b) => a + b, 0) + W_API_COVERAGE;
  assert.ok(
    Math.abs(combinedSum - 1.0) < 0.001,
    `All 7 dimension weights should sum to 1.0, got ${combinedSum}`
  );
});

// ---------------------------------------------------------------------------
// Dimension shape
// ---------------------------------------------------------------------------

test('dimension result carries the required schema fields', () => {
  const surface = baseSurface([ep('GET', '/api/test')]);
  const result = computeApiCoverage(baseRepo(), surface);
  assert.equal(result.dimension.dimension, 'api-test-coverage');
  assert.equal(result.dimension.weight, 0.15);
  assert.ok(Array.isArray(result.dimension.evidence));
  assert.ok(Array.isArray(result.dimension.recommendations));
});
