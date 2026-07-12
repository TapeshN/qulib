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
  // The fixture's two `change` steps (Email, Password) each carry a
  // possible-<select> warning — Recorder cannot disambiguate a <select>
  // from a text input, so this is never silent.
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => w.includes('may be a <select> element')));

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

  const { scenarios, warnings, rejectedJourneys } = resolveJourneyScenarios([
    loadFixture() as Record<string, unknown>,
    neutralScenario,
  ]);
  assert.equal(scenarios.length, 2);
  assert.equal(scenarios[0]?.id, 'recorder-listly-login-flow');
  assert.equal(scenarios[1]?.id, 'hand-authored');
  assert.equal(warnings.length, 2, 'the two change-step possible-<select> warnings, index-prefixed');
  assert.ok(warnings.every((w) => w.startsWith('journeys[0]:') && w.includes('may be a <select> element')));
  assert.deepEqual(rejectedJourneys, []);
});

test('resolveJourneyScenarios: undefined input yields empty scenarios, not an error', () => {
  const { scenarios, warnings, rejectedJourneys } = resolveJourneyScenarios(undefined);
  assert.deepEqual(scenarios, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(rejectedJourneys, []);
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
// rejected (zero-step) journeys — FINDING 3
// ---------------------------------------------------------------------------

test('resolveJourneyScenarios: an all-unmappable Recorder flow is excluded from scenarios and reported in rejectedJourneys', () => {
  const allUnmappable = {
    title: 'Nothing but hover/scroll',
    steps: [{ type: 'hover', selectors: [['.menu']] }, { type: 'scroll' }],
  };
  const { scenarios, rejectedJourneys } = resolveJourneyScenarios([allUnmappable]);
  assert.deepEqual(scenarios, [], 'a zero-step conversion must never appear in scenarios');
  assert.equal(rejectedJourneys.length, 1);
  assert.equal(rejectedJourneys[0]?.index, 0);
  assert.equal(rejectedJourneys[0]?.title, 'Nothing but hover/scroll');
  assert.match(rejectedJourneys[0]?.reason ?? '', /no steps could be converted/);
});

test('resolveJourneyScenarios: an already-empty NeutralScenario-shaped entry is also excluded and reported', () => {
  // NOTE: `{ title: string, steps: [] }` is inherently ambiguous between the
  // two supported shapes — isRecorderFlow resolves that ambiguity by
  // treating a zero-step `steps` array as Recorder-shaped (see its own
  // "empty flow" test), so this entry is converted via importRecorderFlow,
  // not parsed as a NeutralScenario directly. Either way it must land in
  // rejectedJourneys, never in scenarios — that end-to-end outcome is what
  // this test proves; the defensive zero-step check on the NeutralScenario
  // branch in resolveJourneyScenarios covers the case where that ambiguity
  // is ever resolved differently.
  const emptyScenario = {
    id: 'stub',
    title: 'Stub',
    description: 'd',
    targetPath: '/',
    steps: [],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { scenarios, rejectedJourneys } = resolveJourneyScenarios([emptyScenario]);
  assert.deepEqual(scenarios, []);
  assert.equal(rejectedJourneys.length, 1);
  assert.equal(rejectedJourneys[0]?.title, 'Stub');
});

test('resolveJourneyScenarios: a mix of usable and rejected journeys keeps only the usable ones in scenarios', () => {
  const usable = loadFixture() as Record<string, unknown>;
  const allUnmappable = { title: 'Unusable', steps: [{ type: 'scroll' }] };
  const { scenarios, rejectedJourneys } = resolveJourneyScenarios([usable, allUnmappable]);
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0]?.id, 'recorder-listly-login-flow');
  assert.equal(rejectedJourneys.length, 1);
  assert.equal(rejectedJourneys[0]?.index, 1);
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

// ---------------------------------------------------------------------------
// end-to-end: an all-rejected journeys[] never scaffolds a stub "success" — FINDING 3
// ---------------------------------------------------------------------------

test('handleScaffoldTests: an all-unmappable journeys entry does not contribute to scenarioCount/testCount and surfaces rejectedJourneys, without falling back to a live crawl', async () => {
  await withEnv({ [TAP_TIER_ENV]: 'enterprise' }, async () => {
    const response = await handleScaffoldTests({
      // Deliberately unreachable — if the all-rejected journeys entry fell
      // back to crawling the URL (instead of respecting "journeys supplied
      // ⇒ never crawl" even when every entry rejects), this call would hang
      // or error against a real network attempt instead of returning cleanly.
      url: 'https://127.0.0.1:1/unreachable-for-test',
      framework: 'cypress-e2e',
      journeys: [{ title: 'Nothing but hover/scroll', steps: [{ type: 'hover' }, { type: 'scroll' }] }],
    });
    const body = parseText(response);
    assert.ok(!('error' in body), `expected no tool error, got ${JSON.stringify(body)}`);
    assert.equal(body['scenarioCount'], 0, 'a zero-step conversion must never be counted as a scenario');
    assert.equal(body['testCount'], 0, 'a zero-step conversion must never be counted as a generated test');
    assert.equal((body['generatedTests'] as unknown[]).length, 0);

    const rejected = body['rejectedJourneys'] as Array<{ index: number; title: string; reason: string }>;
    assert.ok(rejected, 'rejectedJourneys must be present as a distinct, non-ignorable field');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.index, 0);
    assert.equal(rejected[0]?.title, 'Nothing but hover/scroll');
    assert.match(rejected[0]?.reason ?? '', /unmappable/);
  });
});
