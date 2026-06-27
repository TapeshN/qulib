/**
 * CLI tests for `qulib score-bug-report`.
 *
 * All tests run OFFLINE (no ANTHROPIC_API_KEY) so the deterministic scoring
 * path is used and results are stable. Uses the spawnSync subprocess pattern
 * from cli/__tests__/confidence.test.ts.
 *
 * The fixture lives at packages/core/fixtures/bug-report.json and contains
 * a valid { report, target } object with all required fields.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { formatBugReportReport } from '../score-bug-report-run.js';
import type { BugReportScoreResult } from '../../schemas/bug-report-score.schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliEntry = resolve(__dirname, '..', 'index.ts');
const FIXTURE_BUG_REPORT = resolve(__dirname, '..', '..', '..', 'fixtures', 'bug-report.json');

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

test('qulib score-bug-report: exits 0 with fixture input, prints rubric', () => {
  const { status, stdout, stderr } = runCli(['score-bug-report', '--input', FIXTURE_BUG_REPORT]);
  assert.equal(status, 0, `expected exit 0; stderr: ${stderr}`);
  assert.match(stdout, /rubric/i);
  assert.match(stdout, /coverage/i);
  assert.match(stdout, /severity/i);
  assert.match(stdout, /matchConfidence/i);
});

test('qulib score-bug-report --json: exits 0, emits valid JSON with all result fields', () => {
  const { status, stdout, stderr } = runCli(['score-bug-report', '--input', FIXTURE_BUG_REPORT, '--json']);
  assert.equal(status, 0, `expected exit 0; stderr: ${stderr}`);
  let obj: unknown;
  assert.doesNotThrow(() => { obj = JSON.parse(stdout); }, 'stdout should be valid JSON');
  const r = obj as BugReportScoreResult;
  assert.ok(typeof r.matched === 'boolean', 'result.matched should be boolean');
  assert.ok(typeof r.matchConfidence === 'number', 'result.matchConfidence should be a number');
  assert.ok(typeof r.rubric === 'object' && r.rubric !== null, 'result.rubric should be an object');
  assert.ok(typeof r.rubric.coverage === 'number', 'rubric.coverage should be a number');
  assert.ok(typeof r.rubric.severity === 'number', 'rubric.severity should be a number');
  assert.ok(typeof r.rubric.repro === 'number', 'rubric.repro should be a number');
  assert.ok(typeof r.rubric.evidence === 'number', 'rubric.evidence should be a number');
  assert.ok(typeof r.feedback === 'string', 'result.feedback should be a string');
  assert.ok(typeof r.scoringPath === 'string', 'result.scoringPath should be a string');
});

// ---------------------------------------------------------------------------
// missing --input
// ---------------------------------------------------------------------------

test('qulib score-bug-report: missing --input → non-zero exit', () => {
  const { status } = runCli(['score-bug-report']);
  assert.notEqual(status, 0, 'expected non-zero exit when --input is missing');
});

// ---------------------------------------------------------------------------
// nonexistent input file
// ---------------------------------------------------------------------------

test('qulib score-bug-report: nonexistent input file → non-zero exit + friendly error, no stack', () => {
  const { status, stdout, stderr } = runCli([
    'score-bug-report', '--input', '/nonexistent/path/bug-report.json',
  ]);
  assert.notEqual(status, 0, 'expected non-zero exit for nonexistent file');
  const combined = stdout + stderr;
  // Friendly message present
  assert.match(combined, /score-bug-report: cannot access input file/i);
  // No raw stack trace
  assert.ok(!combined.includes('at Object.<anonymous>'), 'should not include raw stack trace');
  assert.ok(!combined.includes('ZodError'), 'should not include raw ZodError');
});

// ---------------------------------------------------------------------------
// malformed JSON input
// ---------------------------------------------------------------------------

test('qulib score-bug-report: malformed JSON → friendly error, non-zero exit, no stack', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'qulib-test-'));
  const badPath = resolve(dir, 'bad.json');
  writeFileSync(badPath, '{ not valid json }', 'utf8');

  const { status, stdout, stderr } = runCli(['score-bug-report', '--input', badPath]);
  assert.notEqual(status, 0, 'expected non-zero exit for bad JSON');
  const combined = stdout + stderr;
  assert.match(combined, /not valid JSON|score-bug-report/i);
  assert.ok(!combined.includes('ZodError'), 'should not include raw ZodError');
  assert.ok(!combined.includes('at Object.<anonymous>'), 'should not include raw stack trace');
});

// ---------------------------------------------------------------------------
// wrong-shape JSON (valid JSON, wrong fields)
// ---------------------------------------------------------------------------

test('qulib score-bug-report: wrong-shape JSON → friendly one-line error, non-zero exit, no stack', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'qulib-test-'));
  const wrongPath = resolve(dir, 'wrong.json');
  writeFileSync(wrongPath, JSON.stringify({ foo: 'bar' }), 'utf8');

  const { status, stdout, stderr } = runCli(['score-bug-report', '--input', wrongPath]);
  assert.notEqual(status, 0, 'expected non-zero exit for wrong-shape JSON');
  const combined = stdout + stderr;
  // Should contain a friendly message mentioning the expected shape or "invalid input"
  assert.match(combined, /invalid input|score-bug-report/i);
  // Should NOT dump a raw stack
  assert.ok(!combined.includes('at Object.<anonymous>'), 'should not include raw stack trace');
  // ZodError's raw multi-line dump should not be present — we check for a specific line
  const lines = combined.split('\n').filter((l) => l.trim().length > 0);
  const errorLines = lines.filter((l) => /ZodError|issues\[/.test(l));
  assert.equal(errorLines.length, 0, `should not dump raw ZodError lines; got: ${errorLines.join('\n')}`);
});

// ---------------------------------------------------------------------------
// formatBugReportReport — pure unit test (no subprocess)
// ---------------------------------------------------------------------------

test('formatBugReportReport: includes key fields in human report', () => {
  const result: BugReportScoreResult = {
    matched: true,
    matchConfidence: 0.75,
    rubric: { coverage: 18, severity: 25, repro: 20, evidence: 12 },
    feedback: 'Good match for the planted validation bug.',
    scoringPath: 'deterministic-fallback',
  };
  const report = formatBugReportReport(result);
  assert.match(report, /matched:\s+true/);
  assert.match(report, /matchConfidence:\s+0\.75/);
  assert.match(report, /coverage:\s+18\/25/);
  assert.match(report, /severity:\s+25\/25/);
  assert.match(report, /repro:\s+20\/25/);
  assert.match(report, /evidence:\s+12\/25/);
  assert.match(report, /total:\s+75\/100/);
  assert.match(report, /Good match/);
});
