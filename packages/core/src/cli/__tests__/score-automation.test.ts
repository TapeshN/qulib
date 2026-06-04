import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AutomationMaturity } from '../../schemas/automation-maturity.schema.js';
import { AutomationMaturitySchema } from '../../schemas/automation-maturity.schema.js';
import {
  formatHumanReport,
  resolveRepoPath,
  runScoreAutomation,
} from '../score-automation-run.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliEntry = resolve(__dirname, '..', 'index.ts');
// Repo fixtures live under packages/core/fixtures/repos/ (NOT under src/) so the
// fixture .ts/.tsx files — which are scanned as text, never compiled — stay outside
// tsc's `include: ["src/**/*"]` and don't break the build. Mirrors the existing
// packages/core/fixtures/ web-fixture convention.
const FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', 'fixtures', 'repos');
const MATURITY_REPO = resolve(FIXTURE_ROOT, 'maturity-repo');
const BARE_REPO = resolve(FIXTURE_ROOT, 'bare-repo');

/** Capture the lines runScoreAutomation emits via its injected sink. */
async function score(opts: { repo: string; json?: boolean }): Promise<{
  maturity: AutomationMaturity;
  out: string;
}> {
  const lines: string[] = [];
  const maturity = await runScoreAutomation(opts, (line) => lines.push(line));
  return { maturity, out: lines.join('\n') };
}

// --- resolveRepoPath: fail-fast guard rails -------------------------------------

test('resolveRepoPath throws when --repo is missing', () => {
  assert.throws(() => resolveRepoPath(undefined), /requires --repo/);
  assert.throws(() => resolveRepoPath('   '), /requires --repo/);
});

test('resolveRepoPath throws when --repo does not exist', () => {
  assert.throws(
    () => resolveRepoPath(resolve(FIXTURE_ROOT, 'does-not-exist-xyz')),
    /does not exist/
  );
});

test('resolveRepoPath throws when --repo is a file, not a directory', () => {
  assert.throws(() => resolveRepoPath(__filename), /not a directory/);
});

test('resolveRepoPath resolves a real directory to an absolute path', () => {
  const abs = resolveRepoPath(MATURITY_REPO);
  assert.equal(abs, MATURITY_REPO);
});

// --- known-fixture maturity numbers (the load-bearing assertions) ---------------
// The maturity-repo fixture is hand-built so every dimension is applicable with a
// known score: breadth=100, framework=100, test-id-hygiene=100, ci=100, auth=90,
// component-ratio=50 → overall 95 (L5). If the scorer or scanner regress, these break.

test('score-automation reports the known overall score + level for the rich fixture', async () => {
  const { maturity } = await score({ repo: MATURITY_REPO });
  assert.equal(maturity.overallScore, 95);
  assert.equal(maturity.level, 5);
  assert.match(maturity.label, /L5/);
  // Result must satisfy the published schema (it is parsed inside the scorer, but
  // assert here too so the CLI's returned object is contract-stable).
  AutomationMaturitySchema.parse(maturity);
});

test('every dimension of the rich fixture is applicable with its known score', async () => {
  const { maturity } = await score({ repo: MATURITY_REPO });
  const byDim = new Map(maturity.dimensions.map((d) => [d.dimension, d]));

  const expected: Record<string, number> = {
    'test-coverage-breadth': 100,
    'framework-adoption': 100,
    'test-id-hygiene': 100,
    'ci-integration': 100,
    'auth-test-coverage': 90,
    'component-test-ratio': 50,
  };
  for (const [dim, want] of Object.entries(expected)) {
    const d = byDim.get(dim as never);
    assert.ok(d, `dimension ${dim} present`);
    assert.equal(d!.applicability ?? 'applicable', 'applicable', `${dim} applicable`);
    assert.equal(d!.score, want, `${dim} score`);
  }
});

test('human report shows overall, level, and an applicable dimension as N/100', async () => {
  const { out } = await score({ repo: MATURITY_REPO });
  assert.match(out, /overall: 95\/100/);
  assert.match(out, /L5 — advanced QA automation \(level 5\)/);
  // An applicable dimension renders its real score as N/100.
  assert.match(out, /auth-test-coverage \[w=10%\]: 90\/100/);
  assert.match(out, /test-coverage-breadth \[w=28%\]: 100\/100/);
  // Recommendations header is present (component-test-ratio < target yields one).
  assert.match(out, /top recommendations:/);
});

// --- honesty: unknown / not_applicable must NOT read as "0/100" -----------------
// The bare-repo fixture is empty, producing test-id-hygiene=unknown and both
// auth-test-coverage + component-test-ratio = not_applicable. These must surface as
// honest uncertainty, while genuinely-applicable zeros (framework, ci) show 0/100.

test('not_applicable and unknown dimensions render honestly, never as a bare 0/100', async () => {
  const { maturity, out } = await score({ repo: BARE_REPO });

  const hygiene = maturity.dimensions.find((d) => d.dimension === 'test-id-hygiene')!;
  const auth = maturity.dimensions.find((d) => d.dimension === 'auth-test-coverage')!;
  const comp = maturity.dimensions.find((d) => d.dimension === 'component-test-ratio')!;
  assert.equal(hygiene.applicability, 'unknown');
  assert.equal(auth.applicability, 'not_applicable');
  assert.equal(comp.applicability, 'not_applicable');

  // The unknown/not-applicable lines must say so and be excluded from overall,
  // and must NOT print "test-id-hygiene ...: 0/100" (the dishonest rendering).
  assert.match(out, /test-id-hygiene \[w=18%\]: unknown \(excluded from overall\)/);
  assert.match(out, /auth-test-coverage \[w=10%\]: n\/a \(excluded from overall\)/);
  assert.match(out, /component-test-ratio \[w=8%\]: n\/a \(excluded from overall\)/);
  assert.doesNotMatch(out, /test-id-hygiene \[w=18%\]: 0\/100/);
  assert.doesNotMatch(out, /auth-test-coverage \[w=10%\]: 0\/100/);

  // A genuinely-applicable zero is still honest as 0/100 (framework, ci have no signal).
  assert.match(out, /framework-adoption \[w=22%\]: 0\/100/);
  assert.match(out, /ci-integration \[w=14%\]: 0\/100/);
});

test('bare repo overall normalizes over applicable dimensions only (not dragged to 0)', async () => {
  const { maturity } = await score({ repo: BARE_REPO });
  // Applicable dims: breadth(100,.28) + framework(0,.22) + ci(0,.14) → 28/0.64 ≈ 44.
  // If N/A dims were counted at 0 the score would be far lower; assert the honest 44.
  assert.equal(maturity.overallScore, 44);
});

// --- formatHumanReport is a pure function over a maturity object ----------------

test('formatHumanReport surfaces every dimension and the repo path', async () => {
  const { maturity } = await score({ repo: MATURITY_REPO });
  const report = formatHumanReport(maturity);
  assert.ok(report.startsWith('[qulib] Automation maturity for '));
  assert.match(report, new RegExp(MATURITY_REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const d of maturity.dimensions) {
    assert.match(report, new RegExp(`- ${d.dimension} `), `report mentions ${d.dimension}`);
  }
});

// --- --json mode emits a schema-valid AutomationMaturity ------------------------

test('--json mode emits a single schema-valid AutomationMaturity object', async () => {
  const { out } = await score({ repo: MATURITY_REPO, json: true });
  const parsed = JSON.parse(out);
  const maturity = AutomationMaturitySchema.parse(parsed);
  assert.equal(maturity.overallScore, 95);
  assert.equal(maturity.dimensions.length, 6);
  // JSON mode must carry the raw applicability so machine consumers see uncertainty.
  const hygiene = maturity.dimensions.find((d) => d.dimension === 'test-id-hygiene')!;
  assert.equal(hygiene.applicability, 'applicable'); // applicable in the rich fixture
});

// --- end-to-end through the registered CLI (spawn the real `qulib` entry) --------

test('qulib score-automation --repo <fixture> --json runs end-to-end and exits 0', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', cliEntry, 'score-automation', '--repo', MATURITY_REPO, '--json'],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `CLI exited ${result.status}, stderr: ${result.stderr}`);
  const maturity = AutomationMaturitySchema.parse(JSON.parse(result.stdout));
  assert.equal(maturity.overallScore, 95);
  assert.equal(maturity.level, 5);
});

test('qulib score-automation (human mode) prints the report end-to-end', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', cliEntry, 'score-automation', '--repo', MATURITY_REPO],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `CLI exited ${result.status}, stderr: ${result.stderr}`);
  assert.match(result.stdout, /overall: 95\/100/);
  assert.match(result.stdout, /auth-test-coverage \[w=10%\]: 90\/100/);
});

test('qulib score-automation fails clearly when --repo path is missing on disk', () => {
  const missing = resolve(FIXTURE_ROOT, 'definitely-not-here');
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', cliEntry, 'score-automation', '--repo', missing],
    { encoding: 'utf8' }
  );
  assert.notEqual(result.status, 0, 'CLI should exit non-zero for a missing repo path');
  assert.match(result.stderr, /does not exist/);
});

test('qulib score-automation errors when --repo is omitted (commander requiredOption)', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', cliEntry, 'score-automation'],
    { encoding: 'utf8' }
  );
  assert.notEqual(result.status, 0, 'CLI should exit non-zero when --repo is omitted');
  assert.match(result.stderr, /required option/i);
});
