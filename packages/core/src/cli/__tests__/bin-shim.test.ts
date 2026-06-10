import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../../package.json') as { version: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgRoot = resolve(__dirname, '../../..');
const monorepoRoot = resolve(pkgRoot, '../..');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

test('packed tarball CLI runs via plain node, without src/ or tsx', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'qulib-bin-shim-'));
  try {
    const pack = spawnSync(npmCmd, ['pack', '--pack-destination', tmp], {
      cwd: pkgRoot,
      encoding: 'utf8',
    });
    assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr}`);
    const tarball = pack.stdout.trim().split('\n').pop();
    assert.ok(tarball, 'npm pack did not report a tarball filename');

    const untar = spawnSync('tar', ['-xzf', join(tmp, tarball), '-C', tmp], {
      encoding: 'utf8',
    });
    assert.equal(untar.status, 0, `tar extract failed: ${untar.stderr}`);

    const installed = join(tmp, 'package');
    assert.ok(
      !existsSync(join(installed, 'src')),
      'published tarball must not contain src/'
    );
    assert.ok(
      existsSync(join(installed, 'dist', 'cli', 'index.js')),
      'published tarball must contain dist/cli/index.js'
    );

    // stand in for the node_modules an `npm install` would provide
    symlinkSync(
      join(monorepoRoot, 'node_modules'),
      join(installed, 'node_modules'),
      'dir'
    );

    const run = spawnSync(
      process.execPath,
      [join(installed, 'bin', 'qulib.js'), '--version'],
      { encoding: 'utf8' }
    );
    assert.equal(run.status, 0, `CLI exited ${run.status}, stderr: ${run.stderr}`);
    assert.equal(run.stdout.trim(), pkg.version);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
