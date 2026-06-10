/**
 * CLI tests for `qulib baseline` (save / list / compare).
 *
 * Mirrors the score-automation / confidence test pattern:
 *   - Direct invocation of the extracted core functions with an injected output
 *     sink for logic tests (no subprocess needed).
 *   - One subprocess round-trip per subcommand to prove the CLI wiring is live.
 *
 * Golden fixture cases:
 *   - Identical run (same snapshot twice) → zero-drift delta (compareBaselines
 *     returns empty newGaps/resolvedGaps/severityChanges, confidenceDelta=0).
 *   - Doctored fixture (clean-run.json prior vs doctored-run.json current) →
 *     detected drift with correct dimension attribution per gap.
 *
 * Fixtures live at packages/core/fixtures/baselines/ (outside tsc's source include,
 * never compiled) and can be loaded via --from-report without triggering a live crawl.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  runBaselineSave,
  runBaselineList,
  runBaselineCompare,
  formatSavedSnapshot,
  formatBaselineList,
  formatBaselineDelta,
  loadGapAnalysisFromReport,
} from '../baseline-run.js';
import { BaselineSnapshotSchema, BaselineDeltaSchema } from '../../baseline/baseline.schema.js';
import { compareBaselines } from '../../baseline/baseline.js';
import type { BaselineSnapshot } from '../../baseline/baseline.schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliEntry = resolve(__dirname, '..', 'index.ts');
const FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', 'fixtures', 'baselines');
const CLEAN_FIXTURE = resolve(FIXTURE_ROOT, 'clean-run.json');
const DOCTORED_FIXTURE = resolve(FIXTURE_ROOT, 'doctored-run.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'qulib-baseline-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', cliEntry, ...args],
    { encoding: 'utf8', cwd: resolve(__dirname, '..', '..', '..'), maxBuffer: 10 * 1024 * 1024 }
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// loadGapAnalysisFromReport — guard rails
// ---------------------------------------------------------------------------

test('loadGapAnalysisFromReport throws when the path does not exist', async () => {
  await assert.rejects(
    () => loadGapAnalysisFromReport('/does/not/exist.json'),
    /could not be read/
  );
});

test('loadGapAnalysisFromReport throws on invalid JSON', async () => {
  await withTmpDir(async (dir) => {
    const bad = join(dir, 'bad.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(bad, 'not valid json', 'utf8');
    await assert.rejects(() => loadGapAnalysisFromReport(bad), /not valid JSON/);
  });
});

test('loadGapAnalysisFromReport throws when the JSON is not a valid GapAnalysis', async () => {
  await withTmpDir(async (dir) => {
    const bad = join(dir, 'bad.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(bad, JSON.stringify({ foo: 'bar' }), 'utf8');
    await assert.rejects(() => loadGapAnalysisFromReport(bad), /not a valid qulib report\.json/);
  });
});

// ---------------------------------------------------------------------------
// baseline save — core function
// ---------------------------------------------------------------------------

test('runBaselineSave saves from --from-report and returns a valid BaselineSnapshot', async () => {
  await withTmpDir(async (dir) => {
    const lines: string[] = [];
    const snap = await runBaselineSave(
      { url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir },
      (l) => lines.push(l)
    );
    BaselineSnapshotSchema.parse(snap);
    assert.equal(snap.url, 'https://example.com');
    assert.equal(snap.releaseConfidence, 85);
    assert.equal(snap.gapCount, 2);
  });
});

test('runBaselineSave emits human output by default', async () => {
  await withTmpDir(async (dir) => {
    const lines: string[] = [];
    await runBaselineSave(
      { url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir },
      (l) => lines.push(l)
    );
    const out = lines.join('\n');
    assert.match(out, /Saved baseline/);
    assert.match(out, /releaseConfidence: 85/);
  });
});

test('runBaselineSave emits JSON when --json flag is set', async () => {
  await withTmpDir(async (dir) => {
    const lines: string[] = [];
    await runBaselineSave(
      { url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir, json: true },
      (l) => lines.push(l)
    );
    const out = lines.join('\n');
    const parsed = JSON.parse(out) as unknown;
    BaselineSnapshotSchema.parse(parsed);
  });
});

test('runBaselineSave preserves label when --label is provided', async () => {
  await withTmpDir(async (dir) => {
    const snap = await runBaselineSave(
      { url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir, label: 'pre-v2' },
      () => {}
    );
    assert.equal(snap.label, 'pre-v2');
  });
});

// ---------------------------------------------------------------------------
// baseline list — core function
// ---------------------------------------------------------------------------

test('runBaselineList returns empty list and human message when no baselines exist', async () => {
  await withTmpDir(async (dir) => {
    const lines: string[] = [];
    const snaps = await runBaselineList({ url: 'https://no-baselines.example.com', dir }, (l) => lines.push(l));
    assert.equal(snaps.length, 0);
    const out = lines.join('\n');
    assert.match(out, /No baselines saved/);
  });
});

test('runBaselineList returns saved snapshots newest-first', async () => {
  await withTmpDir(async (dir) => {
    await runBaselineSave({ url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir }, () => {});
    await new Promise((r) => setTimeout(r, 5));
    await runBaselineSave({ url: 'https://example.com', fromReport: DOCTORED_FIXTURE, dir }, () => {});

    const snaps = await runBaselineList({ url: 'https://example.com', dir }, () => {});
    assert.equal(snaps.length, 2);
    assert.ok(
      new Date(snaps[0].savedAt).getTime() >= new Date(snaps[1].savedAt).getTime(),
      'list must be newest-first'
    );
  });
});

test('runBaselineList emits JSON when --json is set', async () => {
  await withTmpDir(async (dir) => {
    await runBaselineSave({ url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir }, () => {});

    const lines: string[] = [];
    await runBaselineList({ url: 'https://example.com', dir, json: true }, (l) => lines.push(l));
    const parsed = JSON.parse(lines.join('\n')) as unknown;
    assert.ok(Array.isArray(parsed));
  });
});

// ---------------------------------------------------------------------------
// baseline compare — core function
// ---------------------------------------------------------------------------

test('runBaselineCompare throws when fewer than two baselines exist for --url', async () => {
  await withTmpDir(async (dir) => {
    await runBaselineSave({ url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir }, () => {});
    await assert.rejects(
      () => runBaselineCompare({ url: 'https://example.com', dir }, () => {}),
      /at least two saved baselines/
    );
  });
});

test('runBaselineCompare throws when --from is provided without --to', async () => {
  await withTmpDir(async (dir) => {
    await assert.rejects(
      () => runBaselineCompare({ from: 'some-id', dir }, () => {}),
      /requires BOTH --from and --to/
    );
  });
});

test('runBaselineCompare throws when neither --url nor --from/--to are provided', async () => {
  await withTmpDir(async (dir) => {
    await assert.rejects(
      () => runBaselineCompare({ dir }, () => {}),
      /requires either --from \+ --to, or --url/
    );
  });
});

// ---------------------------------------------------------------------------
// GOLDEN FIXTURE: identical run → zero drift
// ---------------------------------------------------------------------------

test('golden: identical snapshot compared to itself produces zero-drift delta', async () => {
  await withTmpDir(async (dir) => {
    // Save the same fixture twice (identical analysis).
    await runBaselineSave({ url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir }, () => {});
    await new Promise((r) => setTimeout(r, 5));
    await runBaselineSave({ url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir }, () => {});

    const lines: string[] = [];
    const delta = await runBaselineCompare({ url: 'https://example.com', dir }, (l) => lines.push(l));

    // Zero-drift assertions
    assert.equal(delta.newGaps.length, 0, 'identical run must have zero new gaps');
    assert.equal(delta.resolvedGaps.length, 0, 'identical run must have zero resolved gaps');
    assert.equal(delta.severityChanges.length, 0, 'identical run must have zero severity changes');
    assert.equal(delta.confidenceDelta, 0, 'identical run must have zero confidence delta');
    assert.match(delta.summary, /unchanged/, 'summary must say "unchanged"');

    // Schema validation
    BaselineDeltaSchema.parse(delta);

    // Human output mentions "unchanged"
    const out = lines.join('\n');
    assert.match(out, /unchanged/);
  });
});

test('golden: identical snapshot emits valid JSON delta with zero-drift when --json', async () => {
  await withTmpDir(async (dir) => {
    await runBaselineSave({ url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir }, () => {});
    await new Promise((r) => setTimeout(r, 5));
    await runBaselineSave({ url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir }, () => {});

    const lines: string[] = [];
    const delta = await runBaselineCompare({ url: 'https://example.com', dir, json: true }, (l) =>
      lines.push(l)
    );

    const parsed = JSON.parse(lines.join('\n')) as unknown;
    const validated = BaselineDeltaSchema.parse(parsed);
    assert.equal(validated.newGaps.length, 0);
    assert.equal(validated.confidenceDelta, 0);
    // The returned delta and parsed JSON must agree
    assert.equal(delta.confidenceDelta, validated.confidenceDelta);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN FIXTURE: doctored fixture → detected drift with correct attribution
// ---------------------------------------------------------------------------

test('golden: doctored fixture detects drift with correct dimension attribution', async () => {
  await withTmpDir(async (dir) => {
    // Prior: clean-run.json — 85 confidence, 2 gaps (/login high, /dashboard medium a11y)
    await runBaselineSave({ url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir }, () => {});
    await new Promise((r) => setTimeout(r, 5));
    // Current: doctored-run.json — 60 confidence, 3 gaps (severity escalated, new gaps added)
    await runBaselineSave({ url: 'https://example.com', fromReport: DOCTORED_FIXTURE, dir }, () => {});

    const delta = await runBaselineCompare({ url: 'https://example.com', dir }, () => {});

    // Confidence regressed
    assert.equal(delta.confidenceDelta, -25, 'confidence must drop from 85→60');
    assert.match(delta.summary, /regressed/);

    // /login severity: high → critical (severity-increased)
    const loginSev = delta.severityChanges.find((s) => s.path === '/login');
    assert.ok(loginSev !== undefined, '/login must appear as a severity change');
    assert.equal(loginSev!.status, 'severity-increased', '/login must be severity-increased');
    assert.equal(loginSev!.category, 'untested-route', 'category must be untested-route');

    // /checkout is a net-new gap (untested-route)
    const checkoutNew = delta.newGaps.find((g) => g.path === '/checkout');
    assert.ok(checkoutNew !== undefined, '/checkout must appear as a new gap');
    assert.equal(checkoutNew!.status, 'new');
    assert.equal(checkoutNew!.category, 'untested-route');

    // /api/payments is a net-new gap (untested-api-endpoint)
    const paymentsNew = delta.newGaps.find((g) => g.path === '/api/payments');
    assert.ok(paymentsNew !== undefined, '/api/payments must appear as a new gap');
    assert.equal(paymentsNew!.category, 'untested-api-endpoint');
    assert.equal(paymentsNew!.severity, 'critical');

    // /dashboard (a11y medium) was resolved — not present in the doctored run
    const dashResolved = delta.resolvedGaps.find((g) => g.path === '/dashboard');
    assert.ok(dashResolved !== undefined, '/dashboard a11y gap must be resolved');
    assert.equal(dashResolved!.status, 'resolved');
    assert.equal(dashResolved!.category, 'a11y');

    // Schema validation on the full delta
    BaselineDeltaSchema.parse(delta);
  });
});

test('golden: doctored fixture human output attributes every changed dimension', async () => {
  await withTmpDir(async (dir) => {
    await runBaselineSave({ url: 'https://example.com', fromReport: CLEAN_FIXTURE, dir }, () => {});
    await new Promise((r) => setTimeout(r, 5));
    await runBaselineSave({ url: 'https://example.com', fromReport: DOCTORED_FIXTURE, dir }, () => {});

    const lines: string[] = [];
    await runBaselineCompare({ url: 'https://example.com', dir }, (l) => lines.push(l));
    const out = lines.join('\n');

    assert.match(out, /regressed/, 'output must note regression');
    assert.match(out, /\/login/, '/login must appear in output');
    assert.match(out, /\/checkout/, '/checkout must appear in output');
    assert.match(out, /\/dashboard/, '/dashboard resolution must appear in output');
  });
});

// ---------------------------------------------------------------------------
// formatSavedSnapshot / formatBaselineList / formatBaselineDelta — output shape
// ---------------------------------------------------------------------------

test('formatSavedSnapshot includes id, url, confidence, and gapCount', () => {
  const snap: BaselineSnapshot = {
    id: 'example_com__2024-01-01T00-00-00-000',
    url: 'https://example.com',
    savedAt: new Date().toISOString(),
    releaseConfidence: 77,
    gapCount: 3,
    gaps: [],
    label: 'v1.2.3',
  };
  const out = formatSavedSnapshot(snap);
  assert.match(out, /example_com__2024-01-01T00-00-00-000/);
  assert.match(out, /https:\/\/example\.com/);
  assert.match(out, /77\/100/);
  assert.match(out, /3/);
  assert.match(out, /v1\.2\.3/);
});

test('formatBaselineList shows "No baselines" message for empty list', () => {
  const out = formatBaselineList('https://example.com', []);
  assert.match(out, /No baselines saved/);
  assert.match(out, /https:\/\/example\.com/);
});

test('formatBaselineList shows count and each snapshot for non-empty list', () => {
  const snap: BaselineSnapshot = {
    id: 'ex__2024-01-01T00-00-00-000',
    url: 'https://example.com',
    savedAt: new Date().toISOString(),
    releaseConfidence: 90,
    gapCount: 0,
    gaps: [],
  };
  const out = formatBaselineList('https://example.com', [snap]);
  assert.match(out, /1 baseline/);
  assert.match(out, /ex__2024-01-01T00-00-00-000/);
  assert.match(out, /90\/100/);
});

// ---------------------------------------------------------------------------
// CLI subprocess wiring — one round-trip per subcommand
// ---------------------------------------------------------------------------

test('CLI: baseline save --from-report exits 0 and outputs "Saved baseline"', async () => {
  await withTmpDir(async (dir) => {
    const { status, stdout, stderr } = runCli([
      'baseline', 'save',
      '--url', 'https://example.com',
      '--from-report', CLEAN_FIXTURE,
      '--dir', dir,
    ]);
    assert.equal(status, 0, `exit non-zero. stderr: ${stderr}`);
    assert.match(stdout, /Saved baseline/);
  });
});

test('CLI: baseline list exits 0', async () => {
  await withTmpDir(async (dir) => {
    // First save a baseline so list has something.
    runCli(['baseline', 'save', '--url', 'https://example.com', '--from-report', CLEAN_FIXTURE, '--dir', dir]);

    const { status, stderr } = runCli(['baseline', 'list', '--url', 'https://example.com', '--dir', dir]);
    assert.equal(status, 0, `exit non-zero. stderr: ${stderr}`);
  });
});

test('CLI: baseline compare --json exits 0 and emits valid BaselineDelta', async () => {
  await withTmpDir(async (dir) => {
    // Need two baselines to compare.
    runCli(['baseline', 'save', '--url', 'https://example.com', '--from-report', CLEAN_FIXTURE, '--dir', dir]);
    // Small delay so the timestamp-based id is unique.
    await new Promise((r) => setTimeout(r, 10));
    runCli(['baseline', 'save', '--url', 'https://example.com', '--from-report', DOCTORED_FIXTURE, '--dir', dir]);

    const { status, stdout, stderr } = runCli([
      'baseline', 'compare',
      '--url', 'https://example.com',
      '--dir', dir,
      '--json',
    ]);
    assert.equal(status, 0, `exit non-zero. stderr: ${stderr}`);
    const parsed = JSON.parse(stdout) as unknown;
    BaselineDeltaSchema.parse(parsed);
  });
});
