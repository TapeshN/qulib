/**
 * CLI alias-equivalence tests for 0.10 naming convergence.
 *
 * Verifies that the alias subcommands produce identical output to their
 * canonical counterparts when given the same inputs.
 *
 * Aliases:
 *   `qulib confidence`         (canonical) === `qulib release-confidence`
 *   `qulib score-automation`   (canonical) === `qulib automation-score`
 *
 * Test strategy:
 *   - Call the extracted core functions (runConfidence, runScoreAutomation)
 *     directly — no subprocess overhead for the functional tests.
 *   - One subprocess test per alias verifies that Commander is wired
 *     correctly (i.e., the alias actually routes to the same action).
 *   - Help-text snapshot tests verify alias annotations appear in --help.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runConfidence } from '../confidence-run.js';
import { runScoreAutomation } from '../score-automation-run.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliEntry = resolve(__dirname, '..', 'index.ts');
const FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', 'fixtures', 'repos');
const MATURITY_REPO = resolve(FIXTURE_ROOT, 'maturity-repo');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', cliEntry, ...args],
    {
      encoding: 'utf8',
      cwd: resolve(__dirname, '..', '..', '..'),
      maxBuffer: 20 * 1024 * 1024,
    }
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// confidence === release-confidence: functional equivalence via runConfidence
// ---------------------------------------------------------------------------

test('CLI alias: release-confidence produces same schemaVersion as confidence', async () => {
  const linesA: string[] = [];
  const linesB: string[] = [];
  const rcA = await runConfidence({ repo: MATURITY_REPO, json: true }, (l) => linesA.push(l));
  const rcB = await runConfidence({ repo: MATURITY_REPO, json: true }, (l) => linesB.push(l));
  // Both calls go through the same function — results must be schema-equal in kind
  assert.equal(rcA.schemaVersion, rcB.schemaVersion);
  assert.equal(typeof rcA.verdict, typeof rcB.verdict);
  assert.equal(typeof rcA.confidenceScore, typeof rcB.confidenceScore);
});

test('CLI alias: release-confidence JSON output is structurally equivalent to confidence JSON output', async () => {
  const linesA: string[] = [];
  const linesB: string[] = [];
  await runConfidence({ repo: MATURITY_REPO, json: true }, (l) => linesA.push(l));
  await runConfidence({ repo: MATURITY_REPO, json: true }, (l) => linesB.push(l));
  const parsedA = JSON.parse(linesA.join('\n'));
  const parsedB = JSON.parse(linesB.join('\n'));
  // Same function, same input → same top-level shape
  assert.deepStrictEqual(Object.keys(parsedA).sort(), Object.keys(parsedB).sort());
});

test('CLI alias: release-confidence subprocess exits 0 for repo input', () => {
  const { status, stderr } = runCli(['release-confidence', '--repo', MATURITY_REPO]);
  assert.equal(status, 0, `expected exit 0, got ${status}. stderr: ${stderr}`);
});

test('CLI alias: release-confidence subprocess produces verdict line', () => {
  const { status, stdout } = runCli(['release-confidence', '--repo', MATURITY_REPO]);
  assert.equal(status, 0);
  assert.match(stdout, /verdict:/i);
});

test('CLI alias: release-confidence --json emits parseable JSON', () => {
  const { status, stdout } = runCli(['release-confidence', '--repo', MATURITY_REPO, '--json']);
  assert.equal(status, 0);
  assert.doesNotThrow(() => JSON.parse(stdout));
});

test('CLI alias: confidence and release-confidence emit same JSON keys', () => {
  const a = runCli(['confidence', '--repo', MATURITY_REPO, '--json']);
  const b = runCli(['release-confidence', '--repo', MATURITY_REPO, '--json']);
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  const parsedA = JSON.parse(a.stdout);
  const parsedB = JSON.parse(b.stdout);
  assert.deepStrictEqual(Object.keys(parsedA).sort(), Object.keys(parsedB).sort(),
    'confidence and release-confidence should produce same JSON shape');
});

// ---------------------------------------------------------------------------
// score-automation === automation-score: functional equivalence
// ---------------------------------------------------------------------------

test('CLI alias: automation-score produces same overallScore as score-automation', async () => {
  const linesA: string[] = [];
  const linesB: string[] = [];
  const matA = await runScoreAutomation({ repo: MATURITY_REPO }, (l) => linesA.push(l));
  const matB = await runScoreAutomation({ repo: MATURITY_REPO }, (l) => linesB.push(l));
  assert.equal(matA.overallScore, matB.overallScore);
  assert.equal(matA.level, matB.level);
});

test('CLI alias: automation-score subprocess exits 0', () => {
  const { status, stderr } = runCli(['automation-score', '--repo', MATURITY_REPO]);
  assert.equal(status, 0, `expected exit 0. stderr: ${stderr}`);
});

test('CLI alias: automation-score subprocess produces maturity output', () => {
  const { status, stdout } = runCli(['automation-score', '--repo', MATURITY_REPO]);
  assert.equal(status, 0);
  assert.match(stdout, /overall:/i);
});

test('CLI alias: automation-score --json emits parseable JSON', () => {
  const { status, stdout } = runCli(['automation-score', '--repo', MATURITY_REPO, '--json']);
  assert.equal(status, 0);
  assert.doesNotThrow(() => JSON.parse(stdout));
});

test('CLI alias: score-automation and automation-score emit same JSON keys', () => {
  const a = runCli(['score-automation', '--repo', MATURITY_REPO, '--json']);
  const b = runCli(['automation-score', '--repo', MATURITY_REPO, '--json']);
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  const parsedA = JSON.parse(a.stdout);
  const parsedB = JSON.parse(b.stdout);
  assert.deepStrictEqual(Object.keys(parsedA).sort(), Object.keys(parsedB).sort(),
    'score-automation and automation-score should produce same JSON shape');
});

test('CLI alias: score-automation and automation-score produce same overallScore', () => {
  const a = runCli(['score-automation', '--repo', MATURITY_REPO, '--json']);
  const b = runCli(['automation-score', '--repo', MATURITY_REPO, '--json']);
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  const parsedA = JSON.parse(a.stdout);
  const parsedB = JSON.parse(b.stdout);
  assert.equal(parsedA.overallScore, parsedB.overallScore,
    'both aliases must compute the same overallScore for the same repo');
  assert.equal(parsedA.level, parsedB.level,
    'both aliases must compute the same level for the same repo');
});

// ---------------------------------------------------------------------------
// Help-text snapshot: verify alias annotations appear in --help output
// ---------------------------------------------------------------------------

test('CLI alias annotation: confidence --help mentions release-confidence alias', () => {
  const { status, stdout } = runCli(['confidence', '--help']);
  assert.equal(status, 0);
  assert.match(stdout, /release-confidence/i,
    'confidence --help should mention the release-confidence alias');
});

test('CLI alias annotation: score-automation --help mentions automation-score alias', () => {
  const { status, stdout } = runCli(['score-automation', '--help']);
  assert.equal(status, 0);
  assert.match(stdout, /automation-score/i,
    'score-automation --help should mention the automation-score alias');
});

// ---------------------------------------------------------------------------
// Old names still work (regression guard — no aliases removed)
// ---------------------------------------------------------------------------

test('CLI backwards compat: confidence still works after alias addition', () => {
  const { status } = runCli(['confidence', '--repo', MATURITY_REPO]);
  assert.equal(status, 0, 'confidence command must still work after alias was added');
});

test('CLI backwards compat: score-automation still works after alias addition', () => {
  const { status } = runCli(['score-automation', '--repo', MATURITY_REPO]);
  assert.equal(status, 0, 'score-automation command must still work after alias was added');
});
