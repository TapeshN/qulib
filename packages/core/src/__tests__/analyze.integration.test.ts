/**
 * Live-network validation for analyzeApp response shapes (node:test).
 *
 * - In CI, set RUN_NETWORK_INTEGRATION=1 to run; otherwise these tests skip so default pipelines stay offline.
 * - notquality.com typically yields status "partial" (one pre-auth page crawled), not "blocked"
 *   (zero routes). Case 2 covers both blocked and partial OAuth-wall outcomes.
 * - For a strict status "blocked" check only, set QULIB_STRICT_BLOCKED_SCAN_URL to a URL that produces zero public routes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeApp } from '../analyze.js';
import { HarnessConfigSchema, type HarnessConfig } from '../schemas/config.schema.js';

function integrationHarness(): HarnessConfig {
  return HarnessConfigSchema.parse({
    maxPagesToScan: 6,
    maxDepth: 2,
    minPagesForConfidence: 3,
    timeoutMs: 45000,
    retryCount: 0,
    llmTokenBudget: 4096,
    testGenerationLimit: 4,
    enableLlmScenarios: false,
    readOnlyMode: true,
    requireHumanReview: false,
    failOnConsoleError: false,
    explorer: 'playwright',
    defaultAdapter: 'playwright',
    adapters: ['playwright'],
  });
}

async function isUrlReachable(url: string, timeoutMs = 15000): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'User-Agent': 'qulib-analyze-integration/1.0' },
    });
    return res.status >= 200 && res.status < 600;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function allowNetworkIntegration(): boolean {
  if (process.env.CI === 'true' && process.env.RUN_NETWORK_INTEGRATION !== 'true') {
    return false;
  }
  return true;
}

test('Case 1 — complete scan (public site, no auth wall)', async (t) => {
  if (!allowNetworkIntegration()) {
    t.skip('CI without RUN_NETWORK_INTEGRATION=1: skipping live URL integration');
    return;
  }
  const url = 'https://example.com';
  if (!(await isUrlReachable(url))) {
    t.skip(`${url} unreachable from this environment`);
    return;
  }

  const result = await analyzeApp({ url, config: integrationHarness(), writeArtifacts: false });
  console.log('[Case 1] full analyzeApp result:\n', JSON.stringify(result, null, 2));

  assert.equal(result.status, 'complete');
  assert.ok(result.releaseConfidence !== null && result.releaseConfidence !== undefined);
  assert.ok(result.releaseConfidence >= 0 && result.releaseConfidence <= 100);
  assert.ok(result.coverageScore !== null);
  assert.ok(result.coverageScore >= 0 && result.coverageScore <= 100);
  assert.ok(result.publicSurface !== null);
  assert.ok(result.publicSurface.pages.length >= 1);
  assert.ok(Array.isArray(result.gaps));
  assert.ok(!result.gaps.some((g) => g.id === 'auth-block'));
});

test('Case 2 — OAuth-gated without storage (notquality.com)', async (t) => {
  if (!allowNetworkIntegration()) {
    t.skip('CI without RUN_NETWORK_INTEGRATION=1: skipping live URL integration');
    return;
  }
  const url = 'https://notquality.com';
  if (!(await isUrlReachable(url))) {
    t.skip(`${url} unreachable from this environment`);
    return;
  }

  const result = await analyzeApp({ url, config: integrationHarness(), writeArtifacts: false });
  console.log('[Case 2] full analyzeApp result:\n', JSON.stringify(result, null, 2));

  assert.ok(result.detectedAuth?.hasAuth, 'expected auth detection on OAuth-gated property');
  assert.ok(result.publicSurface !== null && result.publicSurface.pages.length >= 1);
  assert.ok(Array.isArray(result.gaps));
  assert.ok(result.gaps.some((g) => g.id === 'auth-block'), 'expected auth-block gap in flat gaps');
  assert.ok(result.gaps.some((g) => g.category === 'auth-surface'), 'expected auth-surface gap(s)');
  assert.equal(result.routeInventory.routes.length, 0, 'authenticated route inventory stays empty without credentials');

  if (result.status === 'blocked') {
    assert.equal(result.releaseConfidence, null);
    assert.equal(result.coverageScore, 0);
  } else if (result.status === 'partial') {
    assert.ok(typeof result.releaseConfidence === 'number');
    assert.ok(result.releaseConfidence >= 0 && result.releaseConfidence <= 100);
    assert.ok(result.coverageScore !== null);
    assert.ok(result.coverageScore >= 0 && result.coverageScore <= 100);
  } else {
    assert.fail(`unexpected status ${result.status} for OAuth wall without storage`);
  }
});

test('Case 2b — strictly blocked (0 public routes), optional QULIB_STRICT_BLOCKED_SCAN_URL', async (t) => {
  const url = process.env.QULIB_STRICT_BLOCKED_SCAN_URL;
  if (!url) {
    t.skip('Set QULIB_STRICT_BLOCKED_SCAN_URL to assert status=blocked (0-route) OAuth wall behavior');
    return;
  }
  if (!allowNetworkIntegration()) {
    t.skip('CI without RUN_NETWORK_INTEGRATION=1: skipping live URL integration');
    return;
  }
  if (!(await isUrlReachable(url))) {
    t.skip(`${url} unreachable from this environment`);
    return;
  }

  const result = await analyzeApp({ url, config: integrationHarness(), writeArtifacts: false });
  console.log('[Case 2b] full analyzeApp result:\n', JSON.stringify(result, null, 2));

  assert.equal(result.status, 'blocked');
  assert.equal(result.releaseConfidence, null);
  assert.equal(result.coverageScore, 0);
  assert.ok(result.gaps.some((g) => g.id === 'auth-block'));
  assert.ok(result.gaps.some((g) => g.category === 'auth-surface'));
});

test.skip('Case 3 — partial scan — requires storage state', async () => undefined);
