import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactUrlForTelemetry } from './emit.js';

test('redactUrlForTelemetry strips query strings (secret tokens cannot leak)', () => {
  assert.equal(
    redactUrlForTelemetry('https://app.example.com/share?token=SUPER_SECRET'),
    'https://app.example.com/share'
  );
  assert.equal(
    redactUrlForTelemetry('https://app.example.com/path?key=abc&other=def'),
    'https://app.example.com/path'
  );
});

test('redactUrlForTelemetry strips hash fragments', () => {
  assert.equal(
    redactUrlForTelemetry('https://app.example.com/page#access_token=SUPER_SECRET'),
    'https://app.example.com/page'
  );
});

test('redactUrlForTelemetry preserves origin + pathname intact', () => {
  assert.equal(
    redactUrlForTelemetry('https://app.example.com:8443/v1/foo/bar'),
    'https://app.example.com:8443/v1/foo/bar'
  );
});

test('redactUrlForTelemetry returns [redacted-non-url] for non-URL inputs (no secret echo)', () => {
  // Non-URL inputs may themselves be secret-shaped — e.g. a raw token, a path
  // with embedded credentials, or anything a caller mistakenly passed. The
  // exported helper makes no assumption about provenance and must never echo
  // the original string back into telemetry.
  assert.equal(redactUrlForTelemetry('not a url'), '[redacted-non-url]');
  assert.equal(redactUrlForTelemetry(''), '[redacted-non-url]');
  assert.equal(redactUrlForTelemetry('sk-ant-SUPER_SECRET_TOKEN'), '[redacted-non-url]');
});

test('redactUrlForTelemetry rejects non-http(s) URL-like strings that the WHATWG parser accepts', () => {
  // `new URL(...)` accepts many shapes that are not real http URLs. They must
  // not leak back into telemetry just because they parsed successfully.
  assert.equal(redactUrlForTelemetry('user:pass@host'), '[redacted-non-url]');
  assert.equal(redactUrlForTelemetry('mailto:alice@example.com'), '[redacted-non-url]');
  assert.equal(redactUrlForTelemetry('data:text/plain;base64,U0VDUkVU'), '[redacted-non-url]');
  assert.equal(redactUrlForTelemetry('javascript:alert(1)'), '[redacted-non-url]');
  assert.equal(redactUrlForTelemetry('file:///etc/passwd'), '[redacted-non-url]');
});

test('redactUrlForTelemetry strips user:pass@ userinfo from http(s) URLs', () => {
  // Even when the input parses as a real http(s) URL, any embedded credentials
  // must be stripped before emit.
  assert.equal(
    redactUrlForTelemetry('https://alice:s3cret@app.example.com/dashboard'),
    'https://app.example.com/dashboard'
  );
  assert.equal(
    redactUrlForTelemetry('http://token@app.example.com/'),
    'http://app.example.com/'
  );
});

test('redactUrlForTelemetry handles bare hostnames with no query gracefully', () => {
  assert.equal(redactUrlForTelemetry('https://example.com'), 'https://example.com/');
  assert.equal(redactUrlForTelemetry('https://example.com/'), 'https://example.com/');
});
