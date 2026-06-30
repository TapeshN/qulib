/**
 * CLI subprocess tests for `qulib validate`.
 * These tests are OFFLINE — no live URLs; they only use local fixtures.
 *
 * Exit-code contract for --fail-on-violation:
 *   'violates'             → exit 1
 *   'partial'              → exit 1
 *   'insufficient-evidence' → exit 0  (not a violation; no judge was run)
 *   'conforms'             → exit 0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const execFileAsync = promisify(execFile);

// Resolve paths relative to this test file.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// The CLI entry point (run via tsx so TypeScript sources work without a build step).
const CLI = join(__dirname, '../../cli/index.ts');
const FIXTURES_DIR = join(__dirname, '../../../fixtures/spec-validation');
const SPEC_FILE = join(FIXTURES_DIR, 'sample-spec.md');
const REPORT_FILE = join(FIXTURES_DIR, 'sample-report.json');

/**
 * Run the qulib CLI with tsx and return stdout, stderr, and exit code.
 * Deletes ANTHROPIC_API_KEY from the environment so every subprocess test
 * runs on the deterministic-fallback path (offline, no LLM calls).
 */
async function runCli(
  args: string[],
  env: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cleanEnv = { ...process.env, ...env };
  delete cleanEnv.ANTHROPIC_API_KEY;

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx/esm', CLI, ...args],
      { env: cleanEnv }
    );
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: e.code ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Basic invocation: no key → verdict=insufficient-evidence
// ---------------------------------------------------------------------------

test('qulib validate --spec --report (no key): prints verdict insufficient-evidence', async () => {
  const { stdout, code } = await runCli([
    'validate',
    '--spec', SPEC_FILE,
    '--report', REPORT_FILE,
  ]);
  assert.equal(code, 0, `Expected exit 0, got ${code}. stdout: ${stdout}`);
  assert.ok(
    stdout.includes('insufficient-evidence'),
    `Expected "insufficient-evidence" in stdout. Got: ${stdout}`
  );
});

test('qulib validate --spec --report --json (no key): emits valid JSON with insufficient-evidence', async () => {
  const { stdout, code } = await runCli([
    'validate',
    '--spec', SPEC_FILE,
    '--report', REPORT_FILE,
    '--json',
  ]);
  assert.equal(code, 0, `Expected exit 0, got ${code}. stdout: ${stdout}`);
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    assert.fail(`stdout was not valid JSON: ${stdout}`);
  }
  assert.equal(result.verdict, 'insufficient-evidence');
  assert.equal(result.schemaVersion, 1);
  assert.ok(Array.isArray(result.requirements));
});

// ---------------------------------------------------------------------------
// --fail-on-violation: insufficient-evidence should NOT set exit 1
// ---------------------------------------------------------------------------

test('qulib validate --fail-on-violation with insufficient-evidence exits 0', async () => {
  const { code, stdout } = await runCli([
    'validate',
    '--spec', SPEC_FILE,
    '--report', REPORT_FILE,
    '--fail-on-violation',
  ]);
  // insufficient-evidence is NOT a violation — gate should pass
  assert.equal(code, 0, `Expected exit 0 for insufficient-evidence. Got ${code}. stdout: ${stdout}`);
  assert.ok(
    stdout.includes('GATE: PASS'),
    `Expected "GATE: PASS" in stdout. Got: ${stdout}`
  );
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

test('qulib validate without --url or --report exits non-zero with helpful error', async () => {
  const { code, stdout, stderr } = await runCli([
    'validate',
    '--spec', SPEC_FILE,
  ]);
  assert.notEqual(code, 0, 'Expected non-zero exit when neither --url nor --report is given');
  const combined = stdout + stderr;
  assert.ok(
    combined.toLowerCase().includes('requires') || combined.toLowerCase().includes('--report') || combined.toLowerCase().includes('--url'),
    `Expected helpful error message. Got: ${combined}`
  );
});

test('qulib validate with --url and --report exits non-zero with helpful error', async () => {
  const { code, stdout, stderr } = await runCli([
    'validate',
    '--spec', SPEC_FILE,
    '--url', 'https://example.com',
    '--report', REPORT_FILE,
  ]);
  assert.notEqual(code, 0, 'Expected non-zero exit when both --url and --report are given');
  const combined = stdout + stderr;
  assert.ok(
    combined.includes('not both') || combined.includes('exactly one'),
    `Expected mutual-exclusion error. Got: ${combined}`
  );
});

test('qulib validate with missing spec file exits non-zero', async () => {
  const { code, stdout, stderr } = await runCli([
    'validate',
    '--spec', '/nonexistent/path/spec.md',
    '--report', REPORT_FILE,
  ]);
  assert.notEqual(code, 0, 'Expected non-zero exit for missing spec file');
  const combined = stdout + stderr;
  assert.ok(
    combined.toLowerCase().includes('spec') || combined.toLowerCase().includes('not exist') || combined.toLowerCase().includes('accessible'),
    `Expected file-not-found error. Got: ${combined}`
  );
});
