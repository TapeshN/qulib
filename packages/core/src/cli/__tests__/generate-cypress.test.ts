/**
 * CLI tests for `qulib generate-cypress` and `qulib journey-health`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGenerateCypress } from '../generate-cypress-run.js';
import { runJourneyHealth } from '../journey-health-run.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(__dirname, '..', 'index.ts');
// packages/core/src/cli/__tests__ → repo root (5 levels up)
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const GOLDEN_JOURNEY = resolve(REPO_ROOT, 'datasets/golden/journeys/smoke-login.json');
const GOLDEN_EXPECTED = resolve(REPO_ROOT, 'datasets/golden/journeys/expected/smoke-login.cy.ts');
const RESULTS_FIXTURE = resolve(
  REPO_ROOT,
  'datasets/golden/journeys/cypress-results/mixed-pass-fail.json'
);
const EXPECTED_HEALTH = resolve(
  REPO_ROOT,
  'datasets/golden/journeys/cypress-results/expected-health.json'
);

function runCli(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', cliEntry, ...args], {
    encoding: 'utf8',
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('runGenerateCypress: writes golden-matching spec to --out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-cli-gency-'));
  const inDir = join(dir, 'journeys');
  const outDir = join(dir, 'out');
  try {
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, 'smoke-login.json'), readFileSync(GOLDEN_JOURNEY));
    const lines: string[] = [];
    const result = await runGenerateCypress(
      { journeys: inDir, out: outDir },
      (l) => lines.push(l)
    );
    assert.equal(result.specs.length, 1);
    assert.equal(
      readFileSync(join(outDir, 'smoke-login-flow.cy.ts'), 'utf8'),
      readFileSync(GOLDEN_EXPECTED, 'utf8')
    );
    assert.match(lines.join('\n'), /specs written: 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI generate-cypress subprocess exits 0 and writes the spec', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-cli-gency-sub-'));
  const inDir = join(dir, 'journeys');
  const outDir = join(dir, 'out');
  // cwd must be the core package (where tsx resolves); pass absolute --journeys/--out.
  const corePkgRoot = resolve(__dirname, '..', '..', '..');
  try {
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, 'smoke-login.json'), readFileSync(GOLDEN_JOURNEY));
    const { status, stderr } = runCli(
      ['generate-cypress', '--journeys', inDir, '--out', outDir],
      corePkgRoot
    );
    assert.equal(status, 0, `expected exit 0, got ${status}. stderr: ${stderr}`);
    assert.ok(existsSync(join(outDir, 'smoke-login-flow.cy.ts')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runJourneyHealth: produces documented JSON shape from golden results fixture', async () => {
  const lines: string[] = [];
  const artifact = await runJourneyHealth({ results: RESULTS_FIXTURE }, (l) => lines.push(l));
  const expected = JSON.parse(readFileSync(EXPECTED_HEALTH, 'utf8'));
  assert.deepEqual(artifact, expected);
  assert.deepEqual(JSON.parse(lines.join('\n')), expected);
  assert.equal(typeof artifact.score, 'number');
  assert.ok(Array.isArray(artifact.perJourney));
  for (const j of artifact.perJourney) {
    assert.equal(typeof j.id, 'string');
    assert.equal(typeof j.passed, 'number');
    assert.equal(typeof j.failed, 'number');
  }
});

test('CLI journey-health subprocess exits 0 and prints the artifact', () => {
  const { status, stdout, stderr } = runCli(['journey-health', '--results', RESULTS_FIXTURE], REPO_ROOT);
  assert.equal(status, 0, `expected exit 0, got ${status}. stderr: ${stderr}`);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.score, 67);
  assert.ok(Array.isArray(parsed.perJourney));
});
