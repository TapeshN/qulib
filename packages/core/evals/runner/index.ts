/**
 * Eval runner entry point (Q2d) — wired to `npm run eval` in packages/core/package.json.
 *
 * Responsibilities (root doctrine #11 — everything ships wrapped in evaluation):
 *   1. Load + validate the golden corpus for each requested suite (load-cases.ts).
 *   2. Run each case through its suite executor: deterministic asserts always run;
 *      the LLM-judge runs only when configured (judge-bridge.ts), else SKIP.
 *   3. Roll up per suite (any FAIL ⇒ FAIL, any WARN ⇒ WARN, else PASS; rollup.ts).
 *   4. Append exactly one EvalLedgerEntry per suite to evals/ledger.jsonl.
 *   5. Print a typed PASS/WARN/FAIL/SKIP summary with the numeric judge score.
 *   6. Exit non-zero if ANY suite rolls up to FAIL, so CI can gate merges.
 *
 * Usage (from packages/core):
 *   npm run eval                      # all suites
 *   npm run eval -- --suite scaffold  # one suite
 *   npm run eval -- --no-ledger       # do not append to the ledger (used by tests)
 *
 * Honesty: an empty suite (no golden cases) rolls up to SKIP, not PASS — an empty
 * corpus is an acknowledged missing dependency, never a green light.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { EvalLedgerEntry, EvalRunSummary, EvalSuite } from '../types.js';
import { EVAL_SUITES, loadCases, ledgerPath } from './load-cases.js';
import { runScaffoldCase } from './run-scaffold.js';
import { runScoreAutomationCase } from './run-score-automation.js';
import { runConfidenceCase } from './run-confidence.js';
import { runEvidenceCase } from './run-evidence.js';
import { runAnalyzeDiffCase } from './run-analyze-diff.js';
import { runPromptLeakageCase } from './run-prompt-leakage.js';
import { runJudgmentCase, runJudgmentSelftest } from './run-judgment.js';
import { judgeConfigured, type JudgeImpl } from './judge-bridge.js';
import { summarize, toLedgerEntry, resolveTenantId } from './rollup.js';

const require = createRequire(import.meta.url);

export interface RunOptions {
  suites?: EvalSuite[];
  appendLedger?: boolean;
  /** Override the corpus root (tests point this at a fixture corpus). */
  goldenRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Inject a judge implementation (tests). Defaults to Q2c's real judge (SKIPs without a key). */
  judge?: JudgeImpl;
  /**
   * Tenant that owns this eval run. Stamped on every ledger entry.
   * Source precedence: explicit value here → env TAP_TENANT_ID → "default".
   * Never null/empty — guaranteed by resolveTenantId().
   */
  tenantId?: string;
}

function qulibVersion(): string {
  // package.json sits two levels up from evals/runner/ -> evals/ -> packages/core/.
  const pkg = require('../../package.json') as { version: string };
  return pkg.version;
}

/** Run one suite to a summary. Empty corpus ⇒ SKIP summary (not PASS). */
export async function runSuite(suite: EvalSuite, opts: RunOptions = {}): Promise<EvalRunSummary> {
  const startedAt = new Date().toISOString();
  if (suite === 'judgment') {
    const selftest = runJudgmentSelftest();
    if (!selftest.ok) {
      throw new Error(`judgment selftest failed before spend — aborting:\n${selftest.notes.join('\n')}`);
    }
  }
  const cases = loadCases(suite, opts.goldenRoot);
  const results = [];
  for (const c of cases) {
    if (suite === 'scaffold') results.push(await runScaffoldCase(c, opts.judge));
    else if (suite === 'score-automation') results.push(await runScoreAutomationCase(c, opts.judge));
    else if (suite === 'evidence') results.push(await runEvidenceCase(c, opts.judge));
    else if (suite === 'analyze-diff') results.push(await runAnalyzeDiffCase(c));
    else if (suite === 'prompt-leakage') results.push(await runPromptLeakageCase(c));
    else if (suite === 'judgment') results.push(await runJudgmentCase(c, opts.judge));
    else results.push(await runConfidenceCase(c, opts.judge));
  }
  const finishedAt = new Date().toISOString();
  const summary = summarize(suite, results, startedAt, finishedAt);
  // An empty corpus is SKIP, not PASS — never let "no cases" read as a pass.
  if (results.length === 0) summary.outcome = 'SKIP';
  return summary;
}

/** Run all requested suites, append the ledger, and return the summaries + exit code. */
export async function runEval(
  opts: RunOptions = {}
): Promise<{ summaries: EvalRunSummary[]; exitCode: number }> {
  const suites = opts.suites && opts.suites.length > 0 ? opts.suites : [...EVAL_SUITES];
  const appendLedger = opts.appendLedger ?? true;
  const version = qulibVersion();
  const tenantId = resolveTenantId(opts.tenantId, opts.env ?? process.env);
  const summaries: EvalRunSummary[] = [];

  for (const suite of suites) {
    const summary = await runSuite(suite, opts);
    summaries.push(summary);
    if (appendLedger) {
      const entry = toLedgerEntry(summary, version, tenantId);
      appendFileSync(ledgerPath(), `${JSON.stringify(entry)}\n`, 'utf8');
    }
  }

  // Exit non-zero iff any suite FAILs (CI merge gate). SKIP/WARN do not fail the gate.
  const exitCode = summaries.some((s) => s.outcome === 'FAIL') ? 1 : 0;
  return { summaries, exitCode };
}

function parseArgs(argv: string[]): { suites?: EvalSuite[]; appendLedger: boolean; selftest: boolean } {
  const suites: EvalSuite[] = [];
  let appendLedger = true;
  let selftest = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--selftest') {
      selftest = true;
    } else if (arg === '--suite') {
      const next = argv[i + 1];
      if (
        next === 'scaffold' ||
        next === 'score-automation' ||
        next === 'confidence' ||
        next === 'evidence' ||
        next === 'analyze-diff' ||
        next === 'prompt-leakage' ||
        next === 'judgment'
      ) {
        suites.push(next);
        i += 1;
      } else {
        throw new Error(`--suite must be one of: ${EVAL_SUITES.join(', ')}; got "${next ?? ''}"`);
      }
    } else if (arg === '--no-ledger') {
      appendLedger = false;
    }
  }
  return { suites: suites.length ? suites : undefined, appendLedger, selftest };
}

function printSummary(summaries: EvalRunSummary[], env: NodeJS.ProcessEnv): void {
  const judgeNote = judgeConfigured(env)
    ? 'judge: configured (ANTHROPIC_API_KEY present)'
    : 'judge: SKIP (no ANTHROPIC_API_KEY — deterministic asserts still gate)';
  console.log(`[qulib:eval] ${judgeNote}`);
  for (const s of summaries) {
    const { pass, warn, fail, skip, total } = s.counts;
    console.log(
      `[qulib:eval] ${s.suite}: ${s.outcome}  ` +
        `(${pass} pass / ${warn} warn / ${fail} fail / ${skip} skip of ${total})  ` +
        `judgeScore=${s.score.toFixed(3)}`
    );
    for (const r of s.results) {
      if (r.outcome === 'FAIL' || r.outcome === 'WARN') {
        const detail = r.deterministic.notes.filter((n) => n.startsWith('FAIL')).join('; ');
        console.log(`[qulib:eval]   - ${r.caseId}: ${r.outcome}${detail ? ` — ${detail}` : ''}`);
      }
    }
  }
  const overall = summaries.some((s) => s.outcome === 'FAIL')
    ? 'FAIL'
    : summaries.some((s) => s.outcome === 'WARN')
      ? 'WARN'
      : summaries.every((s) => s.outcome === 'SKIP')
        ? 'SKIP'
        : 'PASS';
  console.log(`[qulib:eval] ROLLUP: ${overall}`);
}

/** Count of ledger lines — small helper used by tests to assert append-once behavior. */
export function ledgerLineCount(path: string = ledgerPath()): number {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    return raw.length === 0 ? 0 : raw.split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Read all entries from a ledger file. Old records without a tenantId field
 * are returned with tenantId set to "legacy" — backward-compat, never rewritten.
 */
export function readLedger(path: string = ledgerPath()): EvalLedgerEntry[] {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw.length === 0) return [];
    return raw.split('\n').map((line) => {
      const entry = JSON.parse(line) as EvalLedgerEntry;
      if (!entry.tenantId) entry.tenantId = 'legacy';
      return entry;
    });
  } catch {
    return [];
  }
}

/**
 * Filter ledger entries by tenantId. Useful for per-tenant maturity tracking.
 * Old records (no tenantId) surface as "legacy" via readLedger().
 */
export function filterLedgerByTenant(tenantId: string, path: string = ledgerPath()): EvalLedgerEntry[] {
  return readLedger(path).filter((e) => e.tenantId === tenantId);
}

async function main(): Promise<void> {
  const { suites, appendLedger, selftest } = parseArgs(process.argv.slice(2));
  if (selftest) {
    const result = runJudgmentSelftest();
    for (const note of result.notes) console.log(`[qulib:eval:selftest] ${note}`);
    if (!result.ok) {
      console.error('[qulib:eval:selftest] ABORT — scorer miscalibrated');
      process.exit(1);
    }
    console.log('[qulib:eval:selftest] PASS');
    process.exit(0);
  }
  const { summaries, exitCode } = await runEval({ suites, appendLedger });
  printSummary(summaries, process.env);
  process.exit(exitCode);
}

// Direct-execution guard: run the CLI only when this file is the process entry
// (i.e. `node --import tsx/esm evals/runner/index.ts`), never on import (tests
// import runEval/runSuite directly without triggering process.exit).
if (process.argv[1] && /evals[\\/]+runner[\\/]+index\.(ts|js)$/.test(process.argv[1])) {
  void main();
}
