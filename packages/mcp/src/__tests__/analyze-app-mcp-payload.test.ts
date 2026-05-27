import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyzeAppMcpPayload } from '../analyze-app-mcp-payload.js';
import type { AnalyzeResult } from '@qulib/core';

const minimalAnalyzeResult = (): AnalyzeResult => {
  const gaps = [
    {
      id: '1',
      path: '/a',
      severity: 'high' as const,
      reason: 'console',
      category: 'console-error' as const,
    },
  ];
  return {
    status: 'complete',
    coverageScore: 100,
    releaseConfidence: 85,
    gaps,
    gapAnalysis: {
      analyzedAt: new Date().toISOString(),
      mode: 'url-only',
      releaseConfidence: 85,
      coveragePagesScanned: 5,
      coverageBudgetExceeded: false,
      gaps,
      scenarios: [],
      generatedTests: [],
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

test('buildAnalyzeAppMcpPayload default matches summarize-first (no agentSummary)', () => {
  const r = minimalAnalyzeResult();
  const out = buildAnalyzeAppMcpPayload(r, {}) as Record<string, unknown>;
  assert.equal(out.includeFullReport, false);
  assert.ok('summary' in out);
  assert.ok('topGaps' in out);
});

test('buildAnalyzeAppMcpPayload agentSummary returns only toAgentSummary shape', () => {
  const r = minimalAnalyzeResult();
  const out = buildAnalyzeAppMcpPayload(r, { agentSummary: true }) as Record<string, unknown>;
  assert.equal(out.schemaVersion, 1);
  assert.ok('gate' in out);
  assert.ok('coverageStatus' in out);
  assert.ok(Array.isArray(out.topRisks));
  assert.ok(Array.isArray(out.honestyNotes));
  assert.ok(!('summary' in out));
  assert.ok(!('topGaps' in out));
});

test('buildAnalyzeAppMcpPayload agentSummary overrides includeFullReport', () => {
  const r = minimalAnalyzeResult();
  const out = buildAnalyzeAppMcpPayload(r, { agentSummary: true, includeFullReport: true }) as Record<string, unknown>;
  assert.equal(out.schemaVersion, 1);
  assert.ok(!('gapAnalysis' in out));
});
