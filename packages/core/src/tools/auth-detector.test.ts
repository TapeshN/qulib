import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { evaluateStorageStateValidity, waitForReturnToOrigin } from './auth-detector.js';

test('evaluateStorageStateValidity fails when final URL origin differs from expected', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'https://evil.com/callback',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /external IdP/);
});

test('evaluateStorageStateValidity fails on visible password after session load', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'https://app.example/login',
    visiblePasswordCount: 1,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /login form still visible/i);
});

test('evaluateStorageStateValidity fails on HTTP 401/403 signal', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'https://app.example/dashboard',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: true,
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /401|403/);
});

test('evaluateStorageStateValidity passes when signals are clean', () => {
  const r = evaluateStorageStateValidity({
    expectedOrigin: 'https://app.example',
    finalUrl: 'https://app.example/app',
    visiblePasswordCount: 0,
    hadUnauthorizedHttp: false,
  });
  assert.equal(r.valid, true);
});

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
