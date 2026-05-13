import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliEntry = resolve(__dirname, 'index.ts');

test('qulib --version emits the package.json version', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', cliEntry, '--version'],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `CLI exited ${result.status}, stderr: ${result.stderr}`);
  const out = result.stdout.trim();
  assert.equal(out, pkg.version, `expected ${pkg.version}, got "${out}"`);
});
