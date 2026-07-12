import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { PlaywrightAdapter } from '../playwright-adapter.js';
import type { NeutralScenario } from '../../schemas/gap-analysis.schema.js';

const adapter = new PlaywrightAdapter();

/**
 * Transpile the generated spec as a standalone module and fail if the
 * TypeScript parser reports any syntactic error. `transpileModule` does
 * single-file syntax transformation only (no type-checking, no module
 * resolution), so a clean run means the string is a syntactically valid spec.
 */
function assertValidPlaywrightSpec(code: string): void {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  const messages = errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  assert.equal(
    errors.length,
    0,
    `generated spec has syntax errors:\n${messages.join('\n')}\n--- spec ---\n${code}`
  );
  assert.ok(result.outputText.length > 0, 'transpile produced no output');
}

const loginScenario: NeutralScenario = {
  id: 'scn-login-001',
  title: 'User Login Flow',
  description: 'User can submit the login form and reach the dashboard',
  targetPath: '/login',
  steps: [
    { action: 'navigate', target: '/login', description: 'go to the login page' },
    { action: 'type', target: '#email', value: 'user@example.com', description: 'enter email' },
    { action: 'type', target: '#password', value: 'hunter2', description: 'enter password' },
    { action: 'click', target: '#login-submit', description: 'submit the form' },
    { action: 'assert-visible', target: '.welcome-banner', description: 'welcome banner shows' },
    { action: 'assert-text', target: 'h1', value: 'Dashboard', description: 'heading reads Dashboard' },
    { action: 'assert-disabled', target: '#resend', description: 'resend button disabled' },
    { action: 'assert-hidden', target: '.error-toast', description: 'no error toast' },
    { action: 'assert-count', target: '.nav-item', value: '4', description: 'four nav items' },
    { action: 'wait', value: '500', description: 'let the page settle' },
    { action: 'api-call', target: '/api/session', description: 'session endpoint is healthy' },
  ],
  tags: ['auth', 'smoke'],
  recommendations: [],
  sourceGapIds: ['gap-1'],
};

test('render: GeneratedTest metadata identifies the playwright template', () => {
  const r = adapter.render(loginScenario);
  assert.equal(r.adapter, 'playwright');
  assert.equal(r.source, 'template');
  assert.equal(r.scenarioId, 'scn-login-001');
  assert.equal(r.filename, 'user-login-flow.spec.ts');
  assert.equal(r.outputPath, 'tests/user-login-flow.spec.ts');
});

test('render: wraps steps in a Playwright test.describe / test scaffold', () => {
  const { code } = adapter.render(loginScenario);
  assert.ok(
    code.includes(`import { test, expect } from '@playwright/test';`),
    'must import test + expect from @playwright/test'
  );
  assert.ok(
    code.includes('test.describe("User Login Flow", () => {'),
    'must open a describe block titled after the scenario'
  );
  assert.ok(
    code.includes('test("User can submit the login form and reach the dashboard", async ({ page }) => {'),
    'must open a test using the page fixture'
  );
  assert.ok(code.includes('// qulib-generated — scenario: scn-login-001'), 'must stamp the scenario id');
});

test('render: every step targets the real scenario routes and selectors', () => {
  const { code } = adapter.render(loginScenario);
  const expected = [
    'await page.goto("/login");',
    'await page.locator("#email").fill("user@example.com");',
    'await page.locator("#password").fill("hunter2");',
    'await page.locator("#login-submit").click();',
    'await expect(page.locator(".welcome-banner")).toBeVisible();',
    'await expect(page.locator("h1")).toContainText("Dashboard");',
    'await expect(page.locator("#resend")).toBeDisabled();',
    'await expect(page.locator(".error-toast")).toBeHidden();',
    'expect(await page.locator(".nav-item").count()).toBeGreaterThanOrEqual(4);',
    'await page.waitForTimeout(500);',
    'expect((await page.request.get("/api/session")).status()).toBe(200);',
  ];
  for (const line of expected) {
    assert.ok(code.includes(line), `expected generated spec to contain: ${line}\n--- spec ---\n${code}`);
  }
});

test('render: the generated spec is a syntactically valid Playwright spec', () => {
  const { code } = adapter.render(loginScenario);
  assertValidPlaywrightSpec(code);
});

test('render: selectors with embedded quotes are escaped, not broken', () => {
  const scenario: NeutralScenario = {
    id: 'scn-search-001',
    title: 'Search Box',
    description: 'typing into the search input works',
    targetPath: '/',
    steps: [
      { action: 'click', target: 'input[name="q"]', description: 'focus the search input' },
      { action: 'type', target: 'input[name="q"]', value: 'qulib', description: 'type a query' },
    ],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { code } = adapter.render(scenario);
  assert.ok(code.includes(`await page.locator(${JSON.stringify('input[name="q"]')}).click();`));
  assert.ok(
    code.includes(`await page.locator(${JSON.stringify('input[name="q"]')}).fill(${JSON.stringify('qulib')});`)
  );
  assertValidPlaywrightSpec(code);
});

test('render: steps missing a target fall back to safe defaults / comments', () => {
  const scenario: NeutralScenario = {
    id: 'scn-degenerate-001',
    title: 'Degenerate Steps',
    description: 'steps without targets degrade gracefully',
    targetPath: '/x',
    steps: [
      { action: 'assert-visible', description: 'something is visible' },
      { action: 'click', description: 'click something undescribed' },
      { action: 'assert-text', description: 'some text exists' },
    ],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { code } = adapter.render(scenario);
  assert.ok(
    code.includes(`await expect(page.locator('body')).toBeVisible();`),
    'target-less assert-visible falls back to body'
  );
  assert.ok(code.includes('// click: click something undescribed'), 'target-less click becomes a comment');
  assert.ok(code.includes('// assert-text: some text exists'), 'target-less assert-text becomes a comment');
  assertValidPlaywrightSpec(code);
});

test('render: a scenario with no steps still yields a valid spec with a placeholder', () => {
  const scenario: NeutralScenario = {
    id: 'scn-empty-001',
    title: 'Empty Scenario',
    description: 'no steps yet',
    targetPath: '/pending',
    steps: [],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { code } = adapter.render(scenario);
  assert.ok(code.includes('// no steps — add assertions for: /pending'));
  assertValidPlaywrightSpec(code);
});

test('renderAll: maps each scenario to its own valid playwright GeneratedTest', () => {
  const second: NeutralScenario = {
    id: 'scn-logout-002',
    title: 'User Logout',
    description: 'user can log out',
    targetPath: '/logout',
    steps: [{ action: 'navigate', target: '/logout', description: 'open logout' }],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const results = adapter.renderAll([loginScenario, second]);
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.filename),
    ['user-login-flow.spec.ts', 'user-logout.spec.ts']
  );
  for (const r of results) {
    assert.equal(r.adapter, 'playwright');
    assert.equal(r.source, 'template');
    assert.ok(r.outputPath.startsWith('tests/'));
    assertValidPlaywrightSpec(r.code);
  }
});

test('adapterType exposes the playwright identifier', () => {
  assert.equal(adapter.adapterType, 'playwright');
});

// ---------------------------------------------------------------------------
// select action — FINDING 2 (additive TestStep action)
// ---------------------------------------------------------------------------

test("render: 'select' TestStep action renders page.locator(t).selectOption(v)", () => {
  const scenario: NeutralScenario = {
    id: 'scn-select-001',
    title: 'Country picker',
    description: 'User picks a country from a real <select>',
    targetPath: '/settings',
    steps: [
      { action: 'navigate', target: '/settings', description: 'go to settings' },
      { action: 'select', target: '#country', value: 'Canada', description: 'pick Canada' },
    ],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { code } = adapter.render(scenario);
  assert.match(code, /await page\.locator\("#country"\)\.selectOption\("Canada"\);/);
  assertValidPlaywrightSpec(code);
});
