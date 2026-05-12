import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompactAnalyzePayload } from './compact-analyze-payload.js';
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

test('buildCompactAnalyzePayload returns full result when includeFullReport', () => {
  const r = minimalResult();
  const out = buildCompactAnalyzePayload(r, true);
  assert.equal(out, r);
});

test('buildCompactAnalyzePayload summary-first shape', () => {
  const r = minimalResult();
  const out = buildCompactAnalyzePayload(r, false) as Record<string, unknown>;
  assert.equal(out.includeFullReport, false);
  assert.equal((out.summary as { status: string }).status, 'complete');
  assert.equal((out.summary as { coverageScore: number }).coverageScore, 0);
  assert.ok(Array.isArray(out.topGaps));
  assert.equal((out.topGaps as { severity: string }[])[0]!.severity, 'high');
  assert.ok(out.costIntelligenceSummary);
  assert.equal((out.gapAnalysisPreview as { scenariosOmitted: number }).scenariosOmitted, 0);
  assert.ok(Array.isArray(out.nextDeterministicChecks));
});

test('buildCompactAnalyzePayload orders critical ahead of high in topGaps', () => {
  const r = minimalResult();
  r.gaps.unshift({
    id: '0',
    path: '/z',
    severity: 'critical',
    reason: 'auth',
    category: 'coverage',
  });
  r.gapAnalysis.gaps = r.gaps;
  const out = buildCompactAnalyzePayload(r, false) as { topGaps: { severity: string }[] };
  assert.equal(out.topGaps[0]!.severity, 'critical');
});

test('buildCompactAnalyzePayload summary includes publicSurface counts when present', () => {
  const r = minimalResult();
  r.publicSurface = {
    pages: [{ path: '/', pageTitle: 'x', links: [], formCount: 0, buttonLabels: [], consoleErrors: [], brokenLinks: [], a11yViolations: [] }],
    gaps: [],
    accessibilityViolations: [{ id: 'a', impact: 'serious', helpUrl: 'u', nodeCount: 1, path: '/' }],
    brokenLinks: [{ url: 'https://x', status: 404, path: '/' }],
  };
  const out = buildCompactAnalyzePayload(r, false) as { summary: { publicSurface: Record<string, number> } };
  assert.equal(out.summary.publicSurface.pageCount, 1);
  assert.equal(out.summary.publicSurface.accessibilityViolationCount, 1);
  assert.equal(out.summary.publicSurface.brokenLinkCount, 1);
});
