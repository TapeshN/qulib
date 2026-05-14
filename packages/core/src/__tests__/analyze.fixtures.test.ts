/**
 * Offline smoke tests for `analyzeApp` against the local fixture server.
 *
 * These tests boot a Node.js fixture server on loopback, point `analyzeApp`
 * at it, and assert structural shape (not exact counts). They must run
 * unconditionally on every CI run — no env-gated skips.
 *
 * Server lifecycle: a single fixture server is started in `t.before` and
 * shared across the three sub-tests via `await t.test(...)`. This matches
 * the node:test API for sharing a resource across related tests. The
 * existing flat `test(...)` style in `analyze.integration.test.ts` is
 * preserved for tests that don't need shared state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer, type FixtureServerHandle } from './fixture-server.js';
import { analyzeApp } from '../analyze.js';
import { HarnessConfigSchema, type HarnessConfig } from '../schemas/config.schema.js';

function fixtureHarness(): HarnessConfig {
  return HarnessConfigSchema.parse({
    maxPagesToScan: 4,
    maxDepth: 2,
    minPagesForConfidence: 1,
    timeoutMs: 30000,
    retryCount: 0,
    llmTokenBudget: 1024,
    testGenerationLimit: 1,
    enableLlmScenarios: false,
    readOnlyMode: true,
    requireHumanReview: false,
    failOnConsoleError: false,
    explorer: 'playwright',
    defaultAdapter: 'playwright',
    adapters: ['playwright'],
  });
}

test('Fixture smoke tests', async (t) => {
  let handle: FixtureServerHandle | undefined;

  t.before(async () => {
    handle = await startFixtureServer();
  });

  t.after(async () => {
    if (handle) await handle.close();
  });

  await t.test('public fixture: status is complete or partial, coverageScore non-null', async () => {
    assert.ok(handle, 'fixture server must be started');
    const result = await analyzeApp({
      url: `${handle.baseUrl}/`,
      config: fixtureHarness(),
      writeArtifacts: false,
    });

    assert.ok(
      result.status === 'complete' || result.status === 'partial',
      `expected status complete|partial, got ${result.status}`
    );
    assert.ok(result.coverageScore !== null, 'coverageScore must not be null');
    assert.ok(result.coverageScore > 0, `coverageScore must be > 0, got ${result.coverageScore}`);
    assert.ok(result.publicSurface !== null, 'publicSurface must not be null');
    assert.ok(Array.isArray(result.gaps), 'gaps must be an array');
  });

  await t.test('auth-wall fixture: detectedAuth.detected is true', async () => {
    assert.ok(handle, 'fixture server must be started');
    const result = await analyzeApp({
      url: `${handle.baseUrl}/auth`,
      config: fixtureHarness(),
      writeArtifacts: false,
    });

    assert.ok(
      result.status === 'blocked' || result.status === 'partial',
      `expected status blocked|partial, got ${result.status}`
    );
    assert.equal(result.detectedAuth?.hasAuth, true, 'expected detectedAuth.hasAuth === true');
    assert.ok(
      Array.isArray(result.detectedAuth?.authOptions) && result.detectedAuth.authOptions.length > 0,
      'expected at least one detected authOption'
    );
  });

  await t.test('broken fixture: at least one gap surfaced', async () => {
    assert.ok(handle, 'fixture server must be started');
    const result = await analyzeApp({
      url: `${handle.baseUrl}/broken`,
      config: fixtureHarness(),
      writeArtifacts: false,
    });

    assert.ok(result.gaps.length > 0, 'expected at least one gap from the broken fixture');
  });
});
