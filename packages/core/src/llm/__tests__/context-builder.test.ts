import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGapPrompt } from '../context-builder.js';
import type { Gap } from '../../schemas/gap-analysis.schema.js';

test('buildGapPrompt includes gap id in formatted line, not positional number', () => {
  const gaps = [
    {
      id: 'gap-uuid-001',
      severity: 'high',
      category: 'test-coverage',
      path: '/login',
      reason: 'no tests for login flow',
    },
  ] as Gap[];

  const prompt = buildGapPrompt(gaps, 10);

  assert.ok(prompt.includes('id:gap-uuid-001'), 'prompt must contain the gap UUID');
  assert.ok(!prompt.includes('1. [high]'), 'prompt must not use positional numbering');
});

test('buildGapPrompt sourceGapIds description references gap id format', () => {
  const gaps = [
    { id: 'gap-abc', severity: 'medium', category: 'ci-integration', path: '/', reason: 'no CI' },
  ] as Gap[];
  const prompt = buildGapPrompt(gaps, 10);
  assert.ok(prompt.includes('id:'), 'sourceGapIds hint should reference id: prefix');
});
