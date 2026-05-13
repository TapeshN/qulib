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

test('redactUrlForTelemetry returns the input unchanged when it is not a valid URL', () => {
  assert.equal(redactUrlForTelemetry('not a url'), 'not a url');
  assert.equal(redactUrlForTelemetry(''), '');
});

test('redactUrlForTelemetry handles bare hostnames with no query gracefully', () => {
  assert.equal(redactUrlForTelemetry('https://example.com'), 'https://example.com/');
  assert.equal(redactUrlForTelemetry('https://example.com/'), 'https://example.com/');
});
