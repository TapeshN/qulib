import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthBlockGap } from './auth-block-gap.js';

test('buildAuthBlockGap matches coverage auth-block contract', () => {
  const g = buildAuthBlockGap('https://platform.example.com/login');
  assert.equal(g.id, 'auth-block');
  assert.equal(g.category, 'coverage');
  assert.equal(g.severity, 'critical');
  assert.equal(g.description, 'Scan blocked by authentication. 0 authenticated pages were evaluated.');
  assert.match(g.recommendation, /qulib auth init/);
  assert.match(g.recommendation, /https:\/\/platform\.example\.com\/login/);
});
