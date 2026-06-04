/**
 * Unit tests for the LLM-as-judge (Q2c — eval-judge).
 *
 * Mirrors qulib's test spine: `node --import tsx/esm --test` with node:assert/strict.
 * Fully OFFLINE — every judge call uses an injected stub `JudgeLlm`, so no network /
 * no ANTHROPIC_API_KEY required. Real assertions on grounding, parsing, scoring,
 * the SKIP path, the self-grade guard, and cost recording — not smoke checks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_RUBRICS,
  getRubric,
  scoreToOutcome,
  validateRubric,
  SCAFFOLD_RUBRIC_V1,
} from '../rubrics.js';
import { buildJudgePrompt, parseJudgeResponse } from '../prompt.js';
import { buildScaffoldSubject, buildMaturitySubject } from '../subjects.js';
import { aggregate, runJudge, judgeScaffoldSpec, DEFAULT_JUDGE_MODEL, type JudgeLlm } from '../judge.js';
import { runJudgeEval, formatSummary } from '../eval-judge.js';
import { JUDGE_GOLDEN_CASES } from '../golden/judge-cases.js';
import type { GeneratedTest, NeutralScenario } from '../../../src/schemas/gap-analysis.schema.js';
import type { AutomationMaturity } from '../../../src/schemas/automation-maturity.schema.js';

/** A stub LLM that returns a fixed reply and records the prompt it was called with. */
function stubLlm(reply: string, model = 'stub-judge'): JudgeLlm & { lastPrompt?: string } {
  const self: JudgeLlm & { lastPrompt?: string } = {
    model,
    async call(prompt: string) {
      self.lastPrompt = prompt;
      return {
        text: reply,
        usage: { model, inputTokens: 123, outputTokens: 45, dataQuality: 'actual' as const },
      };
    },
  };
  return self;
}

const SCENARIO: NeutralScenario = {
  id: 'scn-1',
  title: 'login renders',
  description: 'verify sign-in form',
  targetPath: '/login',
  steps: [{ action: 'navigate', target: '/login', description: 'go to /login' }],
  tags: ['auth'],
  recommendations: [{ adapter: 'playwright', reason: 'r', confidence: 'low' }],
  sourceGapIds: ['g1'],
};

const GOOD_TEST: GeneratedTest = {
  scenarioId: 'scn-1',
  adapter: 'playwright',
  filename: 'login.spec.ts',
  code: `await page.goto('/login'); await expect(page.getByRole('button')).toBeVisible();`,
  source: 'template',
  outputPath: 'tests/login.spec.ts',
};

// ---------------------------------------------------------------------------
// Rubrics
// ---------------------------------------------------------------------------

test('every published rubric is internally valid (weights sum to 1, thresholds ordered)', () => {
  for (const r of ALL_RUBRICS) {
    assert.equal(validateRubric(r), null, `rubric ${r.version} should be valid`);
  }
});

test('getRubric returns the pinned rubric per suite and throws on unknown', () => {
  assert.equal(getRubric('scaffold').version, 'scaffold-v1');
  assert.equal(getRubric('score-automation').version, 'score-automation-v1');
  // @ts-expect-error — exercising the runtime guard for an unregistered suite.
  assert.throws(() => getRubric('nope'));
});

test('validateRubric rejects weights that do not sum to 1', () => {
  const bad = { ...SCAFFOLD_RUBRIC_V1, dimensions: SCAFFOLD_RUBRIC_V1.dimensions.map((d) => ({ ...d, weight: 0.1 })) };
  assert.match(validateRubric(bad)!, /weights sum/);
});

test('scoreToOutcome maps bands and lets a critical dim force FAIL', () => {
  // High aggregate but a critical dimension at the floor ⇒ FAIL.
  const failed = scoreToOutcome(SCAFFOLD_RUBRIC_V1, 0.95, [
    { key: 'no-hallucinated-routes', score: 0 },
    { key: 'meaningful-assertions', score: 1 },
    { key: 'real-selectors', score: 1 },
  ]);
  assert.equal(failed, 'FAIL', 'critical floor must override a high aggregate');

  // Clean bands.
  const allGood = [
    { key: 'no-hallucinated-routes', score: 1 },
    { key: 'meaningful-assertions', score: 1 },
    { key: 'real-selectors', score: 1 },
  ];
  assert.equal(scoreToOutcome(SCAFFOLD_RUBRIC_V1, 0.85, allGood), 'PASS');
  assert.equal(scoreToOutcome(SCAFFOLD_RUBRIC_V1, 0.7, allGood), 'WARN');
  assert.equal(scoreToOutcome(SCAFFOLD_RUBRIC_V1, 0.4, allGood), 'FAIL');
});

// ---------------------------------------------------------------------------
// Prompt + parsing
// ---------------------------------------------------------------------------

test('buildJudgePrompt embeds rubric dimensions, grounding, candidate, and demands JSON', () => {
  const subject = buildScaffoldSubject({ test: GOOD_TEST, scenario: SCENARIO, discoveredRoutes: ['/', '/login'] });
  const prompt = buildJudgePrompt(SCAFFOLD_RUBRIC_V1, subject);
  assert.ok(prompt.includes('no-hallucinated-routes'), 'lists the critical dimension key');
  assert.ok(prompt.includes('/login'), 'includes the discovered route grounding');
  assert.ok(prompt.includes(GOOD_TEST.code), 'includes the candidate spec verbatim');
  assert.ok(/ONLY a JSON object/i.test(prompt), 'demands strict JSON output');
  assert.ok(/did NOT write the artifact/i.test(prompt), 'frames the candidate as external data, not its own turn');
});

test('parseJudgeResponse tolerates a fenced block with surrounding prose', () => {
  const raw = 'Sure!\n```json\n{"dimensions":[{"key":"a","score":0.5,"rationale":"x"}]}\n```\nDone.';
  const parsed = parseJudgeResponse(raw);
  assert.equal(parsed.dimensions.length, 1);
  assert.equal(parsed.dimensions[0]!.key, 'a');
  assert.equal(parsed.dimensions[0]!.score, 0.5);
});

test('parseJudgeResponse extracts a bare object embedded in prose', () => {
  const raw = 'Verdict: {"dimensions":[{"key":"a","score":1,"rationale":"ok"}]} — end';
  const parsed = parseJudgeResponse(raw);
  assert.equal(parsed.dimensions[0]!.key, 'a');
});

test('parseJudgeResponse clamps out-of-range and non-numeric scores to [0,1]', () => {
  const raw = '{"dimensions":[{"key":"hi","score":9,"rationale":""},{"key":"lo","score":-3,"rationale":""},{"key":"nan","score":"abc","rationale":""}]}';
  const parsed = parseJudgeResponse(raw);
  const byKey = Object.fromEntries(parsed.dimensions.map((d) => [d.key, d.score]));
  assert.equal(byKey.hi, 1);
  assert.equal(byKey.lo, 0);
  assert.equal(byKey.nan, 0);
});

test('parseJudgeResponse dedupes repeated keys (first wins) and drops keyless entries', () => {
  const raw = '{"dimensions":[{"key":"a","score":1,"rationale":"first"},{"key":"a","score":0,"rationale":"second"},{"score":0.5}]}';
  const parsed = parseJudgeResponse(raw);
  assert.equal(parsed.dimensions.length, 1);
  assert.equal(parsed.dimensions[0]!.score, 1, 'first occurrence wins');
});

test('parseJudgeResponse throws on empty, non-JSON, and shape-less replies', () => {
  assert.throws(() => parseJudgeResponse(''), /empty/);
  assert.throws(() => parseJudgeResponse('not json at all'), /not valid JSON|missing a "dimensions"/);
  assert.throws(() => parseJudgeResponse('{"foo":1}'), /missing a "dimensions" array/);
  assert.throws(() => parseJudgeResponse('{"dimensions":[]}'), /no usable dimension/);
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test('aggregate computes the weighted score and penalizes an omitted dimension as 0', () => {
  const { score, dimensions } = aggregate(SCAFFOLD_RUBRIC_V1, [
    { key: 'no-hallucinated-routes', score: 1, rationale: '' },
    { key: 'meaningful-assertions', score: 1, rationale: '' },
    // real-selectors omitted on purpose
  ]);
  // 1*0.4 + 1*0.35 + 0*0.25 = 0.75
  assert.equal(score, 0.75);
  const sel = dimensions.find((d) => d.dimension === 'real-selectors')!;
  assert.equal(sel.score, 0);
  assert.match(sel.rationale, /omitted/);
});

test('aggregate of all-1 scores yields 1.0 (weights normalized)', () => {
  const { score } = aggregate(SCAFFOLD_RUBRIC_V1, SCAFFOLD_RUBRIC_V1.dimensions.map((d) => ({ key: d.key, score: 1, rationale: '' })));
  assert.equal(score, 1);
});

// ---------------------------------------------------------------------------
// runJudge — SKIP / self-grade guard / verdict / cost / failure
// ---------------------------------------------------------------------------

test('runJudge returns SKIP (no network) when the judge is unavailable', async () => {
  const subject = buildScaffoldSubject({ test: GOOD_TEST, scenario: SCENARIO, discoveredRoutes: ['/login'] });
  const verdict = await runJudge(SCAFFOLD_RUBRIC_V1, subject, { skip: true });
  assert.equal(verdict.outcome, 'SKIP');
  assert.equal(verdict.score, 0);
  assert.equal(verdict.rubricVersion, 'scaffold-v1');
  assert.match(verdict.dimensions[0]!.rationale, /ANTHROPIC_API_KEY/);
});

test('runJudge refuses to let a model grade its own turn', async () => {
  const subject = buildScaffoldSubject({
    test: GOOD_TEST,
    scenario: SCENARIO,
    discoveredRoutes: ['/login'],
    subjectModel: DEFAULT_JUDGE_MODEL,
  });
  await assert.rejects(
    () => runJudge(SCAFFOLD_RUBRIC_V1, subject, { judgeModel: DEFAULT_JUDGE_MODEL, skip: false, llm: stubLlm('{}') }),
    /must not grade its own turn/
  );
});

test('runJudge produces a PASS verdict with pinned identifiers and recorded cost', async () => {
  const reply = JSON.stringify({
    dimensions: [
      { key: 'no-hallucinated-routes', score: 1, rationale: 'real route' },
      { key: 'meaningful-assertions', score: 1, rationale: 'asserts visibility' },
      { key: 'real-selectors', score: 1, rationale: 'role-based' },
    ],
  });
  const llm = stubLlm(reply, 'stub-sonnet');
  const subject = buildScaffoldSubject({ test: GOOD_TEST, scenario: SCENARIO, discoveredRoutes: ['/', '/login'] });
  const verdict = await runJudge(SCAFFOLD_RUBRIC_V1, subject, { judgeModel: 'pinned-x', skip: false, llm });

  assert.equal(verdict.outcome, 'PASS');
  assert.equal(verdict.score, 1);
  assert.equal(verdict.rubricVersion, 'scaffold-v1');
  assert.equal(verdict.judgeModel, 'stub-sonnet', 'records the model the provider actually reported');
  assert.deepEqual(verdict.cost, { inputTokens: 123, outputTokens: 45, dataQuality: 'actual' });
  assert.equal(verdict.dimensions.length, 3);
  // The judge actually saw the grounding (route appears in the prompt it was handed).
  assert.ok(llm.lastPrompt!.includes('/login'));
});

test('runJudge forces FAIL when the judge near-zeros a critical dimension', async () => {
  const reply = JSON.stringify({
    dimensions: [
      { key: 'no-hallucinated-routes', score: 0, rationale: 'navigates to undiscovered /admin' },
      { key: 'meaningful-assertions', score: 1, rationale: 'asserts' },
      { key: 'real-selectors', score: 1, rationale: 'role' },
    ],
  });
  const subject = buildScaffoldSubject({ test: GOOD_TEST, scenario: SCENARIO, discoveredRoutes: ['/login'] });
  const verdict = await runJudge(SCAFFOLD_RUBRIC_V1, subject, { skip: false, llm: stubLlm(reply) });
  assert.equal(verdict.outcome, 'FAIL', 'hallucinated route gates to FAIL despite high aggregate');
});

test('runJudge returns FAIL (not throw) on a judge transport error, recording the reason', async () => {
  const failing: JudgeLlm = {
    model: 'stub',
    async call() {
      throw new Error('429 rate limited');
    },
  };
  const subject = buildScaffoldSubject({ test: GOOD_TEST, scenario: SCENARIO, discoveredRoutes: ['/login'] });
  const verdict = await runJudge(SCAFFOLD_RUBRIC_V1, subject, { skip: false, llm: failing });
  assert.equal(verdict.outcome, 'FAIL');
  assert.match(verdict.dimensions[0]!.rationale, /judge call failed.*429/);
});

test('runJudge returns FAIL with cost when the judge reply is unparseable', async () => {
  const subject = buildScaffoldSubject({ test: GOOD_TEST, scenario: SCENARIO, discoveredRoutes: ['/login'] });
  const verdict = await runJudge(SCAFFOLD_RUBRIC_V1, subject, { skip: false, llm: stubLlm('totally not json') });
  assert.equal(verdict.outcome, 'FAIL');
  assert.match(verdict.dimensions[0]!.rationale, /unparseable/);
  assert.ok(verdict.cost, 'cost is still recorded for a parse failure');
});

test('judgeScaffoldSpec wrapper SKIPs cleanly when forced unavailable', async () => {
  const verdict = await judgeScaffoldSpec(
    { test: GOOD_TEST, scenario: SCENARIO, discoveredRoutes: ['/login'] },
    { skip: true }
  );
  assert.equal(verdict.outcome, 'SKIP');
  assert.equal(verdict.rubricVersion, 'scaffold-v1');
});

// ---------------------------------------------------------------------------
// Subjects / grounding
// ---------------------------------------------------------------------------

test('buildScaffoldSubject unions discovered routes with the scenario target path', () => {
  const subject = buildScaffoldSubject({ test: GOOD_TEST, scenario: SCENARIO, discoveredRoutes: ['/', '/pricing'] });
  const targets = (subject.grounding.allowedNavigationTargets as string[]);
  assert.ok(targets.includes('/login'), 'scenario targetPath is an allowed nav target');
  assert.ok(targets.includes('/pricing'));
  assert.equal(new Set(targets).size, targets.length, 'no duplicate routes');
});

test('buildMaturitySubject exposes computed numbers + applicability as grounding', () => {
  const maturity: AutomationMaturity = {
    computedAt: '2026-05-30T00:00:00.000Z',
    repoPath: '/x',
    overallScore: 42,
    level: 3,
    label: 'L3 — building maturity',
    scoreFormula: 'f',
    dimensions: [
      { dimension: 'ci-integration', score: 0, weight: 0.14, evidence: ['no CI'], recommendations: [] },
      {
        dimension: 'auth-test-coverage',
        score: 0,
        weight: 0.1,
        evidence: ['auth-free'],
        recommendations: [],
        applicability: 'not_applicable',
      },
    ],
    topRecommendations: ['add CI'],
  };
  const subject = buildMaturitySubject({ narrative: 'scores 42, L3', maturity });
  assert.equal(subject.grounding.overallScore, 42);
  assert.equal(subject.grounding.level, 3);
  const dims = subject.grounding.dimensions as Array<{ dimension: string; applicability: string }>;
  assert.equal(dims.find((d) => d.dimension === 'auth-test-coverage')!.applicability, 'not_applicable');
});

// ---------------------------------------------------------------------------
// Scored runner (offline meta-eval) — the gate
// ---------------------------------------------------------------------------

test('golden corpus is non-trivial and covers both suites + all three outcome classes', () => {
  assert.ok(JUDGE_GOLDEN_CASES.length >= 5, 'expect a real corpus, not a single smoke case');
  const suites = new Set(JUDGE_GOLDEN_CASES.map((c) => c.suite));
  assert.ok(suites.has('scaffold') && suites.has('score-automation'));
  const outcomes = new Set(JUDGE_GOLDEN_CASES.map((c) => c.expectedOutcome));
  for (const o of ['PASS', 'WARN', 'FAIL'] as const) {
    assert.ok(outcomes.has(o), `corpus must include a ${o} case`);
  }
});

test('offline judge meta-eval scores full agreement with the gold labels (PASS, exit-0)', async () => {
  const summary = await runJudgeEval({ offline: true });
  assert.equal(summary.mode, 'offline');
  assert.equal(summary.counts.total, JUDGE_GOLDEN_CASES.length);
  // The whole point: a competent scoring of each candidate maps to its expected outcome.
  for (const r of summary.results) {
    assert.equal(r.agree, true, `case ${r.caseId}: expected ${r.expected} but pipeline gave ${r.got}`);
  }
  assert.equal(summary.agreement, 1);
  assert.equal(summary.outcome, 'PASS');
});

test('offline meta-eval can be sliced by suite', async () => {
  const summary = await runJudgeEval({ offline: true, suite: 'score-automation' });
  assert.ok(summary.results.length >= 2);
  assert.ok(summary.results.every((r) => r.suite === 'score-automation'));
});

test('formatSummary renders a per-case report with the mode and outcome', async () => {
  const summary = await runJudgeEval({ offline: true });
  const text = formatSummary(summary);
  assert.match(text, /mode=offline/);
  assert.match(text, /outcome=PASS/);
  assert.match(text, /scaffold\/scaffold-good-login-spec/);
});
