/**
 * Cypress E2E adapter tests (node:test, real assertions).
 *
 * Coverage:
 *   - every TestStep action renders the expected cy.* call, including the
 *     new 'select' action (FINDING 2 — cy.get(t).select(v))
 *   - a scenario using 'select' produces a syntactically valid Cypress spec
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { CypressE2EAdapter } from '../cypress-e2e-adapter.js';
import type { NeutralScenario } from '../../schemas/gap-analysis.schema.js';

const adapter = new CypressE2EAdapter();

function assertValidCypressSpec(code: string): void {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  const messages = errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  assert.equal(errors.length, 0, `generated spec has syntax errors:\n${messages.join('\n')}\n--- spec ---\n${code}`);
}

const selectScenario: NeutralScenario = {
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

test("render: 'select' TestStep action renders cy.get(t).select(v)", () => {
  const { code } = adapter.render(selectScenario);
  assert.match(code, /cy\.get\("#country"\)\.select\("Canada"\);/);
  assertValidCypressSpec(code);
});

test("render: a target-less 'select' step falls back to a comment", () => {
  const scenario: NeutralScenario = {
    id: 'scn-select-002',
    title: 'Degenerate select',
    description: 'select step missing target/value',
    targetPath: '/x',
    steps: [{ action: 'select', description: 'pick something undescribed' }],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { code } = adapter.render(scenario);
  assert.ok(code.includes('// select: pick something undescribed'));
  assertValidCypressSpec(code);
});

test('render: navigate/type/assert-count still render as before (no regression from adding select)', () => {
  const scenario: NeutralScenario = {
    id: 'scn-baseline-001',
    title: 'Baseline actions',
    description: 'core actions unaffected by the select addition',
    targetPath: '/login',
    steps: [
      { action: 'navigate', target: '/login', description: 'go' },
      { action: 'type', target: '#email', value: 'user@example.com', description: 'type email' },
      { action: 'assert-count', target: '.nav-item', value: '4', description: 'four nav items' },
    ],
    tags: [],
    recommendations: [],
    sourceGapIds: [],
  };
  const { code } = adapter.render(scenario);
  assert.match(code, /cy\.visit\("\/login"\);/);
  assert.match(code, /cy\.get\("#email"\)\.type\("user@example\.com"\);/);
  assert.match(code, /cy\.get\("\.nav-item"\)\.should\('have\.length\.gte', 4\);/);
  assertValidCypressSpec(code);
});
