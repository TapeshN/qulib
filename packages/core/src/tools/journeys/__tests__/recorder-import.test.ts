/**
 * Recorder → NeutralScenario converter tests (node:test, real assertions).
 *
 * Coverage:
 *   - a REAL on-disk Recorder export fixture parses and converts, with the
 *     resulting NeutralScenario values asserted field-by-field (not just types)
 *   - selector-preference: aria beats css when both are present in the chain
 *   - unknown/unmapped step types are tolerated (skip + warning), never throw
 *   - malformed input (not an object, missing steps, a step with no `type`)
 *     is rejected with a clear error
 *   - format auto-detection (isRecorderFlow) distinguishes a Recorder export
 *     from an already-NeutralScenario-shaped object
 *   - round-trip: the converted scenario is actually consumable by
 *     scaffoldTests end-to-end (the real downstream scoring/scaffold path) —
 *     the chosen resilient selector lands verbatim in the generated Cypress
 *     spec and the spec passes real TypeScript compilation.
 *   - waitForElement count/operator: an element-COUNT assertion converts to
 *     assert-count (not a single-element assert-visible), with a warning for
 *     any operator other than ">=" (the only one the Cypress adapter renders
 *     faithfully).
 *   - change vs select: every change step is warned about as a possible
 *     <select> (Recorder cannot disambiguate), and the new 'select' action
 *     renders through the Cypress adapter.
 *   - rejected flows: a flow whose every step is unmappable reports
 *     `rejected: true` rather than silently reading as a normal conversion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importRecorderFlow, isRecorderFlow, pickResilientSelector } from '../recorder-import.js';
import { NeutralScenarioSchema } from '../../../schemas/gap-analysis.schema.js';
import { scaffoldTests } from '../../../scaffold-tests.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..', '..', '..', '..', 'fixtures', 'recorder', 'listly-login-flow.json');

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

// ---------------------------------------------------------------------------
// real on-disk fixture → converted NeutralScenario, value-by-value
// ---------------------------------------------------------------------------

test('importRecorderFlow: real on-disk fixture converts to a valid NeutralScenario with the expected values', () => {
  const raw = loadFixture();
  const { scenario, warnings, rejected } = importRecorderFlow(raw);
  assert.equal(rejected, false, 'nine steps converted — not a rejected conversion');

  // Self-verifying inside the converter already, but prove it here too — the
  // schema every other NeutralScenario producer/consumer in the codebase trusts.
  assert.deepEqual(NeutralScenarioSchema.parse(scenario), scenario);

  assert.equal(scenario.id, 'recorder-listly-login-flow');
  assert.equal(scenario.title, 'Listly login flow');
  assert.equal(scenario.targetPath, '/login', 'targetPath seeded from the first navigate step url path');
  assert.ok(scenario.tags.includes('recorder-import'));
  assert.deepEqual(scenario.sourceGapIds, []);
  assert.equal(scenario.recommendations[0]?.adapter, 'cypress-e2e');

  // setViewport/keyUp are silently-skipped no-ops, so the only warnings this
  // well-formed fixture produces are the possible-<select> notes on its two
  // `change` steps (Email, Password) — Recorder cannot tell a <select> from
  // a text input, so every change step is warned about, never silently
  // guessed at with false confidence.
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => w.includes('may be a <select> element')));

  const actions = scenario.steps.map((s) => s.action);
  assert.deepEqual(actions, [
    'navigate', // navigate -> /login
    'assert-visible', // assertedEvents navigation on the navigate step
    'click', // click Email (aria)
    'type', // change Email
    'click', // click Password (aria)
    'type', // change Password
    'type', // keyDown Enter -> {enter} on last target (Password)
    'assert-visible', // assertedEvents navigation on the keyDown step
    'assert-visible', // waitForElement visible:true -> dashboard root
  ]);

  const navigateStep = scenario.steps[0]!;
  assert.equal(navigateStep.target, '/login');
  assert.equal(navigateStep.description, 'Navigate to https://app.example.test/login');

  const navAssertStep = scenario.steps[1]!;
  assert.match(navAssertStep.description, /Expect navigation to complete: https:\/\/app\.example\.test\/login/);
  assert.match(navAssertStep.description, /Listly — Log in/);

  const clickEmailStep = scenario.steps[2]!;
  assert.equal(clickEmailStep.target, 'aria/Email', 'aria selector preferred over #email-input / xpath');
  assert.match(clickEmailStep.description, /"Email" \(aria\)/);

  const typeEmailStep = scenario.steps[3]!;
  assert.equal(typeEmailStep.target, 'aria/Email');
  assert.equal(typeEmailStep.value, 'reader@example.test');

  const typePasswordStep = scenario.steps[5]!;
  assert.equal(typePasswordStep.target, 'aria/Password');
  assert.equal(typePasswordStep.value, 'correct-horse-battery');

  const keyDownStep = scenario.steps[6]!;
  assert.equal(keyDownStep.action, 'type');
  assert.equal(keyDownStep.target, 'aria/Password', 'keyDown with no selectors of its own reuses the last interacted target');
  assert.equal(keyDownStep.value, '{enter}', 'Cypress special-key syntax for a keyDown Enter');

  const dashboardAssertStep = scenario.steps[7]!;
  assert.match(dashboardAssertStep.description, /Expect navigation to complete: https:\/\/app\.example\.test\/dashboard/);

  const waitStep = scenario.steps[8]!;
  assert.equal(waitStep.action, 'assert-visible');
  assert.equal(waitStep.target, 'aria/Your reading list');
});

// ---------------------------------------------------------------------------
// selector preference
// ---------------------------------------------------------------------------

test('pickResilientSelector: aria beats css when both are present in the fallback chain', () => {
  const pick = pickResilientSelector([['#submit-btn'], ['aria/Submit'], ['xpath//button']]);
  assert.equal(pick?.selector, 'aria/Submit');
  assert.equal(pick?.rank, 'aria');
});

test('pickResilientSelector: text beats css but loses to aria', () => {
  const pick = pickResilientSelector([['.btn-primary'], ['text/Continue']]);
  assert.equal(pick?.selector, 'text/Continue');
  assert.equal(pick?.rank, 'text');
});

test('pickResilientSelector: css beats xpath when aria/text are absent', () => {
  const pick = pickResilientSelector([['xpath//html/body/button'], ['.checkout-btn']]);
  assert.equal(pick?.selector, '.checkout-btn');
  assert.equal(pick?.rank, 'css');
});

test('pickResilientSelector: xpath is the last resort when nothing else is offered', () => {
  const pick = pickResilientSelector([['xpath//html/body/div/button']]);
  assert.equal(pick?.rank, 'xpath');
});

test('pickResilientSelector: undefined when no selectors are supplied at all', () => {
  assert.equal(pickResilientSelector(undefined), undefined);
  assert.equal(pickResilientSelector([]), undefined);
});

// ---------------------------------------------------------------------------
// unknown-step tolerance
// ---------------------------------------------------------------------------

test('importRecorderFlow: an unknown step type is tolerated (skipped with a warning), never throws', () => {
  const flow = {
    title: 'Future Recorder Flow',
    steps: [
      { type: 'navigate', url: 'https://app.example.test/' },
      { type: 'someBrandNewStepTypeFromAFutureChromeVersion', foo: 'bar' },
      { type: 'click', selectors: [['aria/Go']] },
    ],
  };
  const { scenario, warnings, rejected } = importRecorderFlow(flow);
  assert.equal(scenario.steps.length, 2, 'the unknown step contributes no TestStep');
  assert.ok(
    warnings.some((w) => w.includes('unknown step type "someBrandNewStepTypeFromAFutureChromeVersion"')),
    'a clear warning names the unmapped type'
  );
  assert.equal(rejected, false, 'two steps converted — not a rejected conversion');
});

test('importRecorderFlow: hover/scroll/waitForExpression are tolerated and warned about, not thrown', () => {
  const flow = {
    title: 'Mixed unsupported steps',
    steps: [
      { type: 'hover', selectors: [['.menu-item']] },
      { type: 'scroll' },
      { type: 'waitForExpression', expression: 'window.__ready === true' },
    ],
  };
  const { scenario, warnings, rejected } = importRecorderFlow(flow);
  assert.equal(scenario.steps.length, 0);
  assert.equal(
    warnings.length,
    5,
    '3 skip warnings + the no-navigate-step targetPath warning + the zero-converted-steps warning'
  );
  assert.ok(warnings.some((w) => w.includes('hover')));
  assert.ok(warnings.some((w) => w.includes('scroll')));
  assert.ok(warnings.some((w) => w.includes('waitForExpression')));
  assert.equal(rejected, true, 'zero steps converted — this IS a rejected conversion (FINDING 3)');
});

test('importRecorderFlow: doubleClick is downgraded to a click, with a warning explaining the downgrade', () => {
  const flow = {
    title: 'Double click flow',
    steps: [{ type: 'doubleClick', selectors: [['aria/Expand row']] }],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps[0]?.action, 'click');
  assert.equal(scenario.steps[0]?.target, 'aria/Expand row');
  assert.ok(warnings.some((w) => w.includes('doubleClick') && w.includes('mapped to a single click')));
});

// ---------------------------------------------------------------------------
// waitForElement count/operator → assert-count — FINDING 1
// ---------------------------------------------------------------------------

test('importRecorderFlow: waitForElement with count+operator produces assert-count, not assert-visible', () => {
  const flow = {
    title: 'Count assertion flow',
    steps: [
      {
        type: 'waitForElement',
        selectors: [['.result-row']],
        count: 3,
        operator: '>=',
      },
    ],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps.length, 1);
  assert.equal(scenario.steps[0]?.action, 'assert-count', 'count semantics must not be discarded as assert-visible');
  assert.equal(scenario.steps[0]?.target, '.result-row');
  assert.equal(scenario.steps[0]?.value, '3');
  assert.ok(!warnings.some((w) => w.includes('has no faithful Cypress adapter rendering')), '>= is faithfully supported — no operator warning');
});

test('importRecorderFlow: waitForElement count with no explicit operator defaults to >= and warns for nothing', () => {
  const flow = {
    title: 'Count assertion, default operator',
    steps: [{ type: 'waitForElement', selectors: [['.item']], count: 5 }],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps[0]?.action, 'assert-count');
  assert.equal(scenario.steps[0]?.value, '5');
  assert.ok(!warnings.some((w) => w.includes('has no faithful Cypress adapter rendering')));
});

test('importRecorderFlow: waitForElement count with a non->= operator emits a warning (no faithful adapter rendering)', () => {
  const flow = {
    title: 'Count assertion, unsupported operator',
    steps: [
      {
        type: 'waitForElement',
        selectors: [['.item']],
        count: 2,
        operator: '==',
      },
    ],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps[0]?.action, 'assert-count', 'still converted, just with a warning about fidelity');
  assert.ok(
    warnings.some((w) => w.includes('"=="') && w.includes('has no faithful Cypress adapter rendering')),
    'a non->= operator must be warned about, since the Cypress adapter only renders >='
  );
});

test('importRecorderFlow: waitForElement with no count still maps to assert-visible/assert-hidden as before', () => {
  const flow = {
    title: 'Plain visibility wait',
    steps: [
      { type: 'navigate', url: 'https://app.example.test/' },
      { type: 'waitForElement', selectors: [['.banner']], visible: true },
      { type: 'waitForElement', selectors: [['.spinner']], visible: false },
    ],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps[1]?.action, 'assert-visible');
  assert.equal(scenario.steps[2]?.action, 'assert-hidden');
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------------------
// change vs select — FINDING 2
// ---------------------------------------------------------------------------

test('importRecorderFlow: a change step yields a type step AND a possible-<select> warning', () => {
  const flow = {
    title: 'Change step flow',
    steps: [
      { type: 'navigate', url: 'https://app.example.test/settings' },
      { type: 'change', selectors: [['#country']], value: 'Canada' },
    ],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps[1]?.action, 'type', 'still converts to type — the converter never silently guesses select');
  assert.equal(scenario.steps[1]?.value, 'Canada');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /may be a <select> element/);
  assert.match(warnings[0]!, /"select"/, 'the warning points the reader at the select action to opt in after review');
});

test("importRecorderFlow: a hand-authored 'select' TestStep action renders through the Cypress adapter", async () => {
  const scenario = {
    id: 'scn-select-001',
    title: 'Country picker',
    description: 'Pick a country from a real <select>',
    targetPath: '/settings',
    steps: [
      { action: 'navigate' as const, target: '/settings', description: 'go to settings' },
      { action: 'select' as const, target: '#country', value: 'Canada', description: 'pick Canada' },
    ],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const result = await scaffoldTests('https://app.example.test', {
    framework: 'cypress-e2e',
    scenarios: [scenario],
  });
  const spec = result.generatedTests[0]!;
  assert.match(spec.code, /cy\.get\("#country"\)\.select\("Canada"\);/, 'select TestStep renders cy.get(...).select(...)');
  assert.equal(result.specValidation.ok, true, JSON.stringify(result.specValidation));
});

// ---------------------------------------------------------------------------
// malformed JSON rejection
// ---------------------------------------------------------------------------

test('importRecorderFlow: throws a clear error when input is not an object', () => {
  assert.throws(() => importRecorderFlow('not a flow'), /failed schema validation/);
  assert.throws(() => importRecorderFlow(null), /failed schema validation/);
  assert.throws(() => importRecorderFlow(42), /failed schema validation/);
});

test('importRecorderFlow: throws a clear error when `steps` is missing or not an array', () => {
  assert.throws(() => importRecorderFlow({ title: 'No steps field' }), /failed schema validation/);
  assert.throws(() => importRecorderFlow({ title: 'Bad steps', steps: 'nope' }), /failed schema validation/);
});

test('importRecorderFlow: throws a clear error when a step has no string `type`', () => {
  assert.throws(
    () => importRecorderFlow({ title: 'Bad step', steps: [{ selectors: [['aria/Go']] }] }),
    /failed schema validation/
  );
});

// ---------------------------------------------------------------------------
// format auto-detection
// ---------------------------------------------------------------------------

test('isRecorderFlow: true for a Recorder-shaped object', () => {
  assert.equal(isRecorderFlow(loadFixture()), true);
  assert.equal(isRecorderFlow({ title: 'Empty flow', steps: [] }), true);
});

test('isRecorderFlow: false for an already-NeutralScenario-shaped object (action, not type)', () => {
  const neutralScenario = {
    id: 'sc-1',
    title: 'A scenario',
    description: 'd',
    targetPath: '/',
    steps: [{ action: 'navigate', target: '/', description: 'go' }],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  assert.equal(isRecorderFlow(neutralScenario), false);
});

test('isRecorderFlow: false for non-objects and objects missing title/steps', () => {
  assert.equal(isRecorderFlow(null), false);
  assert.equal(isRecorderFlow('a string'), false);
  assert.equal(isRecorderFlow({ title: 'no steps field' }), false);
  assert.equal(isRecorderFlow({ steps: [] }), false);
});

// ---------------------------------------------------------------------------
// round-trip: the converted scenario is actually consumable end-to-end
// ---------------------------------------------------------------------------

test('round-trip: a converted scenario flows through scaffoldTests into a real, compilable Cypress spec', async () => {
  const { scenario } = importRecorderFlow(loadFixture());
  const result = await scaffoldTests('https://app.example.test', {
    framework: 'cypress-e2e',
    scenarios: [scenario],
  });

  assert.equal(result.generatedTests.length, 1);
  const spec = result.generatedTests[0]!;
  assert.match(spec.code, /cy\.get\("aria\/Email"\)/, 'the resilient aria selector lands verbatim in the generated spec');
  assert.match(spec.code, /cy\.get\("aria\/Email"\)\.type\("reader@example\.test"\)/);
  assert.match(spec.code, /cy\.visit\("\/login"\)/);
  assert.match(spec.code, /\{enter\}/, 'the keyDown Enter step renders as Cypress special-key syntax');

  // The real proof of consumability: the generated spec actually compiles.
  assert.equal(result.specValidation.ok, true, JSON.stringify(result.specValidation));
});
