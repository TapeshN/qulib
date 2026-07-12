/**
 * Regression gate for the eval ledger (`evals/ledger.jsonl`) — the CI merge gate.
 *
 * `npm run eval:check` (wired below) runs the OFFLINE eval slice (`runEval`) and then
 * compares the freshly-appended score for each suite against that suite's PRIOR
 * ledger entry (the baseline). Shape: versioned goldens + a zero-network runner + a
 * `--check`-style gate with DISTINCT exit codes for "malformed" vs "regressed", built
 * on top of qulib's existing TS eval runner (`evals/runner/index.ts`) rather than a
 * second harness.
 *
 * Exit codes (hand-triggerable via `npm run eval:check` — see package.json):
 *   0 — clean: every suite is PASS/SKIP and no suite regressed vs its ledger baseline.
 *   1 — malformed: a golden case failed to load/parse, OR any suite rolled up FAIL on
 *       this run (a real eval failure, not a regression-vs-baseline call).
 *   2 — regression: at least one suite's score dropped vs its ledger baseline by more
 *       than REGRESSION_MARGIN (a WARN-drop or worse — see classifyRegression).
 *
 * A suite with fewer than two ledger entries (first run ever) cannot regress by
 * definition — it reports NEW, not PASS-by-default-and-not-FAIL either; NEW never
 * blocks the gate.
 *
 * LLM-judge cases: the runner's `score` field is the MEAN JUDGE SCORE across non-SKIP
 * cases (rollup.ts `meanJudgeScore`) — it is 0 whenever the judge never ran (no
 * ANTHROPIC_API_KEY), which is the offline default in CI. That 0 is NOT compared as
 * "the judge regressed" here: `judgeRan` is read straight off the just-produced
 * EvalRunSummary counts (a non-SKIP judge verdict exists) and threaded into the
 * printed line so a green run that judged nothing reads as visibly
 * "N skipped (judge did not run)", never a silent pass. The deterministic
 * PASS/WARN/FAIL rollup — which the judge can only ever downgrade, never rescue
 * (see rollup.ts `combineCaseOutcome`) — is what actually gates.
 */
import { runEval, readLedger } from './index.js';
import type { EvalLedgerEntry, EvalRunSummary, EvalSuite } from '../types.js';

/** Minimum absolute score drop (in [0,1]) to call a suite's ledger delta a REGRESSION. */
export const REGRESSION_MARGIN = 0.05;

export type SuiteVerdict = 'CLEAN' | 'REGRESSION' | 'NEW';

export interface SuiteCheckResult {
  suite: EvalSuite;
  verdict: SuiteVerdict;
  latestScore: number;
  baselineScore: number | null;
  delta: number | null;
  runOutcome: EvalRunSummary['outcome'];
  /** True when >=1 case in this suite attaches a `judge` verdict field at all (scaffold/score-automation/confidence/evidence do; analyze-diff/prompt-leakage/provenance never do — deterministic-only by design). */
  judgeApplicable: boolean;
  /** True when >=1 case produced a non-SKIP judge verdict (the judge actually ran, not just was eligible). */
  judgeRan: boolean;
  skipCount: number;
  totalCount: number;
  reason: string;
  /** Mirrors EvalRunSummary.falsePositiveRate (see rollup.ts) — undefined when this suite has no clean-twin cases. */
  falsePositiveRate?: number;
}

export interface CheckReport {
  results: SuiteCheckResult[];
  /** 0 clean, 1 malformed/FAIL, 2 regression. */
  exitCode: 0 | 1 | 2;
  /** True when the judge ran (non-SKIP verdict) for at least one case across all judge-applicable suites. */
  anyJudgeRan: boolean;
  /** True when at least one suite in this run even attaches a judge field (lets the report distinguish "no judge configured" from "no suite calls a judge at all"). */
  anyJudgeApplicable: boolean;
}

/**
 * Find the ledger entry immediately BEFORE the just-appended one for this suite,
 * scoped to the same tenant so a multi-tenant ledger never compares across tenants.
 * `allEntries` is the full ledger read AFTER this run's append, in file order
 * (oldest first) — the baseline is the second-to-last entry for (suite, tenant).
 * Exported (pure, no I/O) so tests can exercise it against hand-built ledger arrays
 * without touching the real evals/ledger.jsonl file.
 */
export function findBaseline(
  allEntries: EvalLedgerEntry[],
  suite: EvalSuite,
  tenantId: string
): EvalLedgerEntry | null {
  const forSuite = allEntries.filter((e) => e.suite === suite && (e.tenantId ?? 'legacy') === tenantId);
  // forSuite[forSuite.length - 1] is the run we just appended; the one before it
  // (if any) is the baseline to compare against.
  if (forSuite.length < 2) return null;
  return forSuite[forSuite.length - 2];
}

/** Classify one suite's latest-vs-baseline delta. Pure — no I/O, unit-testable in isolation. */
export function classifySuiteDelta(
  latestScore: number,
  baselineScore: number | null,
  runOutcome: EvalRunSummary['outcome'],
  margin: number = REGRESSION_MARGIN
): { verdict: SuiteVerdict; delta: number | null; reason: string } {
  if (baselineScore === null) {
    return { verdict: 'NEW', delta: null, reason: 'no prior ledger entry for this suite — first run, nothing to regress against' };
  }
  const delta = Number((latestScore - baselineScore).toFixed(4));
  if (runOutcome === 'FAIL') {
    // A FAIL rollup is reported via the malformed/FAIL exit path (exit 1), not
    // double-counted as a score regression here — classifyRegression() below
    // decides the exit code from BOTH runOutcome and this verdict.
    return { verdict: delta < -margin ? 'REGRESSION' : 'CLEAN', delta, reason: `suite rolled up FAIL this run (delta=${delta >= 0 ? '+' : ''}${delta})` };
  }
  if (delta < -margin) {
    return {
      verdict: 'REGRESSION',
      delta,
      reason: `score dropped ${baselineScore.toFixed(4)} -> ${latestScore.toFixed(4)} (delta=${delta.toFixed(4)}, exceeds margin=${margin})`,
    };
  }
  return {
    verdict: 'CLEAN',
    delta,
    reason: `score held or improved: ${baselineScore.toFixed(4)} -> ${latestScore.toFixed(4)} (delta=${delta >= 0 ? '+' : ''}${delta.toFixed(4)})`,
  };
}

/**
 * Pure report builder: given this run's summaries + the FULL ledger (read after this
 * run's own entries were appended) + tenant + margin, produce the typed CheckReport.
 * No I/O — the seam runCheck() and tests both call into, so the exit-code/verdict
 * logic is unit-testable against hand-built ledger fixtures (mirrors how
 * classifySuiteDelta/findBaseline are each independently pure+exported).
 */
export function buildCheckReport(
  summaries: EvalRunSummary[],
  runExitCode: number,
  allEntries: EvalLedgerEntry[],
  tenantId: string,
  margin: number = REGRESSION_MARGIN
): CheckReport {
  const results: SuiteCheckResult[] = summaries.map((summary) => {
    const baseline = findBaseline(allEntries, summary.suite, tenantId);
    const { verdict, delta, reason } = classifySuiteDelta(summary.score, baseline?.score ?? null, summary.outcome, margin);
    const judgeApplicable = summary.results.some((r) => r.judge !== undefined);
    const judgeRan = summary.results.some((r) => r.judge && r.judge.outcome !== 'SKIP');
    return {
      suite: summary.suite,
      verdict,
      latestScore: summary.score,
      baselineScore: baseline?.score ?? null,
      delta,
      runOutcome: summary.outcome,
      judgeApplicable,
      judgeRan,
      skipCount: summary.counts.skip,
      totalCount: summary.counts.total,
      reason,
      falsePositiveRate: summary.falsePositiveRate,
    };
  });

  // "judge ran" is only meaningful for judge-applicable suites — a deterministic-only
  // suite (analyze-diff/prompt-leakage/provenance) never counts against "did the judge
  // run", it simply has no judge to run.
  const judgeApplicableResults = results.filter((r) => r.judgeApplicable);
  const anyJudgeApplicable = judgeApplicableResults.length > 0;
  const anyJudgeRan = judgeApplicableResults.some((r) => r.judgeRan);
  const anyRegression = results.some((r) => r.verdict === 'REGRESSION');
  // runExitCode is non-zero exactly when some suite rolled up FAIL (index.ts runEval) —
  // that is a malformed/broken-golden signal, distinct from a ledger-baseline regression,
  // and takes priority: a FAIL run is never merely a "regression" (exit 2), it's exit 1.
  const exitCode: 0 | 1 | 2 = runExitCode !== 0 ? 1 : anyRegression ? 2 : 0;

  return { results, exitCode, anyJudgeRan, anyJudgeApplicable };
}

/**
 * Run the full offline eval + regression check. Always appends to the ledger (the
 * check needs its own run's entry to exist before it can read "latest vs baseline").
 */
export async function runCheck(opts: { env?: NodeJS.ProcessEnv; tenantId?: string; margin?: number } = {}): Promise<CheckReport> {
  const env = opts.env ?? process.env;
  const margin = opts.margin ?? REGRESSION_MARGIN;

  const { summaries, exitCode: runExitCode } = await runEval({ env, tenantId: opts.tenantId, appendLedger: true });
  const tenantId = env['TAP_TENANT_ID']?.trim() || opts.tenantId || 'default';
  const allEntries = readLedger();

  return buildCheckReport(summaries, runExitCode, allEntries, tenantId, margin);
}

function printReport(report: CheckReport, env: NodeJS.ProcessEnv): void {
  const judgeNote = env.ANTHROPIC_API_KEY
    ? 'judge: configured (ANTHROPIC_API_KEY present)'
    : 'judge: SKIP (no ANTHROPIC_API_KEY — offline slice only, deterministic asserts still gate)';
  console.log(`[qulib:eval:check] ${judgeNote}`);
  for (const r of report.results) {
    const judgeTag = !r.judgeApplicable
      ? 'judge=n/a (deterministic-only suite)'
      : r.judgeRan
        ? 'judge=ran'
        : `judge=SKIPPED (no ANTHROPIC_API_KEY; ${r.totalCount} case(s) not judged)`;
    const fpTag = r.falsePositiveRate === undefined ? '' : `  falsePositiveRate=${r.falsePositiveRate.toFixed(3)}`;
    console.log(
      `[qulib:eval:check] ${r.suite}: ${r.verdict}  runOutcome=${r.runOutcome}  ${judgeTag}${fpTag}  — ${r.reason}`
    );
  }
  const judgeSummary = !report.anyJudgeApplicable
    ? 'no suite in this run calls the judge at all (all deterministic-only)'
    : report.anyJudgeRan
      ? 'judge ran for at least one case'
      : 'judge SKIPPED for every judge-applicable suite — this run judged NOTHING (counted + named, not a silent pass)';
  console.log(`[qulib:eval:check] judge summary: ${judgeSummary}`);
  const verdictLine =
    report.exitCode === 0 ? 'CLEAN (exit 0)' : report.exitCode === 1 ? 'MALFORMED/FAIL (exit 1)' : 'REGRESSION (exit 2)';
  console.log(`[qulib:eval:check] GATE: ${verdictLine}`);
}

async function main(): Promise<void> {
  try {
    const report = await runCheck();
    printReport(report, process.env);
    process.exit(report.exitCode);
  } catch (err) {
    // A thrown error (e.g. malformed golden case JSON) is the "malformed" class — exit 1,
    // never exit 2 (2 is reserved for a real baseline regression on a run that itself
    // parsed and executed cleanly).
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[qulib:eval:check] MALFORMED: eval run crashed before producing a report: ${message}`);
    process.exit(1);
  }
}

// Direct-execution guard, matching runner/index.ts's convention.
if (process.argv[1] && /evals[\\/]+runner[\\/]+check\.(ts|js)$/.test(process.argv[1])) {
  void main();
}
