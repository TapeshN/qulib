import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  evaluateStorageStateValidity,
  pickCredentialFieldName,
  preflightStorageStateFile,
  waitForReturnToOrigin,
} from '../detect.js';
import { resolveFormLoginPath } from '../../../cli/auth-login-resolve.js';
import { authPathNeedsClickReveal } from '../../../cli/auth-login-run.js';
import type { AuthPath } from '../../../schemas/config.schema.js';

test('evaluateStorageStateValidity flags wrong-origin when final URL origin differs from expected', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'https://evil.com/callback',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reasonCode, 'wrong-origin');
  assert.match(r.reason, /different origin/);
});

test('evaluateStorageStateValidity strict origin: www subdomain is treated as wrong-origin', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'https://www.app.example/home',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reasonCode, 'wrong-origin');
});

test('evaluateStorageStateValidity strict origin: http vs https is treated as wrong-origin', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'http://app.example/home',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reasonCode, 'wrong-origin');
});

test('evaluateStorageStateValidity strict origin: differing port is treated as wrong-origin', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'http://localhost:3000',
    finalUrl: 'http://localhost:4000/home',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reasonCode, 'wrong-origin');
});

test('evaluateStorageStateValidity flags expired-or-unauthorized on visible password after load', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'https://app.example/login',
    visiblePasswordCount: 1,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reasonCode, 'expired-or-unauthorized');
  assert.match(r.reason, /login form still visible/i);
});

test('evaluateStorageStateValidity flags expired-or-unauthorized on HTTP 401/403 signal', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'https://app.example/dashboard',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: true,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reasonCode, 'expired-or-unauthorized');
  assert.match(r.reason, /401|403|expired/i);
});

test('evaluateStorageStateValidity passes when signals are clean', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'https://app.example/app',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, true);
  assert.equal(r.reasonCode, 'ok');
});

test('evaluateStorageStateValidity flags wrong-origin when final URL is unparseable', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'not a url',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reasonCode, 'wrong-origin');
});

test('preflightStorageStateFile returns missing-file when path does not exist', async () => {
  const result = await preflightStorageStateFile(
    join(tmpdir(), `qulib-no-such-file-${Date.now()}-${Math.random()}.json`)
  );
  assert.ok(result);
  assert.equal(result.valid, false);
  assert.equal(result.reasonCode, 'missing-file');
});

test('preflightStorageStateFile returns invalid-json when contents are not JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qulib-state-'));
  const filePath = join(dir, 'storage.json');
  try {
    await writeFile(filePath, 'this is not json {', 'utf8');
    const result = await preflightStorageStateFile(filePath);
    assert.ok(result);
    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, 'invalid-json');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preflightStorageStateFile returns no-auth-cookies for empty storage state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qulib-state-'));
  const filePath = join(dir, 'storage.json');
  try {
    await writeFile(filePath, JSON.stringify({ cookies: [], origins: [] }), 'utf8');
    const result = await preflightStorageStateFile(filePath);
    assert.ok(result);
    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, 'no-auth-cookies');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preflightStorageStateFile returns no-auth-cookies when origins exist but localStorage is empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qulib-state-'));
  const filePath = join(dir, 'storage.json');
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        cookies: [],
        origins: [{ origin: 'https://app.example', localStorage: [] }],
      }),
      'utf8'
    );
    const result = await preflightStorageStateFile(filePath);
    assert.ok(result);
    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, 'no-auth-cookies');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preflightStorageStateFile passes when cookies are present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qulib-state-'));
  const filePath = join(dir, 'storage.json');
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        cookies: [{ name: 'session', value: 'x', domain: 'app.example', path: '/' }],
        origins: [],
      }),
      'utf8'
    );
    const result = await preflightStorageStateFile(filePath);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preflightStorageStateFile passes when only localStorage is present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qulib-state-'));
  const filePath = join(dir, 'storage.json');
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        cookies: [],
        origins: [
          {
            origin: 'https://app.example',
            localStorage: [{ name: 'token', value: 'x' }],
          },
        ],
      }),
      'utf8'
    );
    const result = await preflightStorageStateFile(filePath);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const canSimulateUnreadable = process.platform !== 'win32' && process.getuid?.() !== 0;
test(
  'preflightStorageStateFile returns unreadable-file when file is not readable',
  { skip: !canSimulateUnreadable && 'requires non-root POSIX environment' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qulib-state-'));
    const filePath = join(dir, 'storage.json');
    try {
      await writeFile(filePath, JSON.stringify({ cookies: [], origins: [] }), 'utf8');
      await chmod(filePath, 0o000);
      const result = await preflightStorageStateFile(filePath);
      assert.ok(result);
      assert.equal(result.valid, false);
      assert.equal(result.reasonCode, 'unreadable-file');
    } finally {
      try {
        await chmod(filePath, 0o600);
      } catch {
        /* best-effort */
      }
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test('waitForReturnToOrigin returns true once URL origin matches baseUrl', async () => {
  let href = 'https://idp.example/auth';
  const page = {
    url: () => href,
  } as unknown as Page;
  const done = waitForReturnToOrigin(page, 'https://app.example/home', 4000);
  setTimeout(() => {
    href = 'https://app.example/home';
  }, 700);
  const r = await done;
  assert.equal(r.returned, true);
  assert.ok(r.finalUrl.includes('app.example'));
});

test('waitForReturnToOrigin times out when origin never matches', async () => {
  const page = {
    url: () => 'https://idp.example/stuck',
  } as unknown as Page;
  const r = await waitForReturnToOrigin(page, 'https://app.example/', 900);
  assert.equal(r.returned, false);
  assert.ok(r.finalUrl.includes('idp.example'));
});

test('waitForReturnToOrigin treats subdomain as foreign (strict origin)', async () => {
  const page = {
    url: () => 'https://www.app.example/home',
  } as unknown as Page;
  const r = await waitForReturnToOrigin(page, 'https://app.example/', 600);
  assert.equal(r.returned, false);
});

// --- resolveFormLoginPath + authPathNeedsClickReveal tests ---

test('resolveFormLoginPath selects form-multi path when type is form-multi', () => {
  const option: AuthPath = {
    id: 'nq-login',
    label: 'NQ Login',
    type: 'form-multi',
    provider: null,
    source: 'user-local',
    automatable: true,
    confidence: 'medium',
    requirements: {
      method: 'credentials',
      fields: [
        { name: 'username', label: 'Username', type: 'text', observedOptions: [] },
        { name: 'password', label: 'Password', type: 'password', observedOptions: [] },
        { name: 'datasource', label: 'District', type: 'select', observedOptions: ['NYC', 'LA'] },
      ],
    },
  };
  const result = resolveFormLoginPath('https://example.com', [option]);
  assert.equal(result, option);
});

test('resolveFormLoginPath rejects form-multi when requirements.method is storage-state', () => {
  const option: AuthPath = {
    id: 'sso-form',
    label: 'SSO Form',
    type: 'form-multi',
    provider: null,
    source: 'heuristic',
    automatable: false,
    confidence: 'low',
    requirements: {
      method: 'storage-state',
      instruction: 'Use qulib auth init',
    },
  };
  assert.throws(
    () => resolveFormLoginPath('https://example.com', [option]),
    /No automatable form-login path/
  );
});

test('authPathNeedsClickReveal returns true for user-local form-login', () => {
  const path: AuthPath = {
    id: 'nq-login',
    label: 'NQ Login',
    type: 'form-login',
    provider: null,
    source: 'user-local',
    automatable: true,
    confidence: 'medium',
    requirements: { method: 'credentials', fields: [] },
  };
  assert.equal(authPathNeedsClickReveal(path), true);
});

test('authPathNeedsClickReveal returns true for user-local form-multi', () => {
  const path: AuthPath = {
    id: 'nq-login',
    label: 'NQ Login',
    type: 'form-multi',
    provider: null,
    source: 'user-local',
    automatable: true,
    confidence: 'medium',
    requirements: { method: 'credentials', fields: [] },
  };
  assert.equal(authPathNeedsClickReveal(path), true);
});

test('authPathNeedsClickReveal returns false for built-in oauth id', () => {
  const path: AuthPath = {
    id: 'google',
    label: 'Sign in with Google',
    type: 'form-login',
    provider: 'google',
    source: 'heuristic',
    automatable: false,
    confidence: 'high',
    requirements: { method: 'credentials', fields: [] },
  };
  assert.equal(authPathNeedsClickReveal(path), false);
});

// --- pickCredentialFieldName tests ---

test('pickCredentialFieldName returns name attribute when present', () => {
  assert.equal(pickCredentialFieldName({ name: 'email', type: 'text' }), 'email');
});

test('pickCredentialFieldName falls back to slugified id when name is missing', () => {
  assert.equal(pickCredentialFieldName({ id: 'user-email-input', type: 'text' }), 'user-email-input');
});

test('pickCredentialFieldName uses autocomplete=email when no name or id', () => {
  assert.equal(pickCredentialFieldName({ autocomplete: 'email', type: 'text' }), 'email');
});

test('pickCredentialFieldName uses autocomplete=username when no name or id', () => {
  assert.equal(pickCredentialFieldName({ autocomplete: 'username', type: 'text' }), 'username');
});

test('pickCredentialFieldName maps autocomplete=current-password to "password"', () => {
  assert.equal(pickCredentialFieldName({ autocomplete: 'current-password' }), 'password');
});

test('pickCredentialFieldName falls back to type=email semantic default', () => {
  assert.equal(pickCredentialFieldName({ type: 'email' }), 'email');
});

test('pickCredentialFieldName falls back to type=password semantic default', () => {
  assert.equal(pickCredentialFieldName({ type: 'password' }), 'password');
});

test('pickCredentialFieldName skips placeholder that looks like an example email', () => {
  // Regression: placeholder "you@notquality.com" must not become "younotqualitycom"
  assert.equal(pickCredentialFieldName({ type: 'email', placeholder: 'you@notquality.com' }), 'email');
});

test('pickCredentialFieldName skips placeholder that looks like a URL example', () => {
  assert.equal(pickCredentialFieldName({ placeholder: 'https://your-site.com' }), 'field');
});

test('pickCredentialFieldName uses placeholder when it looks like a field-name hint', () => {
  // "District" has no @ or :// — safe to slugify
  assert.equal(pickCredentialFieldName({ placeholder: 'District' }), 'district');
});

test('pickCredentialFieldName uses aria-label as last resort before "field"', () => {
  assert.equal(pickCredentialFieldName({ ariaLabel: 'Choose your school' }), 'choose-your-school');
});

test('pickCredentialFieldName returns "field" when no usable signal exists', () => {
  assert.equal(pickCredentialFieldName({}), 'field');
});

test('pickCredentialFieldName prefers name attribute over all other signals', () => {
  assert.equal(
    pickCredentialFieldName({
      name: 'real_name',
      id: 'i-am-ignored',
      autocomplete: 'email',
      type: 'password',
      placeholder: 'ignored',
    }),
    'real_name'
  );
});
