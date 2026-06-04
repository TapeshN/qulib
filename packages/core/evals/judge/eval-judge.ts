/**
 * Scored runner for the LLM-as-judge meta-eval (Q2c — eval-judge).
 *
 * Runs the judge against its golden corpus (judge-cases.ts) and scores AGREEMENT
 * with the gold labels. Emits a typed outcome (PASS/WARN/FAIL) + a numeric agreement
 * score in [0,1], and exits non-zero on a FAIL rollup so CI can gate (doctrine #11).
 *
 * Two modes:
 *   - OFFLINE (default when ANTHROPIC_API_KEY is unset, or with --offline): a stub
 *     LLM replays each case's hand-authored `stubDimensionScores` as a JSON reply,
 *     which is fed through the REAL parse → aggregate → threshold pipeline. This
 *     deterministically verifies the judge pipeline maps a competent scoring to the
 *     expected outcome — no network, runs in CI.
 *   - LIVE (ANTHROPIC_API_KEY set and not --offline): calls the actual pinned judge
 *     model and scores how often its verdict matches the gold label.
 *
 * Scoring: agreement = (#cases whose judged outcome == expectedOutcome) / (#graded).
 * Rollup outcome: agreement == 1 ⇒ PASS; >= warn threshold ⇒ WARN; else FAIL.
 * If LIVE is requested but unavailable, individual cases SKIP and the run reports
 * SKIP (acknowledged missing dependency) rather than a false FAIL.
 */

import type { EvalOutcome, JudgeVerdict } from '../types.js';
import { getRubric } from './rubrics.js';
import { buildScaffoldSubject, buildMaturitySubject } from './subjects.js';
import { runJudge, type JudgeLlm } from './judge.js';
import { JUDGE_GOLDEN_CASES, type JudgeGoldenCase } from './golden/judge-cases.js';

/** Agreement at/above this (but below 1.0) is WARN; below is FAIL. */
const WARN_AGREEMENT = 0.8;

export interface JudgeEvalCaseResult {
  caseId: string;
  suite: JudgeGoldenCase['suite'];
  expected: EvalOutcome;
  got: EvalOutcome;
  agree: boolean;
  score: number;
  rubricVersion: string;
}

export interface JudgeEvalSummary {
  outcome: EvalOutcome;
  /** Fraction of graded cases whose judged outcome matched the gold label, 0..1. */
  agreement: number;
  mode: 'offline' | 'live';
  counts: { total: number; agreed: number; skipped: number };
  results: JudgeEvalCaseResult[];
}

/** Build a stub `JudgeLlm` that replays a case's gold per-dimension scores as a JSON reply. */
function stubLlmFor(testCase: JudgeGoldenCase): JudgeLlm {
  const body = JSON.stringify({ dimensions: testCase.stubDimensionScores });
  return {
    model: 'offline-stub-judge',
    async call() {
      return {
        // Wrap in a fence + prose to also exercise the parser's tolerance path.
        text: `Here is my assessment:\n\`\`\`json\n${body}\n\`\`\`\n`,
        usage: { model: 'offline-stub-judge', inputTokens: 0, outputTokens: 0, dataQuality: 'estimated' as const },
      };
    },
  };
}

function buildSubject(testCase: JudgeGoldenCase) {
  return testCase.suite === 'scaffold'
    ? buildScaffoldSubject(testCase.subject)
    : buildMaturitySubject(testCase.subject);
}

/** Grade one golden case and compare to its gold label. */
async function gradeCase(testCase: JudgeGoldenCase, mode: 'offline' | 'live'): Promise<JudgeEvalCaseResult> {
  const rubric = getRubric(testCase.suite);
  const subject = buildSubject(testCase);

  let verdict: JudgeVerdict;
  if (mode === 'offline') {
    verdict = await runJudge(rubric, subject, { llm: stubLlmFor(testCase), skip: false });
  } else {
    verdict = await runJudge(rubric, subject, {});
  }

  return {
    caseId: testCase.id,
    suite: testCase.suite,
    expected: testCase.expectedOutcome,
    got: verdict.outcome,
    agree: verdict.outcome === testCase.expectedOutcome,
    score: verdict.score,
    rubricVersion: verdict.rubricVersion,
  };
}

export interface RunJudgeEvalOptions {
  /** Force offline even if a key is present. */
  offline?: boolean;
  /** Restrict to one suite. */
  suite?: JudgeGoldenCase['suite'];
}

/** Run the full judge meta-eval and return a scored summary. */
export async function runJudgeEval(options: RunJudgeEvalOptions = {}): Promise<JudgeEvalSummary> {
  const mode: 'offline' | 'live' = options.offline || !process.env.ANTHROPIC_API_KEY ? 'offline' : 'live';
  const cases = JUDGE_GOLDEN_CASES.filter((c) => !options.suite || c.suite === options.suite);

  const results: JudgeEvalCaseResult[] = [];
  for (const c of cases) {
    results.push(await gradeCase(c, mode));
  }

  // In live mode a SKIP verdict (no key mid-run) shouldn't count against agreement.
  const graded = results.filter((r) => r.got !== 'SKIP');
  const skipped = results.length - graded.length;
  const agreed = graded.filter((r) => r.agree).length;
  const agreement = graded.length === 0 ? 0 : Math.round((agreed / graded.length) * 1000) / 1000;

  let outcome: EvalOutcome;
  if (graded.length === 0) outcome = 'SKIP';
  else if (agreement >= 1) outcome = 'PASS';
  else if (agreement >= WARN_AGREEMENT) outcome = 'WARN';
  else outcome = 'FAIL';

  return {
    outcome,
    agreement,
    mode,
    counts: { total: results.length, agreed, skipped },
    results,
  };
}

/** Pretty one-line-per-case report. Pure string builder (testable). */
export function formatSummary(summary: JudgeEvalSummary): string {
  const lines = [
    `judge meta-eval — mode=${summary.mode} outcome=${summary.outcome} agreement=${(summary.agreement * 100).toFixed(0)}% (${summary.counts.agreed}/${summary.counts.total - summary.counts.skipped} graded, ${summary.counts.skipped} skipped)`,
  ];
  for (const r of summary.results) {
    const mark = r.got === 'SKIP' ? 'SKIP' : r.agree ? 'ok  ' : 'MISS';
    lines.push(`  [${mark}] ${r.suite}/${r.caseId} expected=${r.expected} got=${r.got} score=${r.score.toFixed(2)} (${r.rubricVersion})`);
  }
  return lines.join('\n');
}

/** CLI entry: `tsx evals/judge/eval-judge.ts [--offline] [--suite scaffold|score-automation]`. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const offline = argv.includes('--offline');
  const suiteIdx = argv.indexOf('--suite');
  const suite =
    suiteIdx !== -1 && (argv[suiteIdx + 1] === 'scaffold' || argv[suiteIdx + 1] === 'score-automation')
      ? (argv[suiteIdx + 1] as JudgeGoldenCase['suite'])
      : undefined;

  const summary = await runJudgeEval({ offline, suite });
  process.stdout.write(formatSummary(summary) + '\n');

  // Gate: FAIL exits non-zero so CI blocks a judge-pipeline regression. SKIP is exit 0.
  process.exit(summary.outcome === 'FAIL' ? 1 : 0);
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`judge meta-eval crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
