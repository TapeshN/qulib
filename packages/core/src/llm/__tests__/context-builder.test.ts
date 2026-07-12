import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGapPrompt } from '../context-builder.js';
import { TestStepSchema, type Gap } from '../../schemas/gap-analysis.schema.js';

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

// FINDING 3: vocabulary parity — the LLM prompt's documented action union
// must include every TestStep action, including the round-3 additions
// (key-press, select), and can never silently drift from the schema again
// because it is derived from the schema's own enum values, not hand-copied.
test('buildGapPrompt action vocabulary includes key-press and select', () => {
  const gaps = [{ id: 'gap-1', severity: 'low', category: 'coverage', path: '/', reason: 'x' }] as Gap[];
  const prompt = buildGapPrompt(gaps, 10);

  assert.ok(prompt.includes('key-press'), 'prompt action union must advertise key-press');
  assert.ok(prompt.includes('select'), 'prompt action union must advertise select');
});

test('buildGapPrompt action vocabulary matches TestStepSchema action union exactly (single source of truth)', () => {
  const gaps = [{ id: 'gap-1', severity: 'low', category: 'coverage', path: '/', reason: 'x' }] as Gap[];
  const prompt = buildGapPrompt(gaps, 10);

  const schemaActions = TestStepSchema.shape.action.options;
  assert.ok(schemaActions.length > 0, 'sanity: schema action union is non-empty');
  for (const action of schemaActions) {
    assert.ok(
      prompt.includes(action),
      `prompt action union is missing schema action "${action}" — vocabulary has drifted from TestStepSchema`
    );
  }
  // And the reverse: the rendered "a|b|c" list is EXACTLY the schema's
  // options joined, not a superset/hand-edited variant that happens to
  // contain every name as a substring of something else.
  const actionField = prompt.match(/"action":\s*"([^"]+)"/);
  assert.ok(actionField, 'prompt must contain a quoted action field listing the union');
  assert.equal(actionField?.[1], schemaActions.join('|'));
});
