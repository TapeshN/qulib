/**
 * Tests that the CLI falls back to DEFAULT_HARNESS_CONFIG when:
 *   1. --config is not passed AND qulib.config.ts is absent from cwd.
 *
 * And that an EXPLICIT --config pointing at a missing file is still a hard error.
 *
 * Uses spawn-based patterns established by cli-version.test.ts: run the TypeScript
 * source directly via `--import tsx/esm` (same mechanism as the npm test script),
 * so no build step is required and the test is environment-independent in CI.
 *
 * We do NOT fully exercise analyze (that would require a real URL + Playwright).
 * Instead we pass an invalid URL so the command fails at URL-validation — which
 * happens AFTER config loading. A config-load crash produces a different, earlier
 * error. We assert on exit code + that the "built-in default config" notice appears
 * and NOT an ERR_MODULE_NOT_FOUND / config-loading crash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgRoot = resolve(__dirname, '../../..');
const monorepoRoot = resolve(pkgRoot, '../..');
// Resolve the TypeScript source entry — same approach as cli-version.test.ts.
const cliEntry = resolve(__dirname, '..', 'index.ts');

/**
 * Run the CLI source via tsx/esm from a fresh temp directory that has no
 * qulib.config.ts. Mirrors cli-version.test.ts: run via `--import tsx/esm`
 * against the TypeScript source so no build step is required in CI.
 *
 * node_modules is symlinked from the monorepo root (where tsx is hoisted by
 * the workspace install) so the loader can resolve tsx from the temp cwd.
 * This mirrors the symlink pattern used by bin-shim.test.ts.
 */
function runCliInEmptyDir(args: string[]): ReturnType<typeof spawnSync> {
  const tmp = mkdtempSync(join(tmpdir(), 'qulib-no-config-'));
  try {
    // Symlink monorepo node_modules so tsx (hoisted there) is findable from tmp.
    symlinkSync(join(monorepoRoot, 'node_modules'), join(tmp, 'node_modules'), 'dir');

    return spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', cliEntry, ...args],
      {
        cwd: tmp,
        encoding: 'utf8',
        // Long enough to start the process and emit the config notice (immediate),
        // short enough to not block the test suite waiting for a real network crawl.
        timeout: 20000,
      }
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('analyze without --config and no config file uses built-in defaults (no config-load crash)', () => {
  // Use a valid URL so the process gets past URL validation and into config loading.
  // We use --ephemeral + a short spawnSync timeout to let the process start and log
  // the built-in default config notice before the network call times out / kills the
  // subprocess. The process will exit non-zero due to the timeout — that is fine;
  // the assertion is about what happened during startup, not whether the crawl succeeded.
  const result = runCliInEmptyDir(['analyze', '--url', 'https://example.com', '--ephemeral']);

  // The built-in default config notice must appear on stderr (emitted before network call).
  assert.ok(
    result.stderr.includes('built-in default config'),
    `Expected "built-in default config" notice in stderr, got:\n${result.stderr}`
  );

  // Must NOT contain config-file-not-found / ERR_MODULE_NOT_FOUND language.
  assert.ok(
    !result.stderr.includes('ERR_MODULE_NOT_FOUND'),
    `Should not see ERR_MODULE_NOT_FOUND in stderr, got:\n${result.stderr}`
  );
  assert.ok(
    !result.stderr.includes('Cannot find module'),
    `Should not see "Cannot find module" in stderr, got:\n${result.stderr}`
  );
  assert.ok(
    !result.stderr.includes('Cannot find package'),
    `Should not see "Cannot find package" in stderr, got:\n${result.stderr}`
  );
});

test('analyze with explicit --config pointing at a missing file is a hard error', () => {
  const result = runCliInEmptyDir([
    'analyze',
    '--url',
    'https://example.com',
    '--config',
    'does-not-exist.config.ts',
    '--ephemeral',
  ]);

  // Should exit non-zero because the explicit config file is missing.
  assert.notEqual(result.status, 0, 'Expected non-zero exit for missing explicit --config');

  // Should NOT see the built-in default fallback notice.
  assert.ok(
    !result.stderr.includes('built-in default config'),
    `Should NOT fall back to built-in defaults for an explicit missing config, got:\n${result.stderr}`
  );
});
