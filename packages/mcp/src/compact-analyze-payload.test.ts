import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompactAnalyzePayload } from './compact-analyze-payload.js';
import type { AnalyzeResult } from '@qulib/core';

const minimalResult = (): AnalyzeResult => ({
  releaseConfidence: 55,
  gapAnalysis: {
    analyzedAt: new Date().toISOString(),
    mode: 'url-only',
    releaseConfidence: 55,
    coveragePagesScanned: 2,
    coverageBudgetExceeded: false,
    gaps: [
      {
        id: '1',
        path: '/a',
        severity: 'high',
        reason: 'console',
        category: 'console-error',
      },
      {
        id: '2',
        path: '/b',
        severity: 'low',
        reason: 'link',
        category: 'broken-link',
      },
    ],
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
});

test('buildCompactAnalyzePayload returns full result when includeFullReport', () => {
  const r = minimalResult();
  const out = buildCompactAnalyzePayload(r, true);
  assert.equal(out, r);
});

test('buildCompactAnalyzePayload summary-first shape', () => {
  const r = minimalResult();
  const out = buildCompactAnalyzePayload(r, false) as Record<string, unknown>;
  assert.equal(out.includeFullReport, false);
  assert.ok(Array.isArray(out.topGaps));
  assert.equal((out.topGaps as { severity: string }[])[0]!.severity, 'high');
  assert.ok(out.costIntelligenceSummary);
  assert.equal((out.gapAnalysisPreview as { scenariosOmitted: number }).scenariosOmitted, 0);
  assert.ok(Array.isArray(out.nextDeterministicChecks));
});
