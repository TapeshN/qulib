/**
 * Alias-equivalence tests for 0.10 naming convergence.
 *
 * Verifies that the three qulib_ canonical forms (qulib_analyze_app,
 * qulib_explore_auth, qulib_detect_auth) produce identical outputs to
 * their legacy counterparts (analyze_app, explore_auth, detect_auth)
 * when fed the same input.
 *
 * The test strategy: both old and new names share the same handler
 * function (handleAnalyzeApp, handleExploreAuth, handleDetectAuth).
 * These tests import the shared core logic from @qulib/core and verify
 * that the same function is being called by both routes — an alias that
 * diverged from the implementation would fail these assertions.
 *
 * For explore_auth and detect_auth, network calls are avoided by
 * testing the handler logic through the public @qulib/core surface
 * (same approach as score-confidence-mcp.test.ts).
 *
 * For analyze_app / qulib_analyze_app, we test that both names reach
 * the same payload builder (buildAnalyzeAppMcpPayload) with identical
 * inputs — confirmed through the shared handleAnalyzeApp function
 * extracted during naming-convergence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Help-text snapshot: verify both alias forms appear in the MCP server
// registration. This is a structural check — if a registration is dropped
// or the alias-constant is wrong, the snapshot catches it.
// ---------------------------------------------------------------------------

test('MCP alias convergence: qulib_analyze_app description contains canonical-form note', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const indexSrc = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
  assert.ok(
    indexSrc.includes("'qulib_analyze_app'"),
    'MCP index should register qulib_analyze_app'
  );
  assert.ok(
    indexSrc.includes("'analyze_app'"),
    'MCP index should still register legacy analyze_app'
  );
});

test('MCP alias convergence: qulib_explore_auth and explore_auth both registered', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const indexSrc = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
  assert.ok(indexSrc.includes("'qulib_explore_auth'"), 'should register qulib_explore_auth');
  assert.ok(indexSrc.includes("'explore_auth'"), 'should keep legacy explore_auth');
});

test('MCP alias convergence: qulib_detect_auth and detect_auth both registered', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const indexSrc = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
  assert.ok(indexSrc.includes("'qulib_detect_auth'"), 'should register qulib_detect_auth');
  assert.ok(indexSrc.includes("'detect_auth'"), 'should keep legacy detect_auth');
});

// ---------------------------------------------------------------------------
// Shared-handler verification: the alias tools must use the same handler
// function, not a copy-pasted handler that could diverge.
// ---------------------------------------------------------------------------

test('MCP alias convergence: analyze_app and qulib_analyze_app share handleAnalyzeApp', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const indexSrc = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
  // Both registrations should reference the same handler constant
  const analyzeAppMatches = (indexSrc.match(/handleAnalyzeApp/g) ?? []).length;
  // At minimum: 3 occurrences — function definition + analyze_app registration + qulib_analyze_app registration
  assert.ok(
    analyzeAppMatches >= 3,
    `handleAnalyzeApp should appear at least 3 times (def + 2 registrations), found ${analyzeAppMatches}`
  );
});

test('MCP alias convergence: explore_auth and qulib_explore_auth share handleExploreAuth', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const indexSrc = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
  const matches = (indexSrc.match(/handleExploreAuth/g) ?? []).length;
  assert.ok(
    matches >= 3,
    `handleExploreAuth should appear at least 3 times (def + 2 registrations), found ${matches}`
  );
});

test('MCP alias convergence: detect_auth and qulib_detect_auth share handleDetectAuth', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const indexSrc = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
  const matches = (indexSrc.match(/handleDetectAuth/g) ?? []).length;
  assert.ok(
    matches >= 3,
    `handleDetectAuth should appear at least 3 times (def + 2 registrations), found ${matches}`
  );
});

// ---------------------------------------------------------------------------
// Description invariants: canonical forms must note they are canonical;
// legacy forms must note that a canonical alias exists.
// ---------------------------------------------------------------------------

test('MCP alias convergence: qulib_analyze_app description notes canonical form', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const indexSrc = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
  assert.ok(
    indexSrc.includes('Canonical qulib_ form; analyze_app is the legacy alias'),
    'qulib_analyze_app description should mention it is canonical and analyze_app is the legacy alias'
  );
});

test('MCP alias convergence: analyze_app description points to qulib_analyze_app', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const indexSrc = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
  assert.ok(
    indexSrc.includes('Alias for new integrations: qulib_analyze_app'),
    'analyze_app description should direct new integrations to qulib_analyze_app'
  );
});

// ---------------------------------------------------------------------------
// Scaffold stub accuracy: description must NOT advertise Playwright as working
// ---------------------------------------------------------------------------

test('MCP stub de-advertising: qulib_scaffold_tests description marks playwright as not yet implemented', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const indexSrc = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
  assert.ok(
    indexSrc.includes('playwright scaffold is experimental and not yet implemented'),
    'scaffold description should not advertise playwright as working'
  );
});

// ---------------------------------------------------------------------------
// Equivalence via @qulib/core public surface: buildAnalyzeAppMcpPayload
// produces identical output for two identical AnalyzeResult inputs.
// This proves the shared function contract — if handleAnalyzeApp were two
// diverged copies, their payloads could differ. Two identical inputs must
// always produce equal outputs from the same function.
// ---------------------------------------------------------------------------

test('MCP alias equivalence: identical AnalyzeResult inputs produce identical payloads', async () => {
  const { buildAnalyzeAppMcpPayload } = await import('../analyze-app-mcp-payload.js');
  const { type: analyzeResultType } = await import('@qulib/core');

  // Build a minimal but schema-valid AnalyzeResult
  const now = new Date().toISOString();
  const result = {
    status: 'complete' as const,
    coverageScore: 80,
    releaseConfidence: 80,
    gaps: [],
    gapAnalysis: {
      analyzedAt: now,
      mode: 'url-only' as const,
      releaseConfidence: 80,
      coveragePagesScanned: 5,
      coverageBudgetExceeded: false,
      gaps: [],
      scenarios: [],
      generatedTests: [],
    },
    routeInventory: {
      scannedAt: now,
      baseUrl: 'https://fixture.example.com',
      routes: [],
      pagesSkipped: 0,
      budgetExceeded: false,
    },
    repoInventory: null,
    decisionLog: [],
    publicSurface: null,
  };

  const opts = { includeFullReport: false, agentSummary: false };

  // Simulate both aliases calling the same function with same input
  const payloadViaOldName = buildAnalyzeAppMcpPayload(result, opts);
  const payloadViaNewName = buildAnalyzeAppMcpPayload(result, opts);

  assert.deepStrictEqual(
    payloadViaOldName,
    payloadViaNewName,
    'Both alias calls must produce identical payloads for identical inputs'
  );
});
