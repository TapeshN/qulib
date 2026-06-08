import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSpecCode,
  validateGeneratedTest,
  validateGeneratedTests,
} from '../validate-specs.js';
import { CypressE2EAdapter } from '../cypress-e2e-adapter.js';
import { PlaywrightAdapter } from '../playwright-adapter.js';
import type { GeneratedTest } from '../../schemas/gap-analysis.schema.js';
import type { NeutralScenario } from '../../schemas/gap-analysis.schema.js';

const loginScenario: NeutralScenario = {
  id: 'scn-login-001',
  title: 'User Login Flow',
  description: 'User can submit the login form and reach the dashboard',
  targetPath: '/login',
  steps: [
    { action: 'navigate', target: '/login', description: 'go to the login page' },
    { action: 'type', target: '#email', value: 'user@example.com', description: 'enter email' },
    { action: 'click', target: '#login-submit', description: 'submit the form' },
    { action: 'assert-visible', target: '.welcome-banner', description: 'welcome banner shows' },
  ],
  tags: ['auth', 'smoke'],
  recommendations: [],
  sourceGapIds: ['gap-1'],
};

// ---------------------------------------------------------------------------
// DoD discrimination (rule 15): the validator must PASS a spec the adapter
// genuinely produces and REJECT a deliberately-broken one. The valid input is
// REAL adapter output (not a hand-authored happy string), so a validator that
// blindly returns `valid: true` would still pass this — but it would then also
// pass the malformed case below, which the test forbids. The two halves
// together force genuine discrimination.
// ---------------------------------------------------------------------------

test('REJECTS a malformed generated spec (unbalanced braces)', () => {
  // A real generator bug class: a dropped closing brace. This is valid-looking
  // string-shape (it still "contains" the expected lines) but will not parse.
  const broken = [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test.describe("Broken", () => {`,
    `  test("missing a brace", async ({ page }) => {`,
    `    await page.goto("/login");`,
    // <-- deliberately omit the two closing braces
  ].join('\n');

  const { valid, errors } = validateSpecCode(broken);
  assert.equal(valid, false, 'unbalanced-brace spec must be REJECTED');
  assert.ok(errors.length > 0, 'rejection must carry an actionable compiler error');
});

test('REJECTS a malformed generated spec (broken string literal)', () => {
  // A selector that broke out of its string — exactly what an unescaped quote
  // in a generated locator would produce.
  const broken = `await page.locator('input[name="q]).click();\n`;
  const { valid, errors } = validateSpecCode(broken);
  assert.equal(valid, false, 'unterminated-string spec must be REJECTED');
  assert.ok(errors.length > 0);
});

test('PASSES a valid spec that the Cypress adapter genuinely produces', () => {
  const generated: GeneratedTest = new CypressE2EAdapter().render(loginScenario);
  const result = validateGeneratedTest(generated);
  assert.equal(
    result.valid,
    true,
    `real Cypress adapter output must PASS, got errors:\n${result.errors.join('\n')}\n--- spec ---\n${generated.code}`
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.outputPath, generated.outputPath);
  assert.equal(result.scenarioId, 'scn-login-001');
});

test('PASSES a valid spec that the Playwright adapter genuinely produces', () => {
  const generated: GeneratedTest = new PlaywrightAdapter().render(loginScenario);
  const result = validateGeneratedTest(generated);
  assert.equal(
    result.valid,
    true,
    `real Playwright adapter output must PASS, got errors:\n${result.errors.join('\n')}\n--- spec ---\n${generated.code}`
  );
  assert.equal(result.errors.length, 0);
});

test('validateGeneratedTests: one bad spec in the batch flips ok=false and is the only invalid', () => {
  const good = new CypressE2EAdapter().render(loginScenario);
  const bad: GeneratedTest = {
    scenarioId: 'scn-broken-002',
    adapter: 'cypress-e2e',
    filename: 'broken.cy.ts',
    code: `describe("Broken", () => {\n  it("no close", () => {\n    cy.visit("/");\n`, // missing closing braces
    source: 'template',
    outputPath: 'cypress/e2e/broken.cy.ts',
  };

  const report = validateGeneratedTests([good, bad]);
  assert.equal(report.ok, false, 'a batch containing a broken spec must not be ok');
  assert.equal(report.total, 2);
  assert.equal(report.invalidCount, 1);

  const invalid = report.results.filter((r) => !r.valid);
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].scenarioId, 'scn-broken-002', 'the broken spec must be the one flagged');

  const valid = report.results.filter((r) => r.valid);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].scenarioId, 'scn-login-001', 'the real adapter spec must remain valid');
});

test('validateGeneratedTests: an all-valid batch reports ok=true', () => {
  const tests = new CypressE2EAdapter().renderAll([loginScenario]);
  const report = validateGeneratedTests(tests);
  assert.equal(report.ok, true);
  assert.equal(report.invalidCount, 0);
  assert.equal(report.total, tests.length);
});
