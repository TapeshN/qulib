/**
 * Pure rollup + ledger helpers for the eval runner (Q2d). No I/O here — kept pure so
 * the rollup rule (root doctrine #6) is unit-testable in isolation.
 *
 * Rollup rule (also in types.ts / README): any FAIL ⇒ FAIL, else any WARN ⇒ WARN,
 * else if there is at least one PASS ⇒ PASS, else (all SKIP / empty) ⇒ SKIP.
 */
import type {
  EvalCaseResult,
  EvalLedgerEntry,
  EvalOutcome,
  EvalRunSummary,
} from '../types.js';

/** Combine many typed outcomes into one. FAIL dominates, then WARN, then PASS, else SKIP. */
export function rollupOutcomes(outcomes: EvalOutcome[]): EvalOutcome {
  if (outcomes.some((o) => o === 'FAIL')) return 'FAIL';
  if (outcomes.some((o) => o === 'WARN')) return 'WARN';
  if (outcomes.some((o) => o === 'PASS')) return 'PASS';
  return 'SKIP';
}

/** Combine a deterministic outcome with an (optional) judge outcome for one case. */
export function combineCaseOutcome(
  deterministic: EvalOutcome,
  judge?: EvalOutcome
): EvalOutcome {
  // A failed deterministic assert is always a case FAIL regardless of the judge.
  if (deterministic === 'FAIL') return 'FAIL';
  // The judge cannot rescue a WARN deterministic result, but a judge FAIL/WARN can
  // downgrade an otherwise-PASS case. SKIP judge ⇒ defer to the deterministic outcome.
  if (judge === undefined || judge === 'SKIP') return deterministic;
  return rollupOutcomes([deterministic, judge]);
}

function countOutcomes(results: EvalCaseResult[]): EvalRunSummary['counts'] {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0, total: results.length };
  for (const r of results) {
    if (r.outcome === 'PASS') counts.pass += 1;
    else if (r.outcome === 'WARN') counts.warn += 1;
    else if (r.outcome === 'FAIL') counts.fail += 1;
    else counts.skip += 1;
  }
  return counts;
}

/** Mean judge score across cases that actually produced a non-SKIP judge verdict (0..1). */
export function meanJudgeScore(results: EvalCaseResult[]): number {
  const scored = results.filter((r) => r.judge && r.judge.outcome !== 'SKIP');
  if (scored.length === 0) return 0;
  const sum = scored.reduce((acc, r) => acc + (r.judge?.score ?? 0), 0);
  return Number((sum / scored.length).toFixed(4));
}

/** Build the run summary for one suite from its case results. */
export function summarize(
  suite: EvalRunSummary['suite'],
  results: EvalCaseResult[],
  startedAt: string,
  finishedAt: string
): EvalRunSummary {
  return {
    suite,
    outcome: rollupOutcomes(results.map((r) => r.outcome)),
    score: meanJudgeScore(results),
    counts: countOutcomes(results),
    results,
    startedAt,
    finishedAt,
  };
}

/**
 * Resolve the tenantId from options or env, falling back to "default".
 * Never returns null or empty — "default" is the guaranteed fallback.
 */
export function resolveTenantId(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const fromEnv = env['TAP_TENANT_ID'];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return 'default';
}

/** Pinned USD-per-token rates for judge cost ledger projection (Sonnet-class judge). */
const JUDGE_INPUT_USD_PER_TOKEN = 3 / 1_000_000;
const JUDGE_OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;

/** Project a run summary into the single append-only ledger line. */
export function toLedgerEntry(
  summary: EvalRunSummary,
  qulibVersion: string,
  tenantId: string = 'default'
): EvalLedgerEntry {
  // Pull pinned judge identity + total cost from the first verdict that actually ran.
  const judged = summary.results.find((r) => r.judge && r.judge.outcome !== 'SKIP')?.judge;
  const cost = summary.results.reduce(
    (acc, r) => {
      if (r.judge?.cost) {
        acc.inputTokens += r.judge.cost.inputTokens;
        acc.outputTokens += r.judge.cost.outputTokens;
        acc.any = true;
      }
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, any: false }
  );

  const startedMs = Date.parse(summary.startedAt);
  const finishedMs = Date.parse(summary.finishedAt);
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(finishedMs) ? Math.max(0, finishedMs - startedMs) : undefined;

  const entry: EvalLedgerEntry = {
    ts: summary.finishedAt,
    suite: summary.suite,
    outcome: summary.outcome,
    score: summary.score,
    counts: summary.counts,
    qulibVersion,
    tenantId,
  };
  if (durationMs !== undefined) entry.durationMs = durationMs;
  if (judged) {
    entry.judgeModel = judged.judgeModel;
    entry.rubricVersion = judged.rubricVersion;
  }
  if (cost.any) {
    entry.cost = { inputTokens: cost.inputTokens, outputTokens: cost.outputTokens };
    entry.judgeInputTokens = cost.inputTokens;
    entry.judgeOutputTokens = cost.outputTokens;
    entry.judgeCostUsd =
      Math.round((cost.inputTokens * JUDGE_INPUT_USD_PER_TOKEN + cost.outputTokens * JUDGE_OUTPUT_USD_PER_TOKEN) * 1_000_000) /
      1_000_000;
  }
  return entry;
}
