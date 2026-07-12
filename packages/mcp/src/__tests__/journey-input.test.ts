/**
 * Journey interchange tests — the MCP surface onto @qulib/core's Recorder
 * converter (journey-input.ts + the `journeys` field on qulib_scaffold_tests).
 *
 * Coverage:
 *   - RUNTIME-IMPORT CONSUMER TEST: imports importRecorderFlow/isRecorderFlow
 *     from the PUBLIC built '@qulib/core' package (not a relative source
 *     path) and asserts the converted NeutralScenario's real field values
 *     against the on-disk Recorder fixture — proves the public export surface
 *     actually works, not just the internal module.
 *   - resolveJourneyScenarios: Recorder entries convert, already-NeutralScenario
 *     entries pass through validated, and a malformed entry throws an
 *     index-prefixed error naming which journeys[] entry failed.
 *   - end-to-end: handleScaffoldTests with a Recorder-JSON journeys entry
 *     produces a real generated Cypress spec containing the resilient
 *     selector chosen by the converter — the full downstream scaffold path,
 *     driven through the actual MCP tool handler.
 *   - a malformed journeys entry surfaces as QULIB_INPUT_INVALID, never a
 *     raw stack trace.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runtime-import consumer test target: the PUBLIC built package surface.
import { importRecorderFlow, isRecorderFlow, NeutralScenarioSchema } from '@qulib/core';

import { resolveJourneyScenarios } from '../journey-input.js';
import { handleScaffoldTests } from '../index.js';
import { TAP_TIER_ENV } from '../entitlements.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..', '..', '..', 'core', 'fixtures', 'recorder', 'listly-login-flow.json');

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

async function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const val = overrides[key];
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function parseText(response: { content: [{ type: 'text'; text: string }] }): Record<string, unknown> {
  return JSON.parse(response.content[0].text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Runtime-import consumer test — imports the PUBLIC @qulib/core package
// ---------------------------------------------------------------------------

test('@qulib/core public export: importRecorderFlow converts the real on-disk fixture with correct values', () => {
  const raw = loadFixture();
  assert.equal(isRecorderFlow(raw), true, 'the fixture is recognized as Recorder-shaped via the public export');

  const { scenario, warnings } = importRecorderFlow(raw);

  // Parses against the same NeutralScenarioSchema every other consumer in the
  // codebase trusts — also imported from the public package here, not a
  // relative source path, so this is a genuine consumer-surface assertion.
  assert.deepEqual(NeutralScenarioSchema.parse(scenario), scenario);

  assert.equal(scenario.id, 'recorder-listly-login-flow');
  assert.equal(scenario.title, 'Listly login flow');
  assert.equal(scenario.targetPath, '/login');
  assert.deepEqual(warnings, []);

  const clickEmail = scenario.steps.find((s) => s.action === 'click' && s.target === 'aria/Email');
  assert.ok(clickEmail, 'aria/Email click step present with the aria selector chosen over #email-input/xpath');

  const typeEmail = scenario.steps.find((s) => s.action === 'type' && s.target === 'aria/Email');
  assert.equal(typeEmail?.value, 'reader@example.test');

  const keyDownStep = scenario.steps.find((s) => s.value === '{enter}');
  assert.ok(keyDownStep, 'keyDown Enter converted to Cypress special-key syntax');
  assert.equal(keyDownStep?.target, 'aria/Password', 'keyDown reuses the last interacted target');
});

// ---------------------------------------------------------------------------
// resolveJourneyScenarios
// ---------------------------------------------------------------------------

test('resolveJourneyScenarios: converts a Recorder entry and passes through an already-NeutralScenario entry', () => {
  const neutralScenario = {
    id: 'hand-authored',
    title: 'Hand-authored scenario',
    description: 'd',
    targetPath: '/',
    steps: [{ action: 'navigate', target: '/', description: 'go' }],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };

  const { scenarios, warnings } = resolveJourneyScenarios([loadFixture() as Record<string, unknown>, neutralScenario]);
  assert.equal(scenarios.length, 2);
  assert.equal(scenarios[0]?.id, 'recorder-listly-login-flow');
  assert.equal(scenarios[1]?.id, 'hand-authored');
  assert.deepEqual(warnings, []);
});

test('resolveJourneyScenarios: undefined input yields empty scenarios, not an error', () => {
  const { scenarios, warnings } = resolveJourneyScenarios(undefined);
  assert.deepEqual(scenarios, []);
  assert.deepEqual(warnings, []);
});

test('resolveJourneyScenarios: an entry that is neither Recorder nor NeutralScenario throws an index-prefixed error', () => {
  assert.throws(
    () => resolveJourneyScenarios([{ nonsense: true }]),
    /journeys\[0\] is neither a Chrome DevTools Recorder export.*nor a valid NeutralScenario/s
  );
});

test('resolveJourneyScenarios: propagates a Recorder conversion warning index-prefixed', () => {
  const flowWithUnknownStep = {
    title: 'Has an unmappable step',
    steps: [{ type: 'hover', selectors: [['.menu']] }],
  };
  const { warnings } = resolveJourneyScenarios([flowWithUnknownStep]);
  assert.ok(warnings.some((w) => w.startsWith('journeys[0]:') && w.includes('hover')));
});

// ---------------------------------------------------------------------------
// end-to-end: handleScaffoldTests with a Recorder journeys entry
// ---------------------------------------------------------------------------

test('handleScaffoldTests: a Recorder journeys entry scaffolds a real Cypress spec with the resilient selector, no crawl needed', async () => {
  await withEnv({ [TAP_TIER_ENV]: 'enterprise' }, async () => {
    const response = await handleScaffoldTests({
      // Deliberately unreachable — proves the URL is never crawled when
      // journeys are supplied (options.scenarios bypasses analyzeApp entirely).
      url: 'https://127.0.0.1:1/unreachable-for-test',
      framework: 'cypress-e2e',
      journeys: [loadFixture() as Record<string, unknown>],
    });
    const body = parseText(response);
    assert.ok(!('error' in body), `expected no tool error, got ${JSON.stringify(body)}`);
    assert.equal(body['scenarioCount'], 1);

    const generatedTests = body['generatedTests'] as Array<{ code: string }>;
    assert.equal(generatedTests.length, 1);
    assert.match(generatedTests[0]!.code, /cy\.get\("aria\/Email"\)/);
    assert.match(generatedTests[0]!.code, /cy\.visit\("\/login"\)/);
  });
});

test('handleScaffoldTests: a malformed journeys entry returns QULIB_INPUT_INVALID, not a stack trace', async () => {
  await withEnv({ [TAP_TIER_ENV]: 'enterprise' }, async () => {
    const response = await handleScaffoldTests({
      url: 'https://127.0.0.1:1/unreachable-for-test',
      framework: 'cypress-e2e',
      journeys: [{ garbage: 'not a flow or a scenario' }],
    });
    const body = parseText(response);
    assert.ok('error' in body);
    const err = body['error'] as Record<string, unknown>;
    assert.equal(err['code'], 'QULIB_INPUT_INVALID');
    assert.match(err['message'] as string, /journeys\[0\]/);
  });
});
