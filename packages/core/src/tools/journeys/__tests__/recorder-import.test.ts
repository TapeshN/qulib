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

  // keyUp is a silently-skipped no-op (redundant with the paired keyDown,
  // which already emits a full key-press step), so this well-formed
  // fixture's warnings are: one setViewport informational note, plus the
  // possible-non-text-input notes on its two `change` steps (Email,
  // Password) — Recorder cannot tell a <select>/checkbox/radio from a text
  // input, so every change step is warned about, never silently guessed at
  // with false confidence.
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((w) => w.includes('setViewport step at index 0 is informational only')));
  assert.equal(warnings.filter((w) => w.includes('may be a non-text-input element')).length, 2);

  const actions = scenario.steps.map((s) => s.action);
  assert.deepEqual(actions, [
    'navigate', // navigate -> /login
    'assert-visible', // assertedEvents navigation on the navigate step
    'click', // click Email (aria)
    'type', // change Email
    'click', // click Password (aria)
    'type', // change Password
    'key-press', // keyDown Enter -> framework-neutral key-press on last target (Password)
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
  assert.equal(keyDownStep.action, 'key-press');
  assert.equal(keyDownStep.target, 'aria/Password', 'keyDown with no selectors of its own reuses the last interacted target');
  assert.equal(keyDownStep.value, 'Enter', 'raw key name carried through — not Cypress-only {key} syntax (FINDING 1)');

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
  assert.ok(!warnings.some((w) => w.includes('has no faithful rendering in EITHER adapter')), '>= is faithfully supported — no operator warning');
});

test('importRecorderFlow: waitForElement count with no explicit operator defaults to >= and warns for nothing', () => {
  const flow = {
    title: 'Count assertion, default operator',
    steps: [{ type: 'waitForElement', selectors: [['.item']], count: 5 }],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps[0]?.action, 'assert-count');
  assert.equal(scenario.steps[0]?.value, '5');
  assert.ok(!warnings.some((w) => w.includes('has no faithful rendering in EITHER adapter')));
});

test('importRecorderFlow: waitForElement count with a non->= operator emits a warning naming BOTH adapters (no faithful rendering in either)', () => {
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
    warnings.some(
      (w) => w.includes('"=="') && w.includes('has no faithful rendering in EITHER adapter') && w.includes('cypress-e2e') && w.includes('playwright')
    ),
    'a non->= operator must be warned about, naming BOTH adapters (neither cypress-e2e nor playwright renders anything but >=) — ' +
      'FINDING-2-class fix: never name only one adapter\'s risk when the other shares it'
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

test('importRecorderFlow: a change step yields a type step AND a broadened non-text-input warning naming select, checkbox, AND radio (FINDING 2)', () => {
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
  // A warning that names only <select> is a false-reassurance warning — the
  // SAME class of bug the reviewer keeps finding elsewhere: .type()/.fill()
  // fail against checkbox and radio too, not just <select>. Assert ALL
  // THREE risks are named, plus both frameworks that share the failure mode.
  assert.match(warnings[0]!, /may be a non-text-input element/);
  assert.match(warnings[0]!, /<select>/);
  assert.match(warnings[0]!, /checkbox/);
  assert.match(warnings[0]!, /radio/);
  assert.match(warnings[0]!, /Cypress/);
  assert.match(warnings[0]!, /Playwright/);
  assert.match(warnings[0]!, /"select"/, 'the warning points the reader at the select action to opt in after review');
  assert.match(warnings[0]!, /"click"/, 'the warning also points a checkbox/radio target at the click action');
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
// keyDown -> key-press cross-adapter fidelity — FINDING 1
// ---------------------------------------------------------------------------

test('importRecorderFlow: keyDown converts to a framework-neutral key-press TestStep carrying the RAW key, never Cypress-only {key} syntax', () => {
  const flow = {
    title: 'Tab flow',
    steps: [
      { type: 'click', selectors: [['aria/Name']] },
      { type: 'keyDown', key: 'Tab' },
    ],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  const keyPress = scenario.steps.find((s) => s.action === 'key-press');
  assert.ok(keyPress, 'keyDown converts to a key-press step, never silently dropped');
  assert.equal(keyPress?.value, 'Tab', 'raw KeyboardEvent.key value, not "{tab}" Cypress syntax');
  assert.equal(keyPress?.target, 'aria/Name', 'reuses the last interacted target (keyDown carries no selectors of its own)');
  // "Tab" is outside Cypress's .type() whitelist — must be warned about BY
  // NAME (the exact key + the exact adapter at risk), never silently
  // converted into code that throws at real Cypress runtime.
  assert.ok(
    warnings.some((w) => w.includes('key "Tab"') && w.includes('cypress-e2e')),
    'a Cypress-unrenderable key must be warned about by name, naming the adapter'
  );
});

test('importRecorderFlow: keyDown with a Cypress-whitelisted key (Enter) produces NO fidelity warning', () => {
  const flow = {
    title: 'Enter flow',
    steps: [
      { type: 'click', selectors: [['aria/Search']] },
      { type: 'keyDown', key: 'Enter' },
    ],
  };
  const { warnings } = importRecorderFlow(flow);
  assert.ok(
    !warnings.some((w) => w.includes('special-sequence')),
    'Enter is Cypress-typeable — no cross-adapter fidelity warning should fire'
  );
});

test('importRecorderFlow: keyDown with no known target is skipped with a warning, never silently dropped', () => {
  const flow = { title: 'Orphan keyDown', steps: [{ type: 'keyDown', key: 'Enter' }] };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps.length, 0);
  assert.ok(warnings.some((w) => w.includes('keyDown') && w.includes('no known target')));
});

// ---------------------------------------------------------------------------
// keyDown fidelity: a plain printable character must NOT be warned about
// (FINDING 2 — the inverse-facade fix) — only genuinely un-typeable
// multi-character key NAMES (Tab, F1, …) get the fidelity warning.
// ---------------------------------------------------------------------------

test('importRecorderFlow: keyDown with a plain printable character (e.g. "a") produces NO fidelity warning', () => {
  const flow = {
    title: 'Gmail-style shortcut',
    steps: [{ type: 'click', selectors: [['aria/Inbox']] }, { type: 'keyDown', key: 'a' }],
  };
  const { warnings } = importRecorderFlow(flow);
  assert.ok(
    !warnings.some((w) => w.includes('key "a"')),
    'a single printable character renders faithfully via cy.type("a") — no fidelity warning should fire'
  );
});

test('importRecorderFlow: keyDown with "Tab" (genuinely un-typeable key NAME) still produces the fidelity warning', () => {
  const flow = {
    title: 'Tab flow',
    steps: [{ type: 'click', selectors: [['aria/Name']] }, { type: 'keyDown', key: 'Tab' }],
  };
  const { warnings } = importRecorderFlow(flow);
  assert.ok(
    warnings.some((w) => w.includes('key "Tab"') && w.includes('cypress-e2e')),
    'a multi-character key NAME outside the whitelist must still be warned about by name'
  );
});

// ---------------------------------------------------------------------------
// orphan keyUp — FINDING 1
// ---------------------------------------------------------------------------

test('importRecorderFlow: an orphan keyUp (no matching prior keyDown) emits a named warning, not a silent drop', () => {
  // No keyDown anywhere in this flow — a trimmed/hand-edited export, or a
  // chord's second-key release recorded on its own.
  const flow = {
    title: 'Orphan keyUp',
    steps: [{ type: 'click', selectors: [['aria/Name']] }, { type: 'keyUp', key: 'Shift' }],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps.length, 1, 'keyUp itself never produces a TestStep — only the warning is new');
  assert.ok(
    warnings.some((w) => w.includes('keyUp step at index 1') && w.includes('key=Shift') && w.includes('no matching earlier keyDown')),
    'an orphan keyUp must be warned about by index + key, never silently dropped'
  );
});

test('importRecorderFlow: a well-formed keyDown+keyUp pair stays silent (no spurious orphan warning)', () => {
  const flow = {
    title: 'Paired keyDown/keyUp',
    steps: [
      { type: 'click', selectors: [['aria/Search']] },
      { type: 'keyDown', key: 'Enter' },
      { type: 'keyUp', key: 'Enter' },
    ],
  };
  const { warnings } = importRecorderFlow(flow);
  assert.ok(
    !warnings.some((w) => w.includes('keyUp') && w.includes('no matching earlier keyDown')),
    'a keyUp matching an earlier CONVERTED keyDown for the same key is truly redundant — must stay silent'
  );
});

test('importRecorderFlow: a second, unmatched keyUp for the same key IS warned about (one keyDown credit consumed, not reusable)', () => {
  const flow = {
    title: 'Double keyUp',
    steps: [
      { type: 'click', selectors: [['aria/Search']] },
      { type: 'keyDown', key: 'Enter' },
      { type: 'keyUp', key: 'Enter' }, // consumes the one keyDown credit — silent
      { type: 'keyUp', key: 'Enter' }, // no credit left — orphaned
    ],
  };
  const { warnings } = importRecorderFlow(flow);
  const orphanWarnings = warnings.filter((w) => w.includes('keyUp') && w.includes('no matching earlier keyDown'));
  assert.equal(orphanWarnings.length, 1, 'only the SECOND keyUp for this key is orphaned');
  assert.ok(orphanWarnings[0]?.includes('index 3'));
});

test('cypress-e2e adapter: key-press for a whitelisted key renders the EXACT documented Cypress special-sequence syntax', async () => {
  const { CypressE2EAdapter } = await import('../../../adapters/cypress-e2e-adapter.js');
  const adapter = new CypressE2EAdapter();
  const scenario = {
    id: 'scn-keypress-enter',
    title: 'Enter keypress',
    description: 'press Enter',
    targetPath: '/search',
    steps: [{ action: 'key-press' as const, target: '#q', value: 'Enter', description: 'press Enter on #q' }],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { code } = adapter.render(scenario);
  // String-match against Cypress's OWN documented syntax — not just
  // "compiles"; this is the real, runtime-correct call.
  assert.match(code, /cy\.get\("#q"\)\.type\("\{enter\}"\);/);
});

test('cypress-e2e adapter: key-press for a NON-whitelisted key (Tab) renders a safe comment, never throwing code', async () => {
  const { CypressE2EAdapter } = await import('../../../adapters/cypress-e2e-adapter.js');
  const adapter = new CypressE2EAdapter();
  const scenario = {
    id: 'scn-keypress-tab',
    title: 'Tab keypress',
    description: 'press Tab',
    targetPath: '/form',
    steps: [{ action: 'key-press' as const, target: '#name', value: 'Tab', description: 'press Tab on #name' }],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { code } = adapter.render(scenario);
  // The one string that must NEVER appear: Cypress throws on this at real
  // runtime even though it would compile fine.
  assert.ok(!code.includes('.type("{tab}")'), 'must NEVER emit cy.type("{tab}") — Cypress throws on this at runtime');
  assert.match(code, /\/\/ key-press: "Tab" is outside Cypress's \.type\(\) special-sequence whitelist/);
});

// FINDING 2 — a single printable character (letters/digits/punctuation/
// space) renders FAITHFULLY via unbraced cy.get(t).type(char), never a
// broken {token} nor the safe-comment fallback.
for (const key of ['a', '1', '?', ' ']) {
  test(`cypress-e2e adapter: key-press for the single printable character "${key}" renders unbraced cy.type(), no comment`, async () => {
    const { CypressE2EAdapter } = await import('../../../adapters/cypress-e2e-adapter.js');
    const adapter = new CypressE2EAdapter();
    const scenario = {
      id: 'scn-keypress-char',
      title: 'Printable char keypress',
      description: `press ${key}`,
      targetPath: '/inbox',
      steps: [{ action: 'key-press' as const, target: '#body', value: key, description: `press ${key} on #body` }],
      tags: [],
      recommendations: [],
      sourceGapIds: [],
    };
    const { code } = adapter.render(scenario);
    // The EXACT generated step line — unbraced, faithful, no {token}, no comment.
    const expectedLine = `    cy.get("#body").type(${JSON.stringify(key)});`;
    assert.ok(code.includes(expectedLine), `expected exact line "${expectedLine}" in generated code:\n${code}`);
    assert.ok(!code.includes('key-press:'), 'must NOT fall back to the placeholder comment for a faithfully-renderable character');
    assert.ok(!code.includes('.type("{'), 'must NOT emit a {token}-style special-sequence call for a plain printable character');
  });
}

test('playwright adapter: key-press renders page.locator(t).press(key) faithfully for ANY key, including ones Cypress cannot render', async () => {
  const { PlaywrightAdapter } = await import('../../../adapters/playwright-adapter.js');
  const adapter = new PlaywrightAdapter();
  const scenario = {
    id: 'scn-keypress-tab-pw',
    title: 'Tab keypress (Playwright)',
    description: 'press Tab',
    targetPath: '/form',
    steps: [
      { action: 'key-press' as const, target: '#name', value: 'Tab', description: 'press Tab on #name' },
      { action: 'key-press' as const, target: '#q', value: 'Enter', description: 'press Enter on #q' },
    ],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { code } = adapter.render(scenario);
  // Playwright faithfully renders BOTH — including "Tab", which Cypress
  // cannot express via .type(). This is the whole point of FINDING 1: the
  // shared NeutralScenario now carries a framework-neutral key, so
  // Playwright is never handed Cypress-only {key} syntax.
  assert.match(code, /await page\.locator\("#name"\)\.press\("Tab"\);/);
  assert.match(code, /await page\.locator\("#q"\)\.press\("Enter"\);/);
});

test('round-trip: a keyDown Tab flow scaffolds a valid (non-throwing-syntax) Cypress spec AND a faithful Playwright spec', async () => {
  const flow = {
    title: 'Tab through a form',
    steps: [
      { type: 'navigate', url: 'https://app.example.test/form' },
      { type: 'click', selectors: [['aria/Name']] },
      { type: 'keyDown', key: 'Tab' },
    ],
  };
  const { scenario } = importRecorderFlow(flow);

  const cypressResult = await scaffoldTests('https://app.example.test', {
    framework: 'cypress-e2e',
    scenarios: [scenario],
  });
  const cySpec = cypressResult.generatedTests[0]!;
  assert.ok(!cySpec.code.includes('.type("{tab}")'), 'the scaffolded Cypress spec must never contain the throwing {tab} call');
  assert.equal(cypressResult.specValidation.ok, true, JSON.stringify(cypressResult.specValidation));

  const pwResult = await scaffoldTests('https://app.example.test', {
    framework: 'playwright',
    scenarios: [scenario],
  });
  const pwSpec = pwResult.generatedTests[0]!;
  assert.match(pwSpec.code, /\.press\("Tab"\);/, 'Playwright renders the SAME scenario faithfully via .press("Tab")');
  assert.equal(pwResult.specValidation.ok, true, JSON.stringify(pwResult.specValidation));
});

// ---------------------------------------------------------------------------
// assertedEvents: non-navigation types must warn, never silently no-op — FINDING 3
// ---------------------------------------------------------------------------

test('importRecorderFlow: an assertedEvents entry whose type is not "navigation" warns by name, never silently drops', () => {
  const flow = {
    title: 'Non-navigation assertedEvents',
    steps: [
      {
        type: 'click',
        selectors: [['aria/Save']],
        assertedEvents: [{ type: 'resourceLoad', url: 'https://app.example.test/api/save' }],
      },
    ],
  };
  const { warnings } = importRecorderFlow(flow);
  assert.ok(
    warnings.some((w) => w.includes('assertedEvents type "resourceLoad"') && w.includes('no NeutralScenario equivalent')),
    'a non-navigation assertedEvents type must be named in a warning, never a silent no-op'
  );
});

test('importRecorderFlow: assertedEvents navigation WITH a url still produces an assert-visible step (no regression)', () => {
  const flow = {
    title: 'Navigation assertedEvents',
    steps: [
      {
        type: 'click',
        selectors: [['aria/Save']],
        assertedEvents: [{ type: 'navigation', url: 'https://app.example.test/saved' }],
      },
    ],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.ok(scenario.steps.some((s) => s.action === 'assert-visible' && s.description.includes('https://app.example.test/saved')));
  assert.ok(!warnings.some((w) => w.includes('assertedEvents type')), 'a well-formed navigation event needs no warning');
});

// ---------------------------------------------------------------------------
// setViewport: informational, but never a SILENT no-op
// ---------------------------------------------------------------------------

test('importRecorderFlow: setViewport is warned about (dimensions are not threaded into project config), never a silent no-op', () => {
  const flow = {
    title: 'Viewport flow',
    steps: [
      { type: 'setViewport', width: 1512, height: 823, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false },
      { type: 'navigate', url: 'https://app.example.test/' },
    ],
  };
  const { scenario, warnings } = importRecorderFlow(flow);
  assert.equal(scenario.steps.length, 1, 'setViewport contributes no TestStep — it is metadata, not a user action');
  assert.ok(warnings.some((w) => w.includes('setViewport step at index 0 is informational only')));
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
