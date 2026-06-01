/**
 * @module tools/scoring/api-coverage
 *
 * Computes the `api-test-coverage` dimension for the automation maturity score.
 *
 * Weight: 0.15. The six existing dimensions have been rebalanced to sum to 1.0:
 *
 *   Before (sum = 1.0):
 *     test-coverage-breadth   0.28
 *     framework-adoption      0.22
 *     test-id-hygiene         0.18
 *     ci-integration          0.14
 *     auth-test-coverage      0.10
 *     component-test-ratio    0.08
 *                             ────
 *                             1.00
 *
 *   After (sum = 1.0, api-test-coverage added at 0.15):
 *     test-coverage-breadth   0.24   (-0.04)
 *     framework-adoption      0.19   (-0.03)
 *     test-id-hygiene         0.15   (-0.03)
 *     ci-integration          0.12   (-0.02)
 *     auth-test-coverage      0.09   (-0.01)
 *     component-test-ratio    0.06   (-0.02)
 *     api-test-coverage       0.15   (new)
 *                             ────
 *                             1.00
 *
 * Scoring rules:
 *   - If 0 API endpoints discovered → applicability = 'not_applicable' (excluded from denominator)
 *   - A test file "covers" an endpoint if:
 *       (a) the endpoint path appears verbatim in the file's coveredPaths, OR
 *       (b) the file name contains a token from the endpoint path (heuristic fallback)
 *   - Each endpoint that is covered raises the score proportionally.
 *   - POST/PUT/DELETE endpoints are HIGH severity gaps when untested;
 *     GET endpoints are MEDIUM severity gaps when untested.
 *
 * Evidence is per-endpoint and contextual:
 *   "GET /api/users — found in app/api/users/route.ts, covered by tests/api/users.test.ts"
 *   "POST /api/orders — found in app/api/orders/route.ts, NOT covered"
 */

import type { RepoAnalysis } from '../../schemas/repo-analysis.schema.js';
import type {
  AutomationMaturityDimension,
  AutomationMaturityApplicability,
} from '../../schemas/automation-maturity.schema.js';
import type { ApiSurface, DiscoveredEndpoint } from '../repo/api-surface.js';

export const W_API_COVERAGE = 0.15;

/**
 * Rebalanced weights for the original 6 dimensions (sum = 0.85).
 * Export these so automation-maturity.ts can import and use them.
 */
export const REBALANCED_WEIGHTS = {
  TEST_BREADTH: 0.24,
  FRAMEWORK: 0.19,
  TEST_ID: 0.15,
  CI: 0.12,
  AUTH_TESTS: 0.09,
  COMPONENT_RATIO: 0.06,
} as const;

export interface ApiEndpointCoverage {
  method: DiscoveredEndpoint['method'];
  path: string;
  sourceFile: string;
  sourceTier: DiscoveredEndpoint['sourceTier'];
  covered: boolean;
  coveringTestFile?: string;
  severity: 'high' | 'medium' | 'low';
}

export interface ApiCoverageResult {
  dimension: AutomationMaturityDimension;
  endpointCoverage: ApiEndpointCoverage[];
  untestedHighSeverityCount: number;
  untestedMediumSeverityCount: number;
}

/**
 * Returns true if testCoveredPaths or test filename hints that it covers endpointPath.
 */
function endpointIsCovered(
  endpoint: DiscoveredEndpoint,
  testFile: RepoAnalysis['testFiles'][number]
): boolean {
  const ep = endpoint.path.toLowerCase();

  // (a) Exact or prefix match in coveredPaths
  const directCover = testFile.coveredPaths.some((cp) => {
    const norm = cp.toLowerCase();
    return norm === ep || (ep !== '/' && ep.startsWith(norm) && (norm === ep || ep[norm.length] === '/'));
  });
  if (directCover) return true;

  // (b) Heuristic: test filename tokens match endpoint path segments
  const testFileName = testFile.file.toLowerCase();
  const segments = ep.split('/').filter((s) => s.length > 2 && !/^\[/.test(s));
  if (segments.length === 0) return false;
  return segments.some((seg) => testFileName.includes(seg));
}

function classifySeverity(method: DiscoveredEndpoint['method']): ApiEndpointCoverage['severity'] {
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') return 'high';
  if (method === 'PATCH') return 'high';
  return 'medium';
}

export function computeApiCoverage(
  repo: RepoAnalysis,
  apiSurface: ApiSurface
): ApiCoverageResult {
  const endpoints = apiSurface.endpoints;

  // Not applicable when there are no API endpoints
  if (endpoints.length === 0) {
    const dim: AutomationMaturityDimension = {
      dimension: 'api-test-coverage',
      score: 0,
      weight: W_API_COVERAGE,
      evidence: ['No API endpoints discovered — api-test-coverage dimension does not apply.'],
      recommendations: [],
      applicability: 'not_applicable' as AutomationMaturityApplicability,
      reason: 'No API endpoints discovered — api-test-coverage dimension does not apply.',
      guidance:
        'No API endpoints were found. If this repo has REST endpoints, ensure they are declared in a supported framework (Next.js route.ts, Express, Fastify, NestJS) or an OpenAPI spec file.',
    };
    return { dimension: dim, endpointCoverage: [], untestedHighSeverityCount: 0, untestedMediumSeverityCount: 0 };
  }

  const endpointCoverage: ApiEndpointCoverage[] = [];
  let coveredCount = 0;
  let untestedHighSeverityCount = 0;
  let untestedMediumSeverityCount = 0;
  const evidence: string[] = [];

  for (const ep of endpoints) {
    const severity = classifySeverity(ep.method);

    // Find the first test file that covers this endpoint
    let coveringTestFile: string | undefined;
    for (const tf of repo.testFiles) {
      if (endpointIsCovered(ep, tf)) {
        coveringTestFile = tf.file;
        break;
      }
    }

    const covered = coveringTestFile !== undefined;
    if (covered) {
      coveredCount++;
      evidence.push(
        `${ep.method} ${ep.path} — found in ${ep.sourceFile}, covered by ${coveringTestFile}`
      );
    } else {
      if (severity === 'high') untestedHighSeverityCount++;
      else untestedMediumSeverityCount++;
      evidence.push(
        `${ep.method} ${ep.path} — found in ${ep.sourceFile}, NOT covered`
      );
    }

    endpointCoverage.push({
      method: ep.method,
      path: ep.path,
      sourceFile: ep.sourceFile,
      sourceTier: ep.sourceTier,
      covered,
      ...(coveringTestFile !== undefined ? { coveringTestFile } : {}),
      severity,
    });
  }

  const score = Math.round((100 * coveredCount) / endpoints.length);

  const recommendations: string[] = [];
  if (untestedHighSeverityCount > 0) {
    recommendations.push(
      `${untestedHighSeverityCount} high-severity API endpoint(s) (POST/PUT/DELETE/PATCH) have no test coverage — add supertest or API-level tests.`
    );
  }
  if (untestedMediumSeverityCount > 0) {
    recommendations.push(
      `${untestedMediumSeverityCount} GET endpoint(s) have no test coverage — add route smoke tests.`
    );
  }

  const specNote = apiSurface.openApiSpecsFound > 0
    ? ` (${apiSurface.openApiSpecsFound} OpenAPI spec(s) parsed — Tier1 high-confidence)`
    : '';

  const dim: AutomationMaturityDimension = {
    dimension: 'api-test-coverage',
    score,
    weight: W_API_COVERAGE,
    evidence: [
      `${coveredCount}/${endpoints.length} API endpoints appear covered by test files${specNote}.`,
      ...evidence.slice(0, 10),
      ...(evidence.length > 10 ? [`… and ${evidence.length - 10} more endpoint(s)`] : []),
    ],
    recommendations,
    applicability: 'applicable',
  };

  return { dimension: dim, endpointCoverage, untestedHighSeverityCount, untestedMediumSeverityCount };
}
