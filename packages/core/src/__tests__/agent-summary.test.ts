import test from 'node:test';
import assert from 'node:assert/strict';
import { toAgentSummary } from '../agent-summary.js';
import type { AnalyzeResult } from '../analyze.js';
import type { Gap } from '../schemas/gap-analysis.schema.js';
import type { CostIntelligence } from '../schemas/cost-intelligence.schema.js';

const isoNow = (): string => new Date().toISOString();

interface FixtureOverrides {
  status?: AnalyzeResult['status'];
  releaseConfidence?: number | null;
  gaps?: Gap[];
  mode?: AnalyzeResult['gapAnalysis']['mode'];
  coverageWarning?: AnalyzeResult['gapAnalysis']['coverageWarning'];
  coveragePagesScanned?: number;
  coverageBudgetExceeded?: boolean;
  costIntelligence?: CostIntelligence;
}

function makeResult(overrides: FixtureOverrides = {}): AnalyzeResult {
  const gaps = overrides.gaps ?? [];
  const releaseConfidence = overrides.releaseConfidence ?? 90;
  return {
    status: overrides.status ?? 'complete',
    coverageScore: 100,
    releaseConfidence,
    gaps,
    gapAnalysis: {
      analyzedAt: isoNow(),
      mode: overrides.mode ?? 'url-only',
      releaseConfidence,
      coveragePagesScanned: overrides.coveragePagesScanned ?? 10,
      coverageBudgetExceeded: overrides.coverageBudgetExceeded ?? false,
      ...(overrides.coverageWarning !== undefined && { coverageWarning: overrides.coverageWarning }),
      gaps,
      scenarios: [],
      generatedTests: [],
      ...(overrides.costIntelligence !== undefined && {
        costIntelligence: overrides.costIntelligence,
      }),
    },
    routeInventory: {
      scannedAt: isoNow(),
      baseUrl: 'https://example.com',
      routes: [],
      pagesSkipped: 0,
      budgetExceeded: false,
    },
    repoInventory: null,
    decisionLog: [],
    publicSurface: null,
  };
}

function gap(severity: Gap['severity'], category: Gap['category'] = 'a11y'): Gap {
  return {
    id: `${severity}-${category}-${Math.random().toString(36).slice(2, 8)}`,
    path: '/x',
    severity,
    reason: `${severity} ${category} finding`,
    category,
  };
}

const costIntelligenceFixture = (): CostIntelligence => ({
  maxOutputTokensPerLlmCall: 2048,
  budgetRole: 'max-output-tokens-per-llm-call',
  records: [],
  budgetWarnings: ['warning A'],
  usageSummary: { totalInputTokens: 100, totalOutputTokens: 200, dataQuality: 'actual' },
  repeatedOperations: [],
  deterministicMaturity: { level: 2, label: 'L2', rationale: 'fixture' },
  conversionRecommendations: ['Convert flow X to deterministic check', 'Capture step Y in CI'],
});

test('toAgentSummary: high confidence, no major risks → pass', () => {
  const r = makeResult({ releaseConfidence: 92, gaps: [gap('low')] });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'pass');
  assert.equal(s.coverageStatus, 'ok');
  assert.equal(s.releaseConfidence, 92);
  assert.ok(s.honestyNotes.length >= 1, 'always at least one honesty note');
});

test('toAgentSummary: low coverage → warn with thin coverage note', () => {
  const r = makeResult({
    releaseConfidence: 60,
    coverageWarning: 'low-coverage',
    coveragePagesScanned: 1,
  });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'warn');
  assert.equal(s.coverageStatus, 'thin');
  assert.ok(s.honestyNotes.some((n) => /below the confidence threshold/i.test(n)));
  assert.ok(s.recommendedNextChecks.some((c) => /crawl budget|deeper entry/i.test(c)));
});

test('toAgentSummary: auth-required blocks meaningful scan → fail by default', () => {
  const r = makeResult({
    releaseConfidence: 0,
    mode: 'auth-required',
    coverageWarning: 'auth-required',
    coveragePagesScanned: 0,
  });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'fail');
  assert.equal(s.coverageStatus, 'blocked-by-auth');
  assert.ok(s.topRisks.some((r2) => /auth blocked/i.test(r2)));
  assert.ok(s.honestyNotes.some((n) => /authenticated surface/i.test(n)));
});

test('toAgentSummary: auth-required with authRequiredGate=warn yields warn', () => {
  const r = makeResult({
    releaseConfidence: 0,
    mode: 'auth-required',
    coverageWarning: 'auth-required',
  });
  const s = toAgentSummary(r, { authRequiredGate: 'warn' });
  assert.equal(s.gate, 'warn');
});

test('toAgentSummary: critical issue → fail regardless of confidence', () => {
  const r = makeResult({ releaseConfidence: 95, gaps: [gap('critical', 'a11y')] });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'fail');
  assert.equal(s.topRisks[0], '[critical] a11y — /x');
});

test('toAgentSummary: cost intelligence present → costSummary and deterministicFollowUps included', () => {
  const ci = costIntelligenceFixture();
  const r = makeResult({ releaseConfidence: 88, costIntelligence: ci });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'pass');
  assert.ok(s.costSummary, 'costSummary should be present');
  assert.equal(s.costSummary?.budgetWarningCount, 1);
  assert.equal(s.costSummary?.maturityLevel, 2);
  assert.deepEqual(s.deterministicFollowUps, ci.conversionRecommendations);
});

test('toAgentSummary: missing cost intelligence → costSummary null and empty follow-ups', () => {
  const s = toAgentSummary(makeResult({ releaseConfidence: 85 }));
  assert.equal(s.costSummary, null);
  assert.deepEqual(s.deterministicFollowUps, []);
});

test('toAgentSummary: high-severity gap with otherwise-pass conditions → warn', () => {
  const r = makeResult({ releaseConfidence: 90, gaps: [gap('high', 'console-error')] });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'warn');
});

test('toAgentSummary: status=blocked → fail', () => {
  const r = makeResult({ status: 'blocked', releaseConfidence: null });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'fail');
  assert.ok(s.honestyNotes.some((n) => /blocked before producing/i.test(n)));
});

test('toAgentSummary: status=partial → warn', () => {
  const r = makeResult({ status: 'partial', releaseConfidence: 85 });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'warn');
});

test('toAgentSummary: confidence below pass threshold (but above fail) → warn', () => {
  const r = makeResult({ releaseConfidence: 60 });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'warn');
});

test('toAgentSummary: confidence below fail threshold → fail', () => {
  const r = makeResult({ releaseConfidence: 10 });
  const s = toAgentSummary(r);
  assert.equal(s.gate, 'fail');
});

test('toAgentSummary: custom pass threshold respected', () => {
  const r = makeResult({ releaseConfidence: 75 });
  assert.equal(toAgentSummary(r).gate, 'warn');
  assert.equal(toAgentSummary(r, { passConfidenceThreshold: 70 }).gate, 'pass');
});

test('toAgentSummary: schemaVersion is 1 and shape contains all documented fields', () => {
  const s = toAgentSummary(makeResult());
  assert.equal(s.schemaVersion, 1);
  for (const k of [
    'gate',
    'releaseConfidence',
    'coverageStatus',
    'topRisks',
    'recommendedNextChecks',
    'honestyNotes',
    'costSummary',
    'deterministicFollowUps',
  ]) {
    assert.ok(k in s, `missing field: ${k}`);
  }
});

test('toAgentSummary: topRisks sorted critical → high → medium → low', () => {
  const r = makeResult({
    gaps: [gap('low'), gap('critical'), gap('medium'), gap('high')],
    releaseConfidence: 50,
  });
  const s = toAgentSummary(r);
  const severities = s.topRisks
    .filter((t) => t.startsWith('['))
    .map((t) => t.slice(1, t.indexOf(']')));
  assert.deepEqual(severities, ['critical', 'high', 'medium', 'low']);
});
