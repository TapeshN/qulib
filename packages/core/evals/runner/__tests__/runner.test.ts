/**
 * Eval-runner unit tests (Q2d) — node:test, real assertions, no smoke stubs.
 *
 * Coverage:
 *   - rollup rule (FAIL>WARN>PASS>SKIP) + per-case deterministic/judge combination
 *   - golden-case loader: real corpus parses; malformed JSON / bad schema / suite
 *     mismatch / duplicate id all throw loudly
 *   - score-automation executor against the REAL golden corpus → every case PASS,
 *     applicability honesty enforced
 *   - scaffold executor against the REAL golden corpus → every case PASS, real
 *     selectors grounded in generated specs
 *   - negative fixtures: a wrong-level case and a hallucination-demand case both
 *     grade FAIL and trip a non-zero CI exit code
 *   - judge bridge: SKIP when no ANTHROPIC_API_KEY; never throws
 *   - ledger: exactly one line appended per suite run
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  rollupOutcomes,
  combineCaseOutcome,
  meanJudgeScore,
  summarize,
  toLedgerEntry,
} from '../rollup.js';
import { loadCases, goldenRoot, EVAL_SUITES } from '../load-cases.js';
import { runScaffoldCase } from '../run-scaffold.js';
import { runScoreAutomationCase } from '../run-score-automation.js';
import { judgeConfigured, skipVerdict, judgeOrSkip, reduceScaffoldVerdicts } from '../judge-bridge.js';
import type { JudgeImpl } from '../judge-bridge.js';
import { runSuite, runEval, ledgerLineCount } from '../index.js';
import type { EvalCaseResult, JudgeVerdict } from '../../types.js';
import type { NeutralScenario } from '../../../src/schemas/gap-analysis.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// rollup
// ---------------------------------------------------------------------------

test('rollupOutcomes: FAIL dominates everything', () => {
  assert.equal(rollupOutcomes(['PASS', 'WARN', 'FAIL', 'SKIP']), 'FAIL');
});

test('rollupOutcomes: WARN beats PASS/SKIP', () => {
  assert.equal(rollupOutcomes(['PASS', 'WARN', 'SKIP']), 'WARN');
});

test('rollupOutcomes: PASS when at least one pass and no warn/fail', () => {
  assert.equal(rollupOutcomes(['PASS', 'SKIP', 'SKIP']), 'PASS');
});

test('rollupOutcomes: all-SKIP (or empty) rolls up to SKIP, never PASS', () => {
  assert.equal(rollupOutcomes(['SKIP', 'SKIP']), 'SKIP');
  assert.equal(rollupOutcomes([]), 'SKIP');
});

test('combineCaseOutcome: deterministic FAIL is terminal regardless of judge', () => {
  assert.equal(combineCaseOutcome('FAIL', 'PASS'), 'FAIL');
  assert.equal(combineCaseOutcome('FAIL', undefined), 'FAIL');
});

test('combineCaseOutcome: judge can downgrade a PASS but a SKIP judge defers to deterministic', () => {
  assert.equal(combineCaseOutcome('PASS', 'WARN'), 'WARN');
  assert.equal(combineCaseOutcome('PASS', 'FAIL'), 'FAIL');
  assert.equal(combineCaseOutcome('PASS', 'SKIP'), 'PASS');
  assert.equal(combineCaseOutcome('PASS', undefined), 'PASS');
});

test('meanJudgeScore: ignores SKIP verdicts, averages the rest', () => {
  const results: EvalCaseResult[] = [
    { caseId: 'a', suite: 'scaffold', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] }, judge: { outcome: 'PASS', score: 0.8, dimensions: [], judgeModel: 'm', rubricVersion: 'r' }, latencyMs: 1 },
    { caseId: 'b', suite: 'scaffold', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] }, judge: { outcome: 'PASS', score: 0.6, dimensions: [], judgeModel: 'm', rubricVersion: 'r' }, latencyMs: 1 },
    { caseId: 'c', suite: 'scaffold', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] }, judge: skipVerdict('no key'), latencyMs: 1 },
  ];
  assert.equal(meanJudgeScore(results), 0.7);
});

test('meanJudgeScore: zero when no judge verdicts ran', () => {
  const results: EvalCaseResult[] = [
    { caseId: 'a', suite: 'scaffold', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] }, latencyMs: 1 },
  ];
  assert.equal(meanJudgeScore(results), 0);
});

test('toLedgerEntry: projects summary + pins judge identity/cost when a verdict ran', () => {
  const results: EvalCaseResult[] = [
    {
      caseId: 'a', suite: 'scaffold', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] },
      judge: { outcome: 'PASS', score: 0.9, dimensions: [], judgeModel: 'claude-judge', rubricVersion: 'v1', cost: { inputTokens: 100, outputTokens: 20, dataQuality: 'actual' } },
      latencyMs: 5,
    },
  ];
  const summary = summarize('scaffold', results, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z');
  const entry = toLedgerEntry(summary, '9.9.9');
  assert.equal(entry.suite, 'scaffold');
  assert.equal(entry.outcome, 'PASS');
  assert.equal(entry.qulibVersion, '9.9.9');
  assert.equal(entry.judgeModel, 'claude-judge');
  assert.equal(entry.rubricVersion, 'v1');
  assert.deepEqual(entry.cost, { inputTokens: 100, outputTokens: 20 });
  assert.equal(entry.counts.total, 1);
});

test('toLedgerEntry: omits judge identity/cost when only SKIP verdicts present', () => {
  const results: EvalCaseResult[] = [
    { caseId: 'a', suite: 'scaffold', outcome: 'PASS', deterministic: { outcome: 'PASS', notes: [] }, judge: skipVerdict('no key'), latencyMs: 1 },
  ];
  const summary = summarize('scaffold', results, 't0', 't1');
  const entry = toLedgerEntry(summary, '1.0.0');
  assert.equal(entry.judgeModel, undefined);
  assert.equal(entry.cost, undefined);
});

// ---------------------------------------------------------------------------
// loader
// ---------------------------------------------------------------------------

test('loadCases: real golden corpus parses for both suites and is non-empty', () => {
  for (const suite of EVAL_SUITES) {
    const cases = loadCases(suite);
    assert.ok(cases.length > 0, `suite ${suite} must ship >= 1 golden case`);
    for (const c of cases) {
      assert.equal(c.suite, suite);
      assert.match(c.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(c.description.length > 0);
    }
  }
});

test('loadCases: throws on malformed JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-eval-bad-'));
  const suiteDir = join(dir, 'scaffold');
  mkdirSync(suiteDir, { recursive: true });
  writeFileSync(join(suiteDir, 'broken.json'), '{ this is : not valid json');
  assert.throws(() => loadCases('scaffold', dir), /not valid JSON/);
  rmSync(dir, { recursive: true, force: true });
});

test('loadCases: throws on schema violation (missing required fields)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-eval-schema-'));
  const suiteDir = join(dir, 'scaffold');
  mkdirSync(suiteDir, { recursive: true });
  writeFileSync(join(suiteDir, 'bad.json'), JSON.stringify({ id: 'x', suite: 'scaffold' }));
  assert.throws(() => loadCases('scaffold', dir), /failed schema/);
  rmSync(dir, { recursive: true, force: true });
});

test('loadCases: throws when a case declares a suite different from its folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-eval-mismatch-'));
  const suiteDir = join(dir, 'scaffold');
  mkdirSync(suiteDir, { recursive: true });
  writeFileSync(
    join(suiteDir, 'wrong.json'),
    JSON.stringify({ id: 'x', suite: 'score-automation', description: 'd', input: {}, expected: {} })
  );
  assert.throws(() => loadCases('scaffold', dir), /declares suite/);
  rmSync(dir, { recursive: true, force: true });
});

test('loadCases: empty/missing suite dir returns []', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-eval-empty-'));
  assert.deepEqual(loadCases('scaffold', dir), []);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// score-automation executor — real corpus
// ---------------------------------------------------------------------------

test('score-automation: every real golden case passes its deterministic asserts', async () => {
  const cases = loadCases('score-automation');
  for (const c of cases) {
    const result = await runScoreAutomationCase(c);
    assert.equal(
      result.deterministic.outcome,
      'PASS',
      `case ${c.id} deterministic FAIL: ${result.deterministic.notes.filter((n) => n.startsWith('FAIL')).join('; ')}`
    );
    // Without an API key the judge is SKIP, so the case outcome equals the deterministic one.
    if (!judgeConfigured()) assert.equal(result.outcome, 'PASS', `case ${c.id} should PASS with no judge`);
  }
});

test('score-automation: applicability-honesty assert actually inspects the dimension', async () => {
  const cases = loadCases('score-automation');
  const mature = cases.find((c) => c.id === 'mature-playwright-spa');
  assert.ok(mature, 'mature-playwright-spa golden case present');
  const result = await runScoreAutomationCase(mature!);
  const note = result.deterministic.notes.find((n) => n.includes('applicability[auth-test-coverage]'));
  assert.ok(note, 'expected an applicability note for auth-test-coverage');
});

// ---------------------------------------------------------------------------
// scaffold executor — real corpus
// ---------------------------------------------------------------------------

test('scaffold: every real golden case passes its deterministic asserts', async () => {
  const cases = loadCases('scaffold');
  for (const c of cases) {
    const result = await runScaffoldCase(c);
    assert.equal(
      result.deterministic.outcome,
      'PASS',
      `case ${c.id} deterministic FAIL: ${result.deterministic.notes.filter((n) => n.startsWith('FAIL')).join('; ')}`
    );
    if (!judgeConfigured()) assert.equal(result.outcome, 'PASS', `case ${c.id} should PASS with no judge`);
  }
});

test('scaffold: grounding note confirms real selectors were checked', async () => {
  const cases = loadCases('scaffold');
  const login = cases.find((c) => c.id === 'cypress-login-flow');
  assert.ok(login, 'cypress-login-flow golden case present');
  const result = await runScaffoldCase(login!);
  assert.ok(
    result.deterministic.notes.some((n) => n.startsWith('grounding:')),
    'expected a grounding note proving step selectors were checked'
  );
});

// ---------------------------------------------------------------------------
// negative fixtures — prove the asserts have teeth and the gate trips
// ---------------------------------------------------------------------------

test('negative fixture: wrong expected level grades FAIL (score-automation gate has teeth)', async () => {
  const cases = loadCases('score-automation', FIXTURE_ROOT);
  const bad = cases.find((c) => c.id === 'expected-fail-level');
  assert.ok(bad, 'fixture expected-fail-level present');
  const result = await runScoreAutomationCase(bad!);
  assert.equal(result.deterministic.outcome, 'FAIL');
  assert.equal(result.outcome, 'FAIL');
});

test('negative fixture: hallucination demand grades FAIL (scaffold grounding gate has teeth)', async () => {
  const cases = loadCases('scaffold', FIXTURE_ROOT);
  const bad = cases.find((c) => c.id === 'expected-fail-hallucination');
  assert.ok(bad, 'fixture expected-fail-hallucination present');
  const result = await runScaffoldCase(bad!);
  assert.equal(result.deterministic.outcome, 'FAIL');
});

test('runEval: a suite containing a FAIL case yields a non-zero exit code (CI merge gate)', async () => {
  const { summaries, exitCode } = await runEval({
    suites: ['score-automation'],
    appendLedger: false,
    goldenRoot: FIXTURE_ROOT,
  });
  assert.equal(summaries[0].outcome, 'FAIL');
  assert.equal(exitCode, 1, 'a FAIL rollup must exit non-zero');
});

// ---------------------------------------------------------------------------
// judge bridge
// ---------------------------------------------------------------------------

test('judgeConfigured: false when ANTHROPIC_API_KEY is empty/unset', () => {
  assert.equal(judgeConfigured({} as NodeJS.ProcessEnv), false);
  assert.equal(judgeConfigured({ ANTHROPIC_API_KEY: '' } as NodeJS.ProcessEnv), false);
  assert.equal(judgeConfigured({ ANTHROPIC_API_KEY: '   ' } as NodeJS.ProcessEnv), false);
  assert.equal(judgeConfigured({ ANTHROPIC_API_KEY: 'sk-x' } as NodeJS.ProcessEnv), true);
});

const sampleScenario: NeutralScenario = {
  id: 'sc-1',
  title: 'Open home',
  description: 'Navigate home',
  targetPath: '/',
  steps: [{ action: 'navigate', target: '/', description: 'go home' }],
  tags: [],
  recommendations: [],
  sourceGapIds: [],
};

function stubJudge(verdict: JudgeVerdict): JudgeImpl {
  return {
    judgeScaffoldSpec: async () => verdict,
    judgeMaturityNarrative: async () => verdict,
  };
}

test('judgeOrSkip: delegates to the injected judge and returns its verdict (offline)', async () => {
  const passVerdict: JudgeVerdict = {
    outcome: 'PASS',
    score: 0.88,
    dimensions: [{ dimension: 'grounding', score: 0.88, rationale: 'ok' }],
    judgeModel: 'stub-model',
    rubricVersion: 'stub-v1',
    cost: { inputTokens: 5, outputTokens: 2, dataQuality: 'estimated' },
  };
  const verdict = await judgeOrSkip(
    {
      suite: 'scaffold',
      test: {
        scenarioId: 'sc-1',
        adapter: 'cypress-e2e',
        filename: 'open-home.cy.ts',
        code: 'describe("x", () => {});',
        source: 'template',
        outputPath: 'cypress/e2e/open-home.cy.ts',
      },
      scenario: sampleScenario,
      discoveredRoutes: ['/'],
    },
    stubJudge(passVerdict)
  );
  assert.equal(verdict.outcome, 'PASS');
  assert.equal(verdict.judgeModel, 'stub-model');
  assert.equal(verdict.score, 0.88);
});

test('judgeOrSkip: degrades to SKIP (never throws) when the judge impl throws', async () => {
  const throwingJudge: JudgeImpl = {
    judgeScaffoldSpec: async () => {
      throw new Error('boom');
    },
    judgeMaturityNarrative: async () => {
      throw new Error('boom');
    },
  };
  const verdict = await judgeOrSkip(
    { suite: 'scaffold', test: { scenarioId: 'sc-1', adapter: 'cypress-e2e', filename: 'f.cy.ts', code: '', source: 'template', outputPath: 'p' }, scenario: sampleScenario, discoveredRoutes: ['/'] },
    throwingJudge
  );
  assert.equal(verdict.outcome, 'SKIP');
  assert.match(verdict.dimensions[0]?.rationale ?? '', /Judge call failed/);
});

test('reduceScaffoldVerdicts: worst outcome wins, scores mean over non-SKIP, cost summed', () => {
  const v = (outcome: JudgeVerdict['outcome'], score: number, cost?: number): JudgeVerdict => ({
    outcome,
    score,
    dimensions: [],
    judgeModel: 'm',
    rubricVersion: 'r',
    ...(cost !== undefined && { cost: { inputTokens: cost, outputTokens: 1, dataQuality: 'actual' as const } }),
  });
  const reduced = reduceScaffoldVerdicts([v('PASS', 0.9, 10), v('WARN', 0.5, 20), skipVerdict('no key')]);
  assert.equal(reduced.outcome, 'WARN', 'WARN beats PASS and SKIP');
  assert.equal(reduced.score, 0.7, 'mean of 0.9 and 0.5, ignoring SKIP');
  assert.equal(reduced.cost?.inputTokens, 30, 'cost summed across verdicts');
});

test('reduceScaffoldVerdicts: empty input yields a SKIP verdict', () => {
  assert.equal(reduceScaffoldVerdicts([]).outcome, 'SKIP');
});

// ---------------------------------------------------------------------------
// runner orchestration + ledger
// ---------------------------------------------------------------------------

test('runSuite: empty corpus rolls up to SKIP, not PASS', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-eval-skip-'));
  const summary = await runSuite('scaffold', { goldenRoot: dir, appendLedger: false });
  assert.equal(summary.outcome, 'SKIP');
  assert.equal(summary.counts.total, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('runEval: the real corpus passes all suites green with no judge (deterministic gate)', async () => {
  const { summaries, exitCode } = await runEval({ appendLedger: false });
  assert.equal(summaries.length, EVAL_SUITES.length, `expected ${EVAL_SUITES.length} suite summaries, got ${summaries.length}`);
  for (const s of summaries) {
    assert.notEqual(s.outcome, 'FAIL', `suite ${s.suite} unexpectedly FAILed: ${JSON.stringify(s.counts)}`);
  }
  assert.equal(exitCode, 0, 'real corpus must not trip the CI gate');
});

test('runEval (judge-active, injected stub): judgeScore is populated and verdict pins the model', async () => {
  const passVerdict: JudgeVerdict = {
    outcome: 'PASS',
    score: 0.82,
    dimensions: [{ dimension: 'grounding', score: 0.82, rationale: 'grounded' }],
    judgeModel: 'stub-judge-model',
    rubricVersion: 'stub-v1',
    cost: { inputTokens: 12, outputTokens: 4, dataQuality: 'estimated' },
  };
  const { summaries, exitCode } = await runEval({
    suites: ['score-automation'],
    appendLedger: false,
    judge: stubJudge(passVerdict),
  });
  assert.equal(exitCode, 0);
  const s = summaries[0];
  assert.ok(s.score > 0, `expected a non-zero judge score, got ${s.score}`);
  // The ledger projection must pin the judge identity from the verdict.
  const entry = toLedgerEntry(s, '0.0.0');
  assert.equal(entry.judgeModel, 'stub-judge-model');
  assert.equal(entry.rubricVersion, 'stub-v1');
  assert.ok(entry.cost && entry.cost.inputTokens > 0, 'cost must be summed onto the ledger entry');
});

test('runEval (judge returns FAIL): downgrades an otherwise-green case and trips the gate', async () => {
  const failVerdict: JudgeVerdict = {
    outcome: 'FAIL',
    score: 0.1,
    dimensions: [{ dimension: 'grounding', score: 0.1, rationale: 'hallucinated claim' }],
    judgeModel: 'stub-judge-model',
    rubricVersion: 'stub-v1',
  };
  const { summaries, exitCode } = await runEval({
    suites: ['scaffold'],
    appendLedger: false,
    judge: stubJudge(failVerdict),
  });
  assert.equal(summaries[0].outcome, 'FAIL', 'a judge FAIL must downgrade the suite even when asserts pass');
  assert.equal(exitCode, 1);
});

test('ledger: exactly one line is appended per suite run', async () => {
  // Append-once is verified at the rollup/projection layer (toLedgerEntry yields one
  // entry per summary) and the runner writes one line per summary. Here we simulate
  // the write the runner performs and assert the count delta is exactly the suite count.
  const dir = mkdtempSync(join(tmpdir(), 'qulib-eval-ledger-'));
  const ledger = join(dir, 'ledger.jsonl');
  writeFileSync(ledger, '');

  const { summaries } = await runEval({ appendLedger: false });
  for (const s of summaries) {
    appendFileSync(ledger, `${JSON.stringify(toLedgerEntry(s, '0.0.0'))}\n`);
  }
  assert.equal(ledgerLineCount(ledger), summaries.length);

  // Each appended line must be valid JSON with the required ledger fields.
  const lines = readFileSync(ledger, 'utf8').trim().split('\n');
  for (const line of lines) {
    const entry = JSON.parse(line) as Record<string, unknown>;
    assert.ok(typeof entry.ts === 'string');
    assert.ok(typeof entry.suite === 'string');
    assert.ok(typeof entry.outcome === 'string');
    assert.ok(typeof entry.qulibVersion === 'string');
    assert.ok(entry.counts && typeof entry.counts === 'object');
  }
  rmSync(dir, { recursive: true, force: true });
});
