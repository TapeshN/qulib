/**
 * Regression-gate unit tests (`evals/runner/check.ts`) — node:test, real assertions.
 *
 * Coverage:
 *   - classifySuiteDelta: NEW (no baseline) / CLEAN (held or improved) / REGRESSION
 *     (dropped past margin), including the FAIL-rollup interaction.
 *   - findBaseline: picks the entry immediately before the latest for (suite, tenant),
 *     never crosses tenants, null when fewer than two entries exist.
 *   - buildCheckReport: exit-code priority (FAIL run -> 1, beats a coincidental
 *     REGRESSION verdict which alone -> 2, clean -> 0), judge-ran/SKIPPED reporting.
 *
 * These exercise the PURE functions only (no real ledger I/O, no golden corpus) so
 * they run instantly and cannot be affected by drift in the tracked golden cases —
 * runCheck()'s full orchestration (real golden + real ledger append) is exercised by
 * hand-triggering `npm run eval:check` directly (see the CI workflow + handback).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { classifySuiteDelta, findBaseline, buildCheckReport, REGRESSION_MARGIN } from '../check.js';
import type { EvalLedgerEntry, EvalRunSummary } from '../../types.js';

function ledgerEntry(overrides: Partial<EvalLedgerEntry> = {}): EvalLedgerEntry {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    suite: 'scaffold',
    outcome: 'PASS',
    score: 1,
    counts: { pass: 1, warn: 0, fail: 0, skip: 0, total: 1 },
    qulibVersion: '0.0.0',
    tenantId: 'default',
    ...overrides,
  };
}

function runSummary(overrides: Partial<EvalRunSummary> = {}): EvalRunSummary {
  return {
    suite: 'scaffold',
    outcome: 'PASS',
    score: 1,
    counts: { pass: 1, warn: 0, fail: 0, skip: 0, total: 1 },
    results: [
      {
        caseId: 'a',
        suite: 'scaffold',
        outcome: 'PASS',
        deterministic: { outcome: 'PASS', notes: [] },
        latencyMs: 1,
      },
    ],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifySuiteDelta
// ---------------------------------------------------------------------------

test('classifySuiteDelta: null baseline (first run ever) is NEW, never blocks', () => {
  const { verdict, delta } = classifySuiteDelta(0.9, null, 'PASS');
  assert.equal(verdict, 'NEW');
  assert.equal(delta, null);
});

test('classifySuiteDelta: score improved is CLEAN', () => {
  const { verdict, delta } = classifySuiteDelta(0.95, 0.9, 'PASS');
  assert.equal(verdict, 'CLEAN');
  assert.equal(delta, 0.05);
});

test('classifySuiteDelta: score held exactly steady is CLEAN', () => {
  const { verdict, delta } = classifySuiteDelta(0.9, 0.9, 'PASS');
  assert.equal(verdict, 'CLEAN');
  assert.equal(delta, 0);
});

test('classifySuiteDelta: a drop within margin is CLEAN, not a false regression', () => {
  const { verdict } = classifySuiteDelta(0.87, 0.9, 'PASS', REGRESSION_MARGIN);
  assert.equal(verdict, 'CLEAN');
});

test('classifySuiteDelta: a drop exceeding margin is REGRESSION', () => {
  const { verdict, reason } = classifySuiteDelta(0.5, 0.9, 'PASS', REGRESSION_MARGIN);
  assert.equal(verdict, 'REGRESSION');
  assert.match(reason, /score dropped/);
  assert.match(reason, /exceeds margin/);
});

test('classifySuiteDelta: exactly at the margin boundary is CLEAN (strict >)', () => {
  // delta = -0.05 exactly equals margin; only a drop that EXCEEDS margin fails.
  const { verdict } = classifySuiteDelta(0.85, 0.9, 'PASS', 0.05);
  assert.equal(verdict, 'CLEAN');
});

test('classifySuiteDelta: a FAIL-rollup run with a real score drop past margin is REGRESSION', () => {
  const { verdict, reason } = classifySuiteDelta(0.3, 0.9, 'FAIL');
  assert.equal(verdict, 'REGRESSION');
  assert.match(reason, /rolled up FAIL/);
});

test('classifySuiteDelta: a FAIL-rollup run whose score held is CLEAN (the FAIL exit path handles it)', () => {
  const { verdict } = classifySuiteDelta(0.9, 0.9, 'FAIL');
  assert.equal(verdict, 'CLEAN');
});

// ---------------------------------------------------------------------------
// findBaseline
// ---------------------------------------------------------------------------

test('findBaseline: null when fewer than two entries exist for the suite', () => {
  const entries = [ledgerEntry({ score: 0.9 })];
  assert.equal(findBaseline(entries, 'scaffold', 'default'), null);
});

test('findBaseline: picks the entry immediately before the latest', () => {
  const entries = [
    ledgerEntry({ ts: 't0', score: 0.7 }),
    ledgerEntry({ ts: 't1', score: 0.8 }),
    ledgerEntry({ ts: 't2', score: 0.9 }), // the just-appended "latest"
  ];
  const baseline = findBaseline(entries, 'scaffold', 'default');
  assert.equal(baseline?.ts, 't1');
  assert.equal(baseline?.score, 0.8);
});

test('findBaseline: never crosses suites', () => {
  const entries = [
    ledgerEntry({ suite: 'evidence', ts: 't0', score: 0.1 }),
    ledgerEntry({ suite: 'scaffold', ts: 't1', score: 0.8 }),
    ledgerEntry({ suite: 'scaffold', ts: 't2', score: 0.9 }),
  ];
  const baseline = findBaseline(entries, 'scaffold', 'default');
  assert.equal(baseline?.score, 0.8);
});

test('findBaseline: never crosses tenants (a multi-tenant ledger must not compare across tenants)', () => {
  const entries = [
    ledgerEntry({ tenantId: 'team-a', ts: 't0', score: 0.5 }),
    ledgerEntry({ tenantId: 'team-b', ts: 't1', score: 0.99 }),
    ledgerEntry({ tenantId: 'team-a', ts: 't2', score: 0.6 }),
  ];
  const baseline = findBaseline(entries, 'scaffold', 'team-a');
  assert.equal(baseline?.score, 0.5, 'must skip over team-b entry sandwiched between team-a runs');
});

test('findBaseline: legacy entries (no tenantId) match tenantId "legacy"', () => {
  const entries = [
    ledgerEntry({ tenantId: undefined as unknown as string, ts: 't0', score: 0.7 }),
    ledgerEntry({ tenantId: undefined as unknown as string, ts: 't1', score: 0.8 }),
  ];
  const baseline = findBaseline(entries, 'scaffold', 'legacy');
  assert.equal(baseline?.score, 0.7);
});

// ---------------------------------------------------------------------------
// buildCheckReport — exit-code priority + judge reporting
// ---------------------------------------------------------------------------

test('buildCheckReport: clean run with no baseline drop exits 0', () => {
  const summaries = [runSummary({ score: 0.9 })];
  const entries = [ledgerEntry({ ts: 't0', score: 0.85 }), ledgerEntry({ ts: 't1', score: 0.9 })];
  const report = buildCheckReport(summaries, 0, entries, 'default');
  assert.equal(report.exitCode, 0);
  assert.equal(report.results[0]!.verdict, 'CLEAN');
});

test('buildCheckReport: a FAIL run exits 1 (malformed/FAIL) even without a ledger baseline', () => {
  const summaries = [runSummary({ outcome: 'FAIL', score: 0.2 })];
  const entries = [ledgerEntry({ ts: 't0', score: 0.2 })]; // only one entry -> NEW, no baseline
  const report = buildCheckReport(summaries, 1, entries, 'default');
  assert.equal(report.exitCode, 1, 'FAIL run always takes the exit-1 path regardless of regression verdict');
});

test('buildCheckReport: a clean run (exit 0 from runEval) with a real score regression exits 2', () => {
  const summaries = [runSummary({ score: 0.5 })];
  const entries = [ledgerEntry({ ts: 't0', score: 0.95 }), ledgerEntry({ ts: 't1', score: 0.5 })];
  const report = buildCheckReport(summaries, 0, entries, 'default');
  assert.equal(report.exitCode, 2);
  assert.equal(report.results[0]!.verdict, 'REGRESSION');
});

test('buildCheckReport: FAIL run takes priority over exit 2 even when the score also regressed', () => {
  const summaries = [runSummary({ outcome: 'FAIL', score: 0.1 })];
  const entries = [ledgerEntry({ ts: 't0', score: 0.9 }), ledgerEntry({ ts: 't1', score: 0.1 })];
  const report = buildCheckReport(summaries, 1, entries, 'default');
  assert.equal(report.exitCode, 1, 'exit 1 (malformed/FAIL) must win over exit 2 (regression)');
});

test('buildCheckReport: judgeRan=false and anyJudgeRan=false when every case SKIPped the judge (offline CI default)', () => {
  const summaries = [
    runSummary({
      score: 0,
      counts: { pass: 2, warn: 0, fail: 0, skip: 0, total: 2 },
      results: [
        { caseId: 'a', suite: 'scaffold', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] }, judge: { outcome: 'SKIP', score: 0, dimensions: [], judgeModel: 'none', rubricVersion: 'none' }, latencyMs: 1 },
        { caseId: 'b', suite: 'scaffold', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] }, judge: { outcome: 'SKIP', score: 0, dimensions: [], judgeModel: 'none', rubricVersion: 'none' }, latencyMs: 1 },
      ],
    }),
  ];
  const entries = [ledgerEntry({ ts: 't0', score: 0 })];
  const report = buildCheckReport(summaries, 0, entries, 'default');
  assert.equal(report.anyJudgeApplicable, true, 'these cases DO attach a judge field (SKIP verdict) — judge is applicable, just unavailable');
  assert.equal(report.anyJudgeRan, false, 'a green offline run that judged nothing must report judge did NOT run');
  assert.equal(report.results[0]!.judgeApplicable, true);
  assert.equal(report.results[0]!.judgeRan, false);
});

test('buildCheckReport: judgeRan=true when at least one case produced a non-SKIP judge verdict', () => {
  const summaries = [
    runSummary({
      score: 0.8,
      results: [
        { caseId: 'a', suite: 'scaffold', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] }, judge: { outcome: 'PASS', score: 0.8, dimensions: [], judgeModel: 'claude', rubricVersion: 'v1' }, latencyMs: 1 },
      ],
    }),
  ];
  const entries = [ledgerEntry({ ts: 't0', score: 0.8 })];
  const report = buildCheckReport(summaries, 0, entries, 'default');
  assert.equal(report.anyJudgeRan, true);
  assert.equal(report.results[0]!.judgeRan, true);
});

test('buildCheckReport: judgeApplicable=false for a deterministic-only suite (no judge field on any case) — never counted as "judge skipped"', () => {
  const summaries = [
    runSummary({
      suite: 'analyze-diff',
      score: 0,
      results: [
        { caseId: 'a', suite: 'analyze-diff', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] }, latencyMs: 1 },
      ],
    }),
  ];
  const entries = [ledgerEntry({ suite: 'analyze-diff', ts: 't0', score: 0 })];
  const report = buildCheckReport(summaries, 0, entries, 'default');
  assert.equal(report.results[0]!.judgeApplicable, false);
  assert.equal(report.results[0]!.judgeRan, false);
  assert.equal(report.anyJudgeApplicable, false, 'a run of ONLY deterministic-only suites has no judge-applicable suite at all');
  assert.equal(report.anyJudgeRan, false);
});

test('buildCheckReport: multiple suites — one REGRESSION among otherwise-CLEAN suites still exits 2 overall', () => {
  const summaries = [runSummary({ suite: 'scaffold', score: 0.9 }), runSummary({ suite: 'evidence', score: 0.2 })];
  const entries = [
    ledgerEntry({ suite: 'scaffold', ts: 't0', score: 0.9 }),
    ledgerEntry({ suite: 'scaffold', ts: 't1', score: 0.9 }),
    ledgerEntry({ suite: 'evidence', ts: 't0', score: 0.95 }),
    ledgerEntry({ suite: 'evidence', ts: 't1', score: 0.2 }),
  ];
  const report = buildCheckReport(summaries, 0, entries, 'default');
  assert.equal(report.exitCode, 2);
  const scaffold = report.results.find((r) => r.suite === 'scaffold');
  const evidence = report.results.find((r) => r.suite === 'evidence');
  assert.equal(scaffold?.verdict, 'CLEAN');
  assert.equal(evidence?.verdict, 'REGRESSION');
});
