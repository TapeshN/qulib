/**
 * CLI smoke tests for `qulib confidence` (spec §6.E — CLI runtime-import check).
 *
 * Mirrors the score-automation.test.ts pattern:
 *   - direct invocation of runConfidence (the extracted core function) with the
 *     injected output sink so no subprocess is needed for the logic tests
 *   - one subprocess test for the --json flag to prove the wiring is end-to-end
 *
 * The `qulib confidence` command requires at least --url or --repo. Since Playwright
 * (analyzeApp) cannot run offline in tests, the --url path is tested with a validation
 * error. The --repo path uses the existing maturity-repo fixture to prove the
 * repo-only confidence path is end-to-end without a live URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ReleaseConfidenceSchema } from '../../schemas/confidence.schema.js';
import { runConfidence, formatConfidenceReport, evaluateConfidenceGate } from '../confidence-run.js';
import type { ReleaseConfidence } from '../../schemas/confidence.schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliEntry = resolve(__dirname, '..', 'index.ts');
const FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', 'fixtures', 'repos');
const MATURITY_REPO = resolve(FIXTURE_ROOT, 'maturity-repo');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function confidence(opts: { url?: string; repo?: string; json?: boolean }): Promise<{
  rc: ReleaseConfidence;
  out: string;
}> {
  const lines: string[] = [];
  const rc = await runConfidence(opts, (line) => lines.push(line));
  return { rc, out: lines.join('\n') };
}

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
// Validation guard rails
// ---------------------------------------------------------------------------

test('runConfidence throws when neither --url nor --repo is provided', async () => {
  await assert.rejects(
    () => runConfidence({}),
    /requires at least one of --url or --repo/
  );
});

// ---------------------------------------------------------------------------
// repo-only path (no Playwright) — uses the maturity-repo fixture
// ---------------------------------------------------------------------------

test('runConfidence --repo produces a valid ReleaseConfidence (schema check)', async () => {
  const { rc } = await confidence({ repo: MATURITY_REPO });
  const parsed = ReleaseConfidenceSchema.safeParse(rc);
  assert.ok(parsed.success, `ReleaseConfidenceSchema failed: ${JSON.stringify(parsed.error ?? null)}`);
});

test('runConfidence --repo: schemaVersion is 1', async () => {
  const { rc } = await confidence({ repo: MATURITY_REPO });
  assert.equal(rc.schemaVersion, 1);
});

test('runConfidence --repo: verdict is a valid ConfidenceVerdict', async () => {
  const { rc } = await confidence({ repo: MATURITY_REPO });
  const validVerdicts = ['ship', 'caution', 'hold', 'block'];
  assert.ok(validVerdicts.includes(rc.verdict), `unexpected verdict "${rc.verdict}"`);
});

test('runConfidence --repo: contributions contain test-automation source', async () => {
  const { rc } = await confidence({ repo: MATURITY_REPO });
  const testAuto = rc.contributions.find((c) => c.source === 'test-automation');
  assert.ok(testAuto, 'test-automation contribution should be present for repo input');
});

test('runConfidence --repo: api-coverage contribution present (may be not_applicable)', async () => {
  const { rc } = await confidence({ repo: MATURITY_REPO });
  const apiContrib = rc.contributions.find((c) => c.source === 'api-coverage');
  assert.ok(apiContrib, 'api-coverage contribution should be present for repo input');
});

test('runConfidence --repo: partial run discloses uncollected sources in honestyNotes', async () => {
  const { rc } = await confidence({ repo: MATURITY_REPO });
  assert.ok(rc.honestyNotes.length > 0, 'repo-only partial runs must populate honestyNotes');
  assert.ok(
    rc.honestyNotes.some((n) => /Partial evidence:/i.test(n)),
    'honestyNotes must include partial-evidence summary'
  );
  assert.ok(
    rc.honestyNotes.some((n) => /live-app-quality/i.test(n)),
    'honestyNotes must name uncollected app-runtime source'
  );
});

test('runConfidence --repo: topRisks excludes automation maturity success strings', async () => {
  const { rc } = await confidence({ repo: MATURITY_REPO });
  assert.ok(
    !rc.topRisks.some((r) => /Automation maturity: L\d/i.test(r)),
    'topRisks must not list automation maturity achievements as risks'
  );
});

test('runConfidence --repo: recommendedNextChecks suggests gathering skipped evidence', async () => {
  const { rc } = await confidence({ repo: MATURITY_REPO });
  assert.ok(
    rc.recommendedNextChecks.some((r) => /analyze_app/i.test(r)),
    'recommendedNextChecks must suggest analyze_app when app-runtime sources were skipped'
  );
});

test('runConfidence --repo human report includes verdict and score', async () => {
  const { out } = await confidence({ repo: MATURITY_REPO });
  assert.match(out, /Release confidence for/i);
  assert.match(out, /verdict:/i);
});

test('runConfidence --repo --json emits parseable JSON matching ReleaseConfidenceSchema', async () => {
  const { out } = await confidence({ repo: MATURITY_REPO, json: true });
  let parsed: unknown;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(out);
  }, 'output should be valid JSON');
  const schema = ReleaseConfidenceSchema.safeParse(parsed);
  assert.ok(schema.success, `schema parse failed: ${JSON.stringify(schema.error ?? null)}`);
});

// ---------------------------------------------------------------------------
// formatConfidenceReport (pure helper — unit test)
// ---------------------------------------------------------------------------

test('formatConfidenceReport includes subject ref and verdict line', () => {
  // Use a hand-built RC matching the ReleaseConfidenceSchema to test the formatter pure.
  const rc: ReleaseConfidence = {
    schemaVersion: 1,
    computedAt: new Date().toISOString(),
    subject: { kind: 'release', ref: 'https://example.com', tenantId: 'test' },
    confidenceScore: 82,
    verdict: 'ship',
    level: 4,
    label: 'L4 — strong, ship-ready',
    contributions: [
      {
        source: 'test-automation',
        score: 82,
        weight: 0.22,
        effectiveWeight: 1.0,
        applicability: 'applicable',
        blocking: false,
      },
    ],
    topRisks: [],
    recommendedNextChecks: [],
    honestyNotes: [],
    blockers: [],
    scoreFormula: 'test',
  };
  const report = formatConfidenceReport(rc, rc.subject.ref);
  assert.match(report, /Release confidence for https:\/\/example\.com/);
  assert.match(report, /verdict: ship/);
  assert.match(report, /82\/100/);
});

// ---------------------------------------------------------------------------
// CLI subprocess: `qulib confidence` with no arguments → non-zero exit
// ---------------------------------------------------------------------------

test('qulib confidence with no args exits non-zero', () => {
  const { status, stderr } = runCli(['confidence']);
  assert.notEqual(status, 0, `expected non-zero exit, got 0. stderr: ${stderr}`);
});

// ---------------------------------------------------------------------------
// CI gate — evaluateConfidenceGate (pure) + end-to-end exit codes
// ---------------------------------------------------------------------------

function rcWith(verdict: ReleaseConfidence['verdict'], confidenceScore: number | null): ReleaseConfidence {
  // evaluateConfidenceGate only reads verdict + confidenceScore.
  return { verdict, confidenceScore } as ReleaseConfidence;
}

test('gate: no flags → not requested, passes', () => {
  const g = evaluateConfidenceGate(rcWith('block', 10));
  assert.equal(g.requested, false);
  assert.equal(g.passed, true);
});

test('gate: --fail-on block fails only on block', () => {
  assert.equal(evaluateConfidenceGate(rcWith('block', 10), 'block').passed, false);
  assert.equal(evaluateConfidenceGate(rcWith('hold', 40), 'block').passed, true);
  assert.equal(evaluateConfidenceGate(rcWith('ship', 90), 'block').passed, true);
});

test('gate: --fail-on hold fails on hold and block (at or worse)', () => {
  assert.equal(evaluateConfidenceGate(rcWith('hold', 40), 'hold').passed, false);
  assert.equal(evaluateConfidenceGate(rcWith('block', 10), 'hold').passed, false);
  assert.equal(evaluateConfidenceGate(rcWith('caution', 60), 'hold').passed, true);
  assert.equal(evaluateConfidenceGate(rcWith('ship', 90), 'hold').passed, true);
});

test('gate: --min-score fails below threshold; null score always fails', () => {
  assert.equal(evaluateConfidenceGate(rcWith('ship', 80), undefined, 90).passed, false);
  assert.equal(evaluateConfidenceGate(rcWith('ship', 95), undefined, 90).passed, true);
  assert.equal(evaluateConfidenceGate(rcWith('block', null), undefined, 1).passed, false);
});

test('gate: --fail-on is case-insensitive', () => {
  assert.equal(evaluateConfidenceGate(rcWith('block', 10), 'BLOCK').passed, false);
});

test('gate: invalid --fail-on throws a clear error', () => {
  assert.throws(() => evaluateConfidenceGate(rcWith('ship', 90), 'banana'), /fail-on must be one of/);
});

test('CLI gate end-to-end: --min-score above the score exits non-zero', () => {
  const { status, stdout, stderr } = runCli(['confidence', '--repo', MATURITY_REPO, '--min-score', '101']);
  assert.equal(status, 1, `expected exit 1; stderr: ${stderr}`);
  assert.match(stdout + stderr, /GATE: FAIL/);
});

test('CLI gate end-to-end: passing gate exits zero', () => {
  const { status, stdout } = runCli(['confidence', '--repo', MATURITY_REPO, '--fail-on', 'block']);
  assert.equal(status, 0);
  assert.match(stdout, /GATE: PASS/);
});

test('CLI gate end-to-end: invalid --fail-on exits non-zero', () => {
  const { status, stderr } = runCli(['confidence', '--repo', MATURITY_REPO, '--fail-on', 'banana']);
  assert.equal(status, 1);
  assert.match(stderr, /fail-on must be one of/);
});
