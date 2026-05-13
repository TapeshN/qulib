import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthBlockGap, buildStorageStateInvalidGap } from './auth-block-gap.js';

test('buildAuthBlockGap matches coverage auth-block contract', () => {
  const g = buildAuthBlockGap('https://platform.example.com/login');
  assert.equal(g.id, 'auth-block');
  assert.equal(g.category, 'coverage');
  assert.equal(g.severity, 'critical');
  assert.equal(g.description, 'Scan blocked by authentication. 0 authenticated pages were evaluated.');
  assert.match(g.recommendation, /qulib auth init/);
  assert.match(g.recommendation, /https:\/\/platform\.example\.com\/login/);
});

test('buildStorageStateInvalidGap is critical/coverage and routes user to auth login per reason', () => {
  const cases = [
    { code: 'missing-file', recoveryPattern: /qulib auth login|qulib auth init/ },
    { code: 'unreadable-file', recoveryPattern: /permissions/i },
    { code: 'invalid-json', recoveryPattern: /qulib auth login/ },
    { code: 'wrong-origin', recoveryPattern: /different origin|qulib auth login/i },
    { code: 'expired-or-unauthorized', recoveryPattern: /expired|qulib auth login/i },
    { code: 'no-auth-cookies', recoveryPattern: /no cookies|empty|qulib auth login/i },
    { code: 'unknown', recoveryPattern: /qulib auth login/ },
  ] as const;
  for (const { code, recoveryPattern } of cases) {
    const g = buildStorageStateInvalidGap({
      url: 'https://app.example.com/dashboard',
      reasonCode: code,
      reason: 'test fixture reason',
    });
    assert.equal(g.id, 'storage-state-invalid');
    assert.equal(g.severity, 'critical');
    assert.equal(g.category, 'coverage');
    assert.match(g.reason, new RegExp(code));
    assert.ok(g.recommendation, `recommendation missing for ${code}`);
    assert.match(g.recommendation, recoveryPattern, `bad recovery text for ${code}`);
  }
});

test('buildStorageStateInvalidGap recommendation references the target URL host', () => {
  const g = buildStorageStateInvalidGap({
    url: 'https://app.example.com/area',
    reasonCode: 'wrong-origin',
    reason: 'session redirected to a different origin than the target app',
  });
  assert.match(g.description, /app\.example\.com/);
});
