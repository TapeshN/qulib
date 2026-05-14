import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAnalyzeResult } from '../summarize-analyze-result.js';
import type { AnalyzeResult } from '@qulib/core';

const minimalResult = (): AnalyzeResult => {
  const gaps = [
    {
      id: '1',
      path: '/a',
      severity: 'high' as const,
      reason: 'console',
      category: 'console-error' as const,
    },
    {
      id: '2',
      path: '/b',
      severity: 'low' as const,
      reason: 'link',
      category: 'broken-link' as const,
    },
  ];
  return {
    status: 'complete',
    coverageScore: 0,
    releaseConfidence: 55,
    gaps,
    gapAnalysis: {
      analyzedAt: new Date().toISOString(),
      mode: 'url-only',
      releaseConfidence: 55,
      coveragePagesScanned: 2,
      coverageBudgetExceeded: false,
      gaps,
      scenarios: [],
      generatedTests: [],
      costIntelligence: {
        maxOutputTokensPerLlmCall: 1024,
        budgetRole: 'max-output-tokens-per-llm-call',
        records: [],
        budgetWarnings: [],
        usageSummary: { totalInputTokens: 0, totalOutputTokens: 0, dataQuality: 'none' },
        repeatedOperations: [],
        deterministicMaturity: {
          level: 1,
          label: 'L1',
          rationale: 'test',
        },
        conversionRecommendations: ['do x'],
      },
    },
    routeInventory: {
      scannedAt: new Date().toISOString(),
      baseUrl: 'https://example.com',
      routes: [],
      pagesSkipped: 0,
      budgetExceeded: false,
    },
    repoInventory: null,
    decisionLog: [],
    publicSurface: null,
  };
};

test('summarizeAnalyzeResult returns full result when includeFullReport', () => {
  const r = minimalResult();
  const out = summarizeAnalyzeResult(r, true);
  assert.equal(out, r);
});

test('summarizeAnalyzeResult summary-first shape', () => {
  const r = minimalResult();
  const out = summarizeAnalyzeResult(r, false) as Record<string, unknown>;
  assert.equal(out.includeFullReport, false);
  assert.equal((out.summary as { status: string }).status, 'complete');
  assert.equal((out.summary as { coverageScore: number }).coverageScore, 0);
  assert.ok(Array.isArray(out.topGaps));
  assert.equal((out.topGaps as { severity: string }[])[0]!.severity, 'high');
  assert.ok(out.costIntelligenceSummary);
  assert.equal((out.gapAnalysisPreview as { scenariosOmitted: number }).scenariosOmitted, 0);
  assert.ok(Array.isArray(out.nextDeterministicChecks));
});

test('summarizeAnalyzeResult orders critical ahead of high in topGaps', () => {
  const r = minimalResult();
  r.gaps.unshift({
    id: '0',
    path: '/z',
    severity: 'critical',
    reason: 'auth',
    category: 'coverage',
  });
  r.gapAnalysis.gaps = r.gaps;
  const out = summarizeAnalyzeResult(r, false) as { topGaps: { severity: string }[] };
  assert.equal(out.topGaps[0]!.severity, 'critical');
});

test('summarizeAnalyzeResult summary includes publicSurface counts when present', () => {
  const r = minimalResult();
  r.publicSurface = {
    pages: [{ path: '/', pageTitle: 'x', links: [], formCount: 0, buttonLabels: [], consoleErrors: [], brokenLinks: [], a11yViolations: [] }],
    gaps: [],
    accessibilityViolations: [{ id: 'a', impact: 'serious', helpUrl: 'u', nodeCount: 1, path: '/' }],
    brokenLinks: [{ url: 'https://x', status: 404, path: '/' }],
  };
  const out = summarizeAnalyzeResult(r, false) as { summary: { publicSurface: Record<string, number> } };
  assert.equal(out.summary.publicSurface.pageCount, 1);
  assert.equal(out.summary.publicSurface.accessibilityViolationCount, 1);
  assert.equal(out.summary.publicSurface.brokenLinkCount, 1);
});

test('summarizeAnalyzeResult replaces repoInventory with a bounded repoInventorySummary in compact mode', () => {
  const r = minimalResult();
  r.repoInventory = {
    scannedAt: new Date().toISOString(),
    repoPath: '/tmp/repo',
    routes: Array.from({ length: 50 }, (_, i) => ({
      path: `/route-${i}`,
      file: `app/route-${i}/page.tsx`,
      method: 'GET' as const,
    })),
    testFiles: Array.from({ length: 200 }, (_, i) => ({
      file: `tests/test-${i}.spec.ts`,
      type: 'playwright' as const,
      coveredPaths: [`/route-${i % 10}`],
    })),
    missingTestIds: Array.from({ length: 300 }, (_, i) => `src/components/comp-${i}.tsx`),
    interactiveTsxFilesScanned: 350,
    cypressStructure: {
      detected: false,
      hasCommandsFile: false,
      existingE2eFiles: [],
      existingComponentFiles: [],
    },
    framework: {
      primary: 'nextjs-app-router',
      confidence: 'high',
      evidence: ['read package.json', 'found next.config.*', 'Next.js app/ directory present'],
      testFrameworks: ['playwright'],
    },
  };
  const out = summarizeAnalyzeResult(r, false) as Record<string, unknown>;
  assert.equal((out as { repoInventory?: unknown }).repoInventory, undefined);
  const summary = out.repoInventorySummary as Record<string, unknown>;
  assert.ok(summary, 'repoInventorySummary is present');
  assert.equal(summary.routeCount, 50);
  assert.equal(summary.testFileCount, 200);
  assert.equal(summary.missingTestIdCount, 300);
  assert.equal(summary.interactiveTsxFilesScanned, 350);
  assert.equal(summary.cypressDetected, false);
  const framework = summary.framework as Record<string, unknown>;
  assert.equal(framework.primary, 'nextjs-app-router');
  assert.equal(framework.evidenceCount, 3);
  // Hard-bounded: the compact payload must NEVER carry the raw testFiles or missingTestIds arrays.
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes('tests/test-0.spec.ts'), 'testFiles array must not leak into compact payload');
  assert.ok(!serialized.includes('comp-0.tsx'), 'missingTestIds array must not leak into compact payload');
});

test('summarizeAnalyzeResult includes maturity dimensions with applicability and guidance', () => {
  const r = minimalResult();
  r.repoInventory = {
    scannedAt: new Date().toISOString(),
    repoPath: '/tmp/repo',
    routes: [],
    testFiles: [],
    missingTestIds: [],
    cypressStructure: {
      detected: false,
      hasCommandsFile: false,
      existingE2eFiles: [],
      existingComponentFiles: [],
    },
    automationMaturity: {
      computedAt: new Date().toISOString(),
      repoPath: '/tmp/repo',
      overallScore: 30,
      level: 2,
      label: 'L2 — emerging coverage',
      dimensions: [
        {
          dimension: 'component-test-ratio',
          score: 0,
          weight: 0.08,
          evidence: ['no cypress'],
          recommendations: [],
          applicability: 'not_applicable',
          reason: 'No Cypress (e2e or component) tests detected.',
          guidance: 'No Cypress component test setup detected. Add cypress/component/ tests and a component config to enable this dimension.',
        },
        {
          dimension: 'test-coverage-breadth',
          score: 80,
          weight: 0.28,
          evidence: ['8/10 routes covered'],
          recommendations: [],
          applicability: 'applicable',
        },
      ],
      topRecommendations: [],
      scoreFormula: 'overallScore = ...',
    },
  };
  const out = summarizeAnalyzeResult(r, false) as {
    automationMaturitySummary?: {
      dimensions: Array<{ dimension: string; applicability: string; guidance?: string }>;
    };
  };

  const summary = out.automationMaturitySummary;
  assert.ok(summary, 'automationMaturitySummary should be present');
  assert.ok(Array.isArray(summary.dimensions), 'dimensions array should be present');

  const compDim = summary.dimensions.find((d) => d.dimension === 'component-test-ratio');
  assert.ok(compDim, 'component-test-ratio dimension should be in summary');
  assert.equal(compDim.applicability, 'not_applicable');
  assert.ok(
    typeof compDim.guidance === 'string' && compDim.guidance.length > 0,
    'guidance should be carried through to the summary'
  );

  const breadthDim = summary.dimensions.find((d) => d.dimension === 'test-coverage-breadth');
  assert.ok(breadthDim, 'test-coverage-breadth dimension should be in summary');
  assert.equal(breadthDim.applicability, 'applicable');
  assert.equal(breadthDim.guidance, undefined, 'applicable dimension without guidance should omit the field');
});

test('summarizeAnalyzeResult returns the full repoInventory when includeFullReport is true', () => {
  const r = minimalResult();
  r.repoInventory = {
    scannedAt: new Date().toISOString(),
    repoPath: '/tmp/repo',
    routes: [],
    testFiles: [{ file: 'tests/a.spec.ts', type: 'playwright', coveredPaths: ['/'] }],
    missingTestIds: ['src/components/foo.tsx'],
    cypressStructure: {
      detected: false,
      hasCommandsFile: false,
      existingE2eFiles: [],
      existingComponentFiles: [],
    },
  };
  const out = summarizeAnalyzeResult(r, true);
  assert.equal(out, r);
  const serialized = JSON.stringify(out);
  assert.ok(serialized.includes('tests/a.spec.ts'), 'full report still ships the testFiles array');
});
