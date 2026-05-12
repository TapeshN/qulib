import test from 'node:test';
import assert from 'node:assert/strict';
import { hashForCostIntelligence } from './content-hash.js';
import {
  buildBudgetWarnings,
  findRepeatedPromptPatterns,
  computeDeterministicMaturity,
} from './cost-intelligence.js';

test('hashForCostIntelligence is stable 32-char hex', () => {
  const a = hashForCostIntelligence('hello');
  const b = hashForCostIntelligence('hello');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{32}$/);
  assert.notEqual(hashForCostIntelligence('a'), hashForCostIntelligence('b'));
});

test('buildBudgetWarnings flags 80% of max-output budget', () => {
  const warnings = buildBudgetWarnings(
    [
      {
        provider: 'x',
        model: 'm',
        inputTokens: 10,
        outputTokens: 800,
        operationType: 'scenario-generation',
        timestamp: new Date().toISOString(),
        dataQuality: 'actual',
      },
    ],
    1000
  );
  assert.ok(warnings.some((w) => w.includes('80%')));
});

test('buildBudgetWarnings flags at or over budget', () => {
  const w = buildBudgetWarnings(
    [
      {
        provider: 'x',
        model: 'm',
        inputTokens: 1,
        outputTokens: 50,
        operationType: 'scenario-generation',
        timestamp: new Date().toISOString(),
        dataQuality: 'actual',
      },
    ],
    50
  );
  assert.ok(w.some((w) => w.includes('reached or exceeded')));
});

test('findRepeatedPromptPatterns requires count >= 2', () => {
  const ts = new Date().toISOString();
  const base = {
    provider: 'a',
    model: 'b',
    inputTokens: 1,
    outputTokens: 1,
    operationType: 'scenario-generation' as const,
    timestamp: ts,
    dataQuality: 'actual' as const,
  };
  assert.equal(findRepeatedPromptPatterns([{ ...base, promptHash: 'x' }]).length, 0);
  const repeated = findRepeatedPromptPatterns([
    { ...base, promptHash: 'abc' },
    { ...base, promptHash: 'abc' },
  ]);
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0]!.count, 2);
});

test('computeDeterministicMaturity L2 when LLM scenarios used', () => {
  const m = computeDeterministicMaturity({
    mode: 'url-only',
    coveragePagesScanned: 3,
    gapCount: 2,
    scenarioSource: 'llm',
    repeatedOperations: [],
    releaseConfidence: 60,
    requireHumanReview: false,
  });
  assert.equal(m.level, 2);
  assert.match(m.label, /L2/);
});

test('computeDeterministicMaturity L3 when repeated prompt patterns', () => {
  const m = computeDeterministicMaturity({
    mode: 'url-only',
    coveragePagesScanned: 2,
    gapCount: 1,
    scenarioSource: 'template',
    repeatedOperations: [
      {
        promptHash: 'ab',
        count: 2,
        recommendation: 'dedupe',
      },
    ],
    releaseConfidence: 70,
    requireHumanReview: false,
  });
  assert.equal(m.level, 3);
  assert.match(m.label, /L3/);
});

test('computeDeterministicMaturity L0 for auth-required', () => {
  const m = computeDeterministicMaturity({
    mode: 'auth-required',
    coveragePagesScanned: 0,
    gapCount: 0,
    scenarioSource: 'template',
    repeatedOperations: [],
    releaseConfidence: 0,
    requireHumanReview: true,
  });
  assert.equal(m.level, 0);
});
