import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RepoAnalysis } from '../../../schemas/repo-analysis.schema.js';
import { computeAutomationMaturity } from '../automation-maturity.js';

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

test('component-test-ratio is not_applicable when no Cypress is detected', () => {
  const maturity = computeAutomationMaturity(baseRepo());
  const dim = maturity.dimensions.find((d) => d.dimension === 'component-test-ratio');
  assert.ok(dim, 'component-test-ratio dimension present');
  assert.equal(dim!.applicability, 'not_applicable');
  assert.equal(dim!.score, 0);
  assert.match(dim!.reason ?? '', /No Cypress/);
});

test('component-test-ratio is applicable when Cypress component tests exist', () => {
  const maturity = computeAutomationMaturity(
    baseRepo({
      testFiles: [
        { file: 'cypress/e2e/a.cy.ts', type: 'cypress-e2e', coveredPaths: ['/'] },
        { file: 'cypress/component/b.cy.tsx', type: 'cypress-component', coveredPaths: [] },
      ],
    })
  );
  const dim = maturity.dimensions.find((d) => d.dimension === 'component-test-ratio');
  assert.equal(dim!.applicability, 'applicable');
  assert.equal(dim!.score, 50);
});

test('auth-test-coverage is not_applicable when repo has no auth signal', () => {
  const maturity = computeAutomationMaturity(
    baseRepo({
      routes: [{ path: '/dashboard', file: 'app/dashboard/page.tsx', method: 'GET' }],
      testFiles: [{ file: 'tests/home.spec.ts', type: 'playwright', coveredPaths: ['/'] }],
    })
  );
  const dim = maturity.dimensions.find((d) => d.dimension === 'auth-test-coverage');
  assert.equal(dim!.applicability, 'not_applicable');
  assert.equal(dim!.score, 0);
});

test('auth-test-coverage is applicable when repo has an /auth route but no auth-test coverage', () => {
  const maturity = computeAutomationMaturity(
    baseRepo({
      routes: [{ path: '/login', file: 'app/login/page.tsx', method: 'GET' }],
      testFiles: [{ file: 'tests/home.spec.ts', type: 'playwright', coveredPaths: ['/'] }],
    })
  );
  const dim = maturity.dimensions.find((d) => d.dimension === 'auth-test-coverage');
  assert.equal(dim!.applicability, 'applicable');
  assert.equal(dim!.score, 25);
});

test('auth-test-coverage scores 90 when a test covers /login', () => {
  const maturity = computeAutomationMaturity(
    baseRepo({
      routes: [{ path: '/login', file: 'app/login/page.tsx', method: 'GET' }],
      testFiles: [{ file: 'tests/login.spec.ts', type: 'playwright', coveredPaths: ['/login'] }],
    })
  );
  const dim = maturity.dimensions.find((d) => d.dimension === 'auth-test-coverage');
  assert.equal(dim!.applicability, 'applicable');
  assert.equal(dim!.score, 90);
});

test('test-id-hygiene is unknown when no interactive TSX files were scanned', () => {
  const maturity = computeAutomationMaturity(
    baseRepo({ interactiveTsxFilesScanned: 0, missingTestIds: [] })
  );
  const dim = maturity.dimensions.find((d) => d.dimension === 'test-id-hygiene');
  assert.equal(dim!.applicability, 'unknown');
  assert.equal(dim!.score, 0);
});

test('test-id-hygiene scores on the missing-id ratio when interactive files exist', () => {
  const maturity = computeAutomationMaturity(
    baseRepo({
      interactiveTsxFilesScanned: 10,
      missingTestIds: ['a.tsx', 'b.tsx'],
    })
  );
  const dim = maturity.dimensions.find((d) => d.dimension === 'test-id-hygiene');
  assert.equal(dim!.applicability, 'applicable');
  assert.equal(dim!.score, 80);
});

test('overallScore normalizes over applicable dimensions only', () => {
  // Repo with NO auth, NO Cypress, NO interactive TSX → both component-test-ratio and
  // auth-test-coverage are not_applicable; test-id-hygiene is unknown. Overall score
  // should be computed only across breadth + framework + ci, not weighted-averaged with
  // the absent dimensions sitting at 0.
  const maturity = computeAutomationMaturity(
    baseRepo({
      routes: [{ path: '/', file: 'app/page.tsx', method: 'GET' }],
      testFiles: [{ file: 'tests/home.spec.ts', type: 'playwright', coveredPaths: ['/'] }],
    })
  );
  const breadth = maturity.dimensions.find((d) => d.dimension === 'test-coverage-breadth')!;
  const framework = maturity.dimensions.find((d) => d.dimension === 'framework-adoption')!;
  const ci = maturity.dimensions.find((d) => d.dimension === 'ci-integration')!;
  const expectedNumerator =
    breadth.score * breadth.weight + framework.score * framework.weight + ci.score * ci.weight;
  const expectedDenominator = breadth.weight + framework.weight + ci.weight;
  const expected = Math.round(expectedNumerator / expectedDenominator);
  assert.equal(maturity.overallScore, expected);
  // Sanity: the score must NOT be dragged down by the absent dimensions.
  // If we had used the old formula (Σ score*weight over ALL dims) the result would be much lower
  // because three dimensions sit at score 0 with non-zero weight.
  const oldFormula = Math.round(
    maturity.dimensions.reduce((s, d) => s + d.score * d.weight, 0)
  );
  assert.ok(
    expected > oldFormula,
    `applicable-only normalization (${expected}) should beat naive sum (${oldFormula}) when N/A dims are present`
  );
});

test('topRecommendations excludes recommendations from non-applicable dimensions', () => {
  const maturity = computeAutomationMaturity(baseRepo());
  for (const rec of maturity.topRecommendations) {
    assert.ok(
      !/Balance component vs E2E Cypress/.test(rec),
      `unexpected Cypress balance recommendation: ${rec}`
    );
    assert.ok(
      !/Add focused tests for sign-in/.test(rec),
      `unexpected auth recommendation: ${rec}`
    );
  }
});

test('scoreFormula is documented on the result', () => {
  const maturity = computeAutomationMaturity(baseRepo());
  assert.ok(maturity.scoreFormula, 'scoreFormula present');
  assert.match(maturity.scoreFormula!, /applicable/i);
});
