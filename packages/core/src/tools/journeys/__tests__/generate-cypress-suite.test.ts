/**
 * Journey → Cypress suite generator tests.
 *
 * Golden fixture: datasets/golden/journeys/smoke-login.json → expected/smoke-login.cy.ts
 * Also covers determinism (two runs byte-identical) and TypeScript-check of emitted specs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  annotateDescribeTitle,
  generateCypressSpecFromJourney,
  generateCypressSuite,
  generateCypressSuiteFromDir,
  regressionAnnotationsFromTags,
} from '../generate-cypress-suite.js';
import { validateSpecCode } from '../../../adapters/validate-specs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/core/src/tools/journeys/__tests__ → repo root (6 levels up)
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..');
const GOLDEN_JOURNEY = resolve(REPO_ROOT, 'datasets/golden/journeys/smoke-login.json');
const GOLDEN_EXPECTED = resolve(REPO_ROOT, 'datasets/golden/journeys/expected/smoke-login.cy.ts');

function assertValidTs(code: string): void {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(
    errors.length,
    0,
    `spec failed TypeScript check:\n${errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}\n---\n${code}`
  );
  assert.equal(validateSpecCode(code).valid, true, 'validateSpecCode must also pass');
}

test('regressionAnnotationsFromTags: smoke before regression, ignores recorder-import', () => {
  assert.deepEqual(regressionAnnotationsFromTags(['recorder-import', 'regression', 'smoke', '@Smoke']), [
    'smoke',
    'regression',
  ]);
  assert.deepEqual(regressionAnnotationsFromTags(['auth', 'e2e']), []);
});

test('annotateDescribeTitle: appends missing @tags only', () => {
  assert.equal(annotateDescribeTitle('Login', ['smoke']), 'Login @smoke');
  assert.equal(annotateDescribeTitle('Login @smoke', ['smoke', 'regression']), 'Login @smoke @regression');
  assert.equal(annotateDescribeTitle('Login @smoke @regression', ['smoke', 'regression']), 'Login @smoke @regression');
});

test('golden fixture: smoke-login.json generates the expected Cypress spec snapshot', () => {
  const raw = JSON.parse(readFileSync(GOLDEN_JOURNEY, 'utf8'));
  const expected = readFileSync(GOLDEN_EXPECTED, 'utf8');
  const spec = generateCypressSpecFromJourney(raw, 'smoke-login.json');

  assert.equal(spec.journeyId, 'recorder-smoke-login-flow');
  assert.equal(spec.filename, 'smoke-login-flow.cy.ts');
  assert.equal(spec.code, expected, 'generated spec must match golden expected/smoke-login.cy.ts byte-for-byte');
  assert.match(spec.code, /describe\("Smoke login flow @smoke @regression"/);
  assert.match(spec.code, /cy\.get\("aria\/Email"\)\.type\("reader@example\.test"\)/);
  assertValidTs(spec.code);
});

test('determinism: two generator runs on identical input are byte-identical', () => {
  const raw = JSON.parse(readFileSync(GOLDEN_JOURNEY, 'utf8'));
  const a = generateCypressSpecFromJourney(raw);
  const b = generateCypressSpecFromJourney(raw);
  assert.equal(a.code, b.code);
  assert.equal(a.filename, b.filename);
  assert.equal(a.journeyId, b.journeyId);

  const suiteA = generateCypressSuite([{ source: 'z.json', raw }, { source: 'a.json', raw }]);
  const suiteB = generateCypressSuite([{ source: 'z.json', raw }, { source: 'a.json', raw }]);
  assert.equal(suiteA.specs.length, 2);
  assert.deepEqual(
    suiteA.specs.map((s) => s.code),
    suiteB.specs.map((s) => s.code)
  );
  // Stable ordering by source filename (a.json before z.json).
  assert.equal(suiteA.specs[0]?.filename, 'smoke-login-flow.cy.ts');
  assert.equal(suiteA.specs[1]?.filename, 'smoke-login-flow-2.cy.ts');
});

test('generateCypressSuiteFromDir: writes specs and is byte-identical on re-run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-gen-cy-'));
  const inDir = join(dir, 'in');
  const out1 = join(dir, 'out1');
  const out2 = join(dir, 'out2');
  try {
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, 'smoke-login.json'), readFileSync(GOLDEN_JOURNEY));
    const r1 = await generateCypressSuiteFromDir(inDir, out1);
    const r2 = await generateCypressSuiteFromDir(inDir, out2);
    assert.equal(r1.specs.length, 1);
    assert.equal(r2.specs.length, 1);
    const file1 = readFileSync(join(out1, 'smoke-login-flow.cy.ts'), 'utf8');
    const file2 = readFileSync(join(out2, 'smoke-login-flow.cy.ts'), 'utf8');
    assert.equal(file1, file2);
    assert.equal(file1, readFileSync(GOLDEN_EXPECTED, 'utf8'));
    assert.deepEqual(readdirSync(out1).sort(), readdirSync(out2).sort());
    assertValidTs(file1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateCypressSpecFromJourney: rejects a zero-step / all-unmappable flow', () => {
  assert.throws(
    () =>
      generateCypressSpecFromJourney({
        title: 'Empty',
        steps: [{ type: 'hover', selectors: [['#x']] }],
      }),
    /unmappable|empty Cypress spec/i
  );
});
