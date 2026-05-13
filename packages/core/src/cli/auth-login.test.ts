import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuthPath } from '../schemas/config.schema.js';
import {
  assertExactlyOneCredentialSource,
  assertCredentialsCoverFields,
  parseCredentialsJsonString,
  resolveAuthLoginConfig,
  resolveFormLoginPath,
} from './auth-login-resolve.js';

function sampleFormPath(id: string): AuthPath {
  return {
    id,
    label: id,
    type: 'form-login',
    provider: id,
    source: 'heuristic',
    automatable: true,
    confidence: 'medium',
    requirements: {
      method: 'credentials',
      fields: [
        { name: 'username', label: 'Username', type: 'text', observedOptions: [] },
        { name: 'password', label: 'Password', type: 'password', observedOptions: [] },
      ],
    },
  };
}

test('assertExactlyOneCredentialSource rejects both --credentials and --credentials-file', () => {
  assert.throws(
    () => assertExactlyOneCredentialSource('{}', '/tmp/x.json'),
    /not both/
  );
});

test('assertExactlyOneCredentialSource rejects when neither credential source is set', () => {
  assert.throws(() => assertExactlyOneCredentialSource(undefined, undefined), /One of/);
});

test('resolveFormLoginPath errors when multiple form-login paths without --auth-path', () => {
  const a = sampleFormPath('nq-login');
  const b = sampleFormPath('other-form');
  assert.throws(() => resolveFormLoginPath('https://x.com', [a, b], undefined), /Multiple form-login options found:/);
});

test('assertCredentialsCoverFields lists missing credential field names', () => {
  const path = sampleFormPath('sync');
  assert.throws(
    () => assertCredentialsCoverFields({ username: 'u' }, path),
    /Missing credential value.*password/
  );
});

test('parseCredentialsJsonString rejects invalid JSON', () => {
  assert.throws(() => parseCredentialsJsonString('{'), /Invalid JSON/);
});

test('resolveAuthLoginConfig picks the only form-login path when credentials are complete', () => {
  const path = sampleFormPath('only');
  const { path: chosen } = resolveAuthLoginConfig({
    baseUrl: 'https://x.com',
    authOptions: [path],
    credentials: { username: 'u', password: 'p' },
  });
  assert.equal(chosen.id, 'only');
});
