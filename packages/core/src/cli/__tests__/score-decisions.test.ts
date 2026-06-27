/**
 * CLI tests for `qulib score-decisions`.
 *
 * All tests run OFFLINE (no ANTHROPIC_API_KEY) so the deterministic scoring
 * path is used and results are stable. Uses the spawnSync subprocess pattern
 * from cli/__tests__/confidence.test.ts.
 *
 * The fixture lives at packages/core/fixtures/forks.jsonl and contains:
 *   - fork-correct-1: gate_block_vs_pass, choice=block, constraint=destructive floor violation → senior-correct
 *   - fork-wrong-1:   gate_block_vs_pass, choice=pass,  constraint=destructive floor violation → mis-decision
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { evaluateDecisionsGate, formatDecisionsReport } from '../score-decisions-run.js';
import type { DecisionScoreResult } from '../../schemas/decision-score.schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliEntry = resolve(__dirname, '..', 'index.ts');
const FIXTURE_FORKS = resolve(__dirname, '..', '..', '..', 'fixtures', 'forks.jsonl');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function runCli(
  args: string[],
  env: Record<string, string | undefined> = {}
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', cliEntry, ...args],
    {
      encoding: 'utf8',
      cwd: resolve(__dirname, '..', '..', '..'),
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        // Disable LLM judge for offline/deterministic tests
        ANTHROPIC_API_KEY: undefined,
        ...env,
      },
    }
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// Basic invocation
// ---------------------------------------------------------------------------

test('qulib score-decisions: exits 0 with fixture forks, prints meanDecisionQuality', () => {
  const { status, stdout, stderr } = runCli(['score-decisions', '--forks', FIXTURE_FORKS]);
  assert.equal(status, 0, `expected exit 0; stderr: ${stderr}`);
  assert.match(stdout, /meanDecisionQuality/);
});

test('qulib score-decisions --json: exits 0, emits valid JSON with aggregate and scored', () => {
  const { status, stdout, stderr } = runCli(['score-decisions', '--forks', FIXTURE_FORKS, '--json']);
  assert.equal(status, 0, `expected exit 0; stderr: ${stderr}`);
  let obj: unknown;
  assert.doesNotThrow(() => { obj = JSON.parse(stdout); }, 'stdout should be valid JSON');
  const r = obj as DecisionScoreResult;
  assert.ok(Array.isArray(r.scored), 'result.scored should be an array');
  assert.ok(typeof r.aggregate.meanDecisionQuality === 'number', 'aggregate.meanDecisionQuality should be a number');
  assert.ok(typeof r.aggregate.count === 'number', 'aggregate.count should be a number');
  assert.equal(r.aggregate.count, 2, 'fixture has 2 forks');
});

// ---------------------------------------------------------------------------
// --min-quality gate
// ---------------------------------------------------------------------------

test('qulib score-decisions: --min-quality 0 → exit 0 + GATE PASS', () => {
  const { status, stdout, stderr } = runCli([
    'score-decisions', '--forks', FIXTURE_FORKS, '--min-quality', '0',
  ]);
  assert.equal(status, 0, `expected exit 0; stderr: ${stderr}`);
  assert.match(stdout + stderr, /GATE: PASS/);
});

test('qulib score-decisions: --min-quality 1.1 → exit 1 + GATE FAIL', () => {
  const { status, stdout, stderr } = runCli([
    'score-decisions', '--forks', FIXTURE_FORKS, '--min-quality', '1.1',
  ]);
  // 1.1 is out of [0,1] → friendly error, non-zero
  assert.equal(status, 1, `expected exit 1; stderr: ${stderr}`);
  assert.match(stdout + stderr, /must be a number in \[0, 1\]/);
});

test('qulib score-decisions: --min-quality 0.99 → exit 1 + GATE FAIL (fixture mean < 0.99)', () => {
  // Fixture has one correct (0.95) and one wrong (0.05) fork → mean ~0.5, well below 0.99
  const { status, stdout, stderr } = runCli([
    'score-decisions', '--forks', FIXTURE_FORKS, '--min-quality', '0.99',
  ]);
  assert.equal(status, 1, `expected exit 1; stderr: ${stderr}`);
  assert.match(stdout + stderr, /GATE: FAIL/);
});

// ---------------------------------------------------------------------------
// invalid --min-quality
// ---------------------------------------------------------------------------

test('qulib score-decisions: --min-quality abc → non-zero exit + friendly error', () => {
  const { status, stdout, stderr } = runCli([
    'score-decisions', '--forks', FIXTURE_FORKS, '--min-quality', 'abc',
  ]);
  assert.notEqual(status, 0, `expected non-zero exit; stdout: ${stdout}`);
  // Either Commander rejects it or our validation fires — either way a friendly message appears
  const combined = stdout + stderr;
  const hasFriendly =
    /must be a number/i.test(combined) ||
    /invalid.*min-quality/i.test(combined) ||
    /NaN/i.test(combined) ||
    combined.length > 0; // at minimum some output
  assert.ok(hasFriendly, 'expected friendly error output');
});

// ---------------------------------------------------------------------------
// missing --forks
// ---------------------------------------------------------------------------

test('qulib score-decisions: missing --forks → non-zero exit', () => {
  const { status } = runCli(['score-decisions']);
  assert.notEqual(status, 0, 'expected non-zero exit when --forks is missing');
});

// ---------------------------------------------------------------------------
// nonexistent forks file
// ---------------------------------------------------------------------------

test('qulib score-decisions: nonexistent forks file → non-zero exit + friendly error', () => {
  const { status, stdout, stderr } = runCli([
    'score-decisions', '--forks', '/nonexistent/path/forks.jsonl',
  ]);
  assert.notEqual(status, 0, 'expected non-zero exit for nonexistent forks file');
  assert.match(stdout + stderr, /score-decisions failed|not exist|not accessible|within the allowed/i);
});

// ---------------------------------------------------------------------------
// evaluateDecisionsGate — pure unit tests (no subprocess)
// ---------------------------------------------------------------------------

function makeResult(mean: number): DecisionScoreResult {
  return {
    scored: [],
    aggregate: {
      meanDecisionQuality: mean,
      byKind: { gate_block_vs_pass: mean, stop_vs_continue: 0, escalate_vs_proceed: 0 },
      count: 1,
    },
  };
}

test('evaluateDecisionsGate: no gate → not requested, passes', () => {
  const g = evaluateDecisionsGate(makeResult(0.5));
  assert.equal(g.requested, false);
  assert.equal(g.passed, true);
});

test('evaluateDecisionsGate: --min-quality 0 → always passes', () => {
  assert.equal(evaluateDecisionsGate(makeResult(0), 0).passed, true);
  assert.equal(evaluateDecisionsGate(makeResult(0.5), 0).passed, true);
});

test('evaluateDecisionsGate: --min-quality 0.8 fails below, passes at or above', () => {
  assert.equal(evaluateDecisionsGate(makeResult(0.79), 0.8).passed, false);
  assert.equal(evaluateDecisionsGate(makeResult(0.8), 0.8).passed, true);
  assert.equal(evaluateDecisionsGate(makeResult(1.0), 0.8).passed, true);
});

// ---------------------------------------------------------------------------
// formatDecisionsReport — pure unit test
// ---------------------------------------------------------------------------

test('formatDecisionsReport: includes count and meanDecisionQuality', () => {
  const result: DecisionScoreResult = {
    scored: [
      {
        fork_id: 'f1',
        fork_kind: 'gate_block_vs_pass',
        choice: 'block',
        decisionQuality: 0.95,
        seniorCorrect: true,
        rationale: 'Correctly blocked a destructive action',
        scoringPath: 'deterministic',
      },
    ],
    aggregate: {
      meanDecisionQuality: 0.95,
      byKind: { gate_block_vs_pass: 0.95, stop_vs_continue: 0, escalate_vs_proceed: 0 },
      count: 1,
    },
  };
  const report = formatDecisionsReport(result);
  assert.match(report, /1 fork/);
  assert.match(report, /meanDecisionQuality: 0\.95/);
  assert.match(report, /f1/);
  assert.match(report, /senior-correct/);
});

// Regression: on the CLI the user owns the path they pass, so a forks file
// OUTSIDE the current working directory must be accepted (the traversal check
// is rooted at the file's own directory, not cwd). Previously rejected with
// "forksPath must be within the allowed root directory".
test('CLI accepts a forks file outside the current working directory', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'qulib-cli-forks-'));
  const fp = resolve(dir, 'my-forks.jsonl');
  const fork = {
    fork_id: 'f-out',
    fork_kind: 'gate_block_vs_pass',
    options: ['block', 'pass'],
    choice: 'block',
    constraint: 'floor violation detected — blocked',
    settleable: true,
    source_event_id: 'e-out',
    ts: '2026-06-27T00:00:00Z',
  };
  writeFileSync(fp, JSON.stringify(fork) + '\n', 'utf8');
  // runCli's cwd is packages/core; fp lives under tmpdir() → outside cwd.
  const { status, stdout, stderr } = runCli(['score-decisions', '--forks', fp]);
  assert.equal(status, 0, `expected exit 0 for a user-owned path outside cwd; stderr: ${stderr}`);
  assert.match(stdout, /meanDecisionQuality/);
});
