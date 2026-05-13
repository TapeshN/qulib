/**
 * Wiring test: `analyzeApp` must short-circuit to a structured `blocked` result
 * when `validateStorageState` reports the storage state is invalid.
 *
 * This test deliberately uses a non-existent storage state path so the validator
 * short-circuits at the `missing-file` preflight, never launching Playwright.
 * That keeps the test fast, deterministic, and runnable in offline CI. The full
 * reason-code surface is covered by the pure-helper tests in
 * `tools/auth/__tests__/detector.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeApp } from '../analyze.js';
import { HarnessConfigSchema, type HarnessConfig } from '../schemas/config.schema.js';
import type { TelemetryEvent, TelemetrySink } from '../telemetry/telemetry.interface.js';

function harness(): HarnessConfig {
  return HarnessConfigSchema.parse({
    maxPagesToScan: 1,
    maxDepth: 1,
    minPagesForConfidence: 1,
    timeoutMs: 2000,
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

test('analyzeApp short-circuits to blocked when storage state file is missing', async () => {
  const url = 'https://app.example/dashboard';
  const missingPath = join(tmpdir(), `qulib-missing-storage-${Date.now()}-${Math.random()}.json`);

  const events: TelemetryEvent[] = [];
  const telemetry: TelemetrySink = {
    emit(event) {
      events.push(event);
    },
  };

  const config: HarnessConfig = {
    ...harness(),
    auth: { type: 'storage-state', path: missingPath },
  };

  const result = await analyzeApp({
    url,
    config,
    writeArtifacts: false,
    skipAuthDetection: true,
    telemetry,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.releaseConfidence, 0);
  assert.equal(result.coverageScore, null);
  assert.equal(result.routeInventory.routes.length, 0);
  assert.equal(result.publicSurface, null);
  assert.equal(result.repoInventory, null);

  assert.equal(result.gaps.length >= 1, true);
  const invalidGap = result.gaps.find((g) => g.id === 'storage-state-invalid');
  assert.ok(invalidGap, 'expected a storage-state-invalid gap');
  assert.equal(invalidGap.severity, 'critical');
  assert.equal(invalidGap.category, 'coverage');
  assert.match(invalidGap.reason, /missing-file/);
  assert.ok(invalidGap.recommendation, 'expected a recovery recommendation');
  assert.match(invalidGap.recommendation, /qulib auth login|qulib auth init/);

  assert.equal(result.gapAnalysis.mode, 'auth-required');
  assert.equal(result.gapAnalysis.releaseConfidence, 0);

  const decision = result.decisionLog.find((d) => d.decision === 'storage-state-invalid');
  assert.ok(decision, 'expected a storage-state-invalid decision log entry');
  assert.match(decision.reason, /missing-file/);

  const validationEvent = events.find((e) => e.kind === 'auth.storage-state.validated');
  assert.ok(validationEvent, 'expected a storage-state validation telemetry event');
  assert.equal(validationEvent.metadata.valid, false);
  assert.equal(validationEvent.metadata.reasonCode, 'missing-file');
  assert.equal(validationEvent.metadata.storageStateProvided, true);
  assert.equal(validationEvent.metadata.targetOrigin, 'https://app.example');

  for (const e of events) {
    for (const [, v] of Object.entries(e.metadata)) {
      assert.ok(
        typeof v !== 'string' || !v.includes(missingPath),
        'telemetry must not carry the storage state file path'
      );
    }
  }

  const blockedEvent = events.find((e) => e.kind === 'scan.blocked');
  assert.ok(blockedEvent, 'expected a scan.blocked telemetry event');
  assert.equal(blockedEvent.metadata.reasonCode, 'missing-file');
});
