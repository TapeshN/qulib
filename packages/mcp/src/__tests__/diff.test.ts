import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleQulibDiff } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', 'core', 'fixtures', 'baselines');
const CLEAN_FIXTURE = resolve(FIXTURE_ROOT, 'clean-run.json');
const DOCTORED_FIXTURE = resolve(FIXTURE_ROOT, 'doctored-run.json');

function parseResponse(response: Awaited<ReturnType<typeof handleQulibDiff>>): Record<string, unknown> {
  return JSON.parse(response.content[0].text) as Record<string, unknown>;
}

test('qulib_diff: identical reports produce zero-drift result', async () => {
  const response = await handleQulibDiff({ from: CLEAN_FIXTURE, to: CLEAN_FIXTURE });
  const result = parseResponse(response);

  assert.equal(result['direction'], 'unchanged');
  assert.deepEqual(result['added'], []);
  assert.deepEqual(result['removed'], []);
  assert.deepEqual(result['changed'], []);
});

test('qulib_diff: clean vs doctored reports detect drift', async () => {
  const response = await handleQulibDiff({ from: CLEAN_FIXTURE, to: DOCTORED_FIXTURE });
  const result = parseResponse(response);

  assert.equal(result['direction'], 'regressed');
  assert.ok(Array.isArray(result['added']) && (result['added'] as unknown[]).length > 0);
  assert.ok(Array.isArray(result['removed']) && (result['removed'] as unknown[]).length > 0);
  assert.ok(Array.isArray(result['changed']) && (result['changed'] as unknown[]).length > 0);
});

test('qulib_diff: non-existent path returns structured error', async () => {
  const response = await handleQulibDiff({
    from: '/does/not/exist/baseline.json',
    to: CLEAN_FIXTURE,
  });
  const parsed = parseResponse(response);

  assert.ok('error' in parsed, 'response must include error key');
  const error = parsed['error'] as Record<string, unknown>;
  assert.equal(error['code'], 'QULIB_DIFF_FAILED');
});

test('qulib_diff: relative paths return invalid-input error', async () => {
  const response = await handleQulibDiff({
    from: 'fixtures/baselines/clean-run.json',
    to: CLEAN_FIXTURE,
  });
  const parsed = parseResponse(response);

  assert.ok('error' in parsed, 'response must include error key');
  const error = parsed['error'] as Record<string, unknown>;
  assert.equal(error['code'], 'QULIB_DIFF_INVALID_INPUT');
  assert.equal(error['message'], 'from and to must be absolute paths');
});
