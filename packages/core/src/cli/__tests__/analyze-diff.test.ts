/**
 * CLI tests for `qulib analyze-diff`.
 *
 * Mirrors the baseline / confidence test pattern:
 *   - Direct invocation of the extracted pure function and core functions
 *     with an injected output sink for logic tests (no subprocess overhead).
 *   - One subprocess round-trip to prove CLI wiring is live.
 *
 * Golden fixture cases:
 *   - Identical run (same report twice) → zero-drift result.
 *   - Doctored fixture (clean-run.json vs doctored-run.json) → detected drift
 *     with correct dimension attribution per gap.
 *   - Null confidence (auth-required mode) → confidenceDelta null, direction unknown.
 *
 * Fixtures reuse the existing packages/core/fixtures/baselines/clean-run.json
 * and doctored-run.json so a single source of fixture truth is maintained.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  analyzeRunDiff,
  runAnalyzeDiff,
  loadGapAnalysisFile,
  formatAnalyzeDiffMarkdown,
} from '../analyze-diff-run.js';
import type { GapAnalysis } from '../../schemas/gap-analysis.schema.js';

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
  const dir = await mkdtemp(join(tmpdir(), 'qulib-analyze-diff-test-'));
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

/** Minimal valid GapAnalysis with the given gaps and confidence. */
function makeAnalysis(
  gaps: GapAnalysis['gaps'],
  releaseConfidence: number | null = 80,
  analyzedAt = '2024-01-15T12:00:00.000Z'
): GapAnalysis {
  return {
    analyzedAt,
    mode: releaseConfidence === null ? 'auth-required' : 'url-only',
    releaseConfidence,
    coveragePagesScanned: 5,
    coverageBudgetExceeded: false,
    gaps,
    scenarios: [],
    generatedTests: [],
  };
}

// ---------------------------------------------------------------------------
// loadGapAnalysisFile — error guard tests
// ---------------------------------------------------------------------------

test('loadGapAnalysisFile throws when the path does not exist', async () => {
  await assert.rejects(
    () => loadGapAnalysisFile('/does/not/exist.json'),
    /could not read file/
  );
});

test('loadGapAnalysisFile throws when the file is not valid JSON', async () => {
  await withTmpDir(async (dir) => {
    const bad = join(dir, 'bad.json');
    await writeFile(bad, 'not valid json', 'utf8');
    await assert.rejects(() => loadGapAnalysisFile(bad), /not valid JSON/);
  });
});

test('loadGapAnalysisFile throws when the JSON is not a valid GapAnalysis', async () => {
  await withTmpDir(async (dir) => {
    const bad = join(dir, 'bad.json');
    await writeFile(bad, JSON.stringify({ foo: 'bar' }), 'utf8');
    await assert.rejects(() => loadGapAnalysisFile(bad), /not a valid qulib report\.json/);
  });
});

test('loadGapAnalysisFile reads the clean fixture successfully', async () => {
  const analysis = await loadGapAnalysisFile(CLEAN_FIXTURE);
  assert.equal(analysis.releaseConfidence, 85);
  assert.equal(analysis.gaps.length, 2);
});

// ---------------------------------------------------------------------------
// analyzeRunDiff — pure function, golden fixture cases
// ---------------------------------------------------------------------------

test('analyzeRunDiff: identical run produces zero-drift result', () => {
  const analysis = makeAnalysis([
    { id: 'g1', path: '/login', severity: 'high', category: 'untested-route', reason: 'No tests' },
  ], 80);
  const result = analyzeRunDiff(analysis, analysis);
  assert.equal(result.added.length, 0, 'zero added');
  assert.equal(result.removed.length, 0, 'zero removed');
  assert.equal(result.changed.length, 0, 'zero changed');
  assert.equal(result.confidenceDelta, 0, 'zero confidence delta');
  assert.equal(result.direction, 'unchanged');
  assert.match(result.summary, /unchanged/);
});

test('analyzeRunDiff: detects added, removed, and severity-changed gaps', () => {
  const from = makeAnalysis([
    { id: 'g1', path: '/login', severity: 'high', category: 'untested-route', reason: 'No login tests' },
    { id: 'g2', path: '/dashboard', severity: 'medium', category: 'a11y', reason: 'Missing aria' },
  ], 85);
  const to = makeAnalysis([
    { id: 'g1', path: '/login', severity: 'critical', category: 'untested-route', reason: 'No login tests' },
    { id: 'g3', path: '/checkout', severity: 'high', category: 'untested-route', reason: 'No checkout tests' },
    { id: 'g4', path: '/api/payments', severity: 'critical', category: 'untested-api-endpoint', reason: 'No API tests' },
  ], 60);

  const result = analyzeRunDiff(from, to);

  assert.equal(result.confidenceDelta, -25, 'confidence delta -25');
  assert.equal(result.direction, 'regressed');
  assert.match(result.summary, /regressed/);

  assert.equal(result.added.length, 2, '2 added gaps');
  assert.ok(result.added.some((g) => g.path === '/checkout'), '/checkout added');
  assert.ok(result.added.some((g) => g.path === '/api/payments'), '/api/payments added');

  assert.equal(result.removed.length, 1, '1 removed gap');
  assert.ok(result.removed.some((g) => g.path === '/dashboard'), '/dashboard removed');

  assert.equal(result.changed.length, 1, '1 severity change');
  const loginChange = result.changed.find((g) => g.path === '/login');
  assert.ok(loginChange !== undefined, '/login must be in changed');
  assert.equal(loginChange!.status, 'severity-increased');
});

test('analyzeRunDiff: improvement (resolved gaps, confidence up)', () => {
  const from = makeAnalysis([
    { id: 'g1', path: '/login', severity: 'high', category: 'untested-route', reason: 'No tests' },
  ], 60);
  const to = makeAnalysis([], 90);

  const result = analyzeRunDiff(from, to);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 1);
  assert.equal(result.confidenceDelta, 30);
  assert.equal(result.direction, 'improved');
  assert.match(result.summary, /improved/);
});

test('analyzeRunDiff: null releaseConfidence yields null confidenceDelta and direction=unknown', () => {
  const from = makeAnalysis([], null);
  const to = makeAnalysis([
    { id: 'g1', path: '/login', severity: 'high', category: 'untested-route', reason: 'No tests' },
  ], 75);

  const result = analyzeRunDiff(from, to);
  assert.equal(result.confidenceDelta, null, 'confidenceDelta must be null');
  assert.equal(result.direction, 'unknown');
  assert.match(result.summary, /unavailable/);
  assert.equal(result.added.length, 1, '/login must be in added');
});

test('analyzeRunDiff: fromLabel and toLabel appear in the result', () => {
  const analysis = makeAnalysis([], 80);
  const result = analyzeRunDiff(analysis, analysis, {
    fromLabel: 'v1-baseline',
    toLabel: 'v2-current',
  });
  assert.equal(result.fromLabel, 'v1-baseline');
  assert.equal(result.toLabel, 'v2-current');
});

// ---------------------------------------------------------------------------
// formatAnalyzeDiffMarkdown — output shape
// ---------------------------------------------------------------------------

test('formatAnalyzeDiffMarkdown: contains section headers', () => {
  const analysis = makeAnalysis([], 80);
  const result = analyzeRunDiff(analysis, analysis);
  const md = formatAnalyzeDiffMarkdown(result);
  assert.match(md, /## qulib analyze diff/);
  assert.match(md, /### Release Confidence/);
  assert.match(md, /### Added Findings/);
  assert.match(md, /### Removed Findings/);
  assert.match(md, /### Severity Changes/);
});

test('formatAnalyzeDiffMarkdown: shows confidence delta with arrow', () => {
  const from = makeAnalysis([], 60);
  const to = makeAnalysis([], 90);
  const result = analyzeRunDiff(from, to);
  const md = formatAnalyzeDiffMarkdown(result);
  assert.match(md, /60\/100.*90\/100/);
  assert.match(md, /improved/);
});

test('formatAnalyzeDiffMarkdown: shows unavailable for null confidence', () => {
  const from = makeAnalysis([], null);
  const to = makeAnalysis([], 75);
  const result = analyzeRunDiff(from, to);
  const md = formatAnalyzeDiffMarkdown(result);
  assert.match(md, /unavailable/i);
});

test('formatAnalyzeDiffMarkdown: tables contain gap paths', () => {
  const from = makeAnalysis([
    { id: 'g1', path: '/login', severity: 'high', category: 'untested-route', reason: 'No tests' },
  ], 85);
  const to = makeAnalysis([
    { id: 'g2', path: '/checkout', severity: 'high', category: 'untested-route', reason: 'No tests' },
  ], 75);
  const result = analyzeRunDiff(from, to);
  const md = formatAnalyzeDiffMarkdown(result);
  assert.match(md, /\/checkout/, 'added path in MD');
  assert.match(md, /\/login/, 'removed path in MD');
});

// ---------------------------------------------------------------------------
// runAnalyzeDiff — file-backed orchestrator
// ---------------------------------------------------------------------------

test('runAnalyzeDiff: reads fixtures and emits Markdown by default', async () => {
  const lines: string[] = [];
  const result = await runAnalyzeDiff(
    { from: CLEAN_FIXTURE, to: DOCTORED_FIXTURE },
    (l) => lines.push(l)
  );
  const out = lines.join('\n');
  assert.match(out, /## qulib analyze diff/);
  assert.equal(result.direction, 'regressed');
});

test('runAnalyzeDiff: emits JSON when --json flag is set', async () => {
  const lines: string[] = [];
  await runAnalyzeDiff(
    { from: CLEAN_FIXTURE, to: DOCTORED_FIXTURE, json: true },
    (l) => lines.push(l)
  );
  const parsed = JSON.parse(lines.join('\n')) as unknown;
  assert.ok(typeof parsed === 'object' && parsed !== null);
  const result = parsed as Record<string, unknown>;
  assert.ok('added' in result, 'JSON has added field');
  assert.ok('removed' in result, 'JSON has removed field');
  assert.ok('changed' in result, 'JSON has changed field');
  assert.ok('confidenceDelta' in result, 'JSON has confidenceDelta field');
  assert.ok('direction' in result, 'JSON has direction field');
  assert.ok('summary' in result, 'JSON has summary field');
});

test('runAnalyzeDiff: uses labelFrom/labelTo as provenance labels', async () => {
  const result = await runAnalyzeDiff(
    { from: CLEAN_FIXTURE, to: DOCTORED_FIXTURE, labelFrom: 'v1', labelTo: 'v2' },
    () => {}
  );
  assert.equal(result.fromLabel, 'v1');
  assert.equal(result.toLabel, 'v2');
});

test('runAnalyzeDiff: golden fixture drift — regressed direction, correct counts', async () => {
  const result = await runAnalyzeDiff(
    { from: CLEAN_FIXTURE, to: DOCTORED_FIXTURE },
    () => {}
  );
  assert.equal(result.direction, 'regressed');
  assert.equal(result.confidenceDelta, -25);
  assert.equal(result.added.length, 2, '2 added gaps');
  assert.equal(result.removed.length, 1, '1 removed gap');
  assert.equal(result.changed.length, 1, '1 severity change');
  assert.ok(result.added.some((g) => g.path === '/checkout'));
  assert.ok(result.added.some((g) => g.path === '/api/payments'));
  assert.ok(result.removed.some((g) => g.path === '/dashboard'));
  const loginChange = result.changed.find((g) => g.path === '/login');
  assert.ok(loginChange !== undefined);
  assert.equal(loginChange!.status, 'severity-increased');
});

// ---------------------------------------------------------------------------
// CLI subprocess wiring
// ---------------------------------------------------------------------------

test('CLI: analyze-diff exits 0 and renders Markdown by default', async () => {
  const { status, stdout, stderr } = runCli([
    'analyze-diff',
    '--from', CLEAN_FIXTURE,
    '--to', DOCTORED_FIXTURE,
  ]);
  assert.equal(status, 0, `exit non-zero. stderr: ${stderr}`);
  assert.match(stdout, /## qulib analyze diff/);
  assert.match(stdout, /regressed/);
});

test('CLI: analyze-diff --json exits 0 and emits valid JSON', async () => {
  const { status, stdout, stderr } = runCli([
    'analyze-diff',
    '--from', CLEAN_FIXTURE,
    '--to', DOCTORED_FIXTURE,
    '--json',
  ]);
  assert.equal(status, 0, `exit non-zero. stderr: ${stderr}`);
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok('added' in parsed);
  assert.ok('removed' in parsed);
  assert.ok('direction' in parsed);
  assert.equal(parsed['direction'], 'regressed');
});
