/**
 * Golden dataset for the LLM-as-judge (Q2c — eval-judge).
 *
 * These are the judge's OWN eval cases (a meta-eval): hand-authored candidate
 * artifacts with a known-correct expected outcome under the pinned rubric. They let
 * us score the judge PIPELINE (prompt → parse → aggregate → outcome thresholds)
 * deterministically and offline, and — when ANTHROPIC_API_KEY is set — to score the
 * LIVE judge's agreement with these gold labels.
 *
 * Each case carries:
 *   - the suite + a real qulib subject (so grounding is built exactly as in prod),
 *   - `expectedOutcome`: what a correct judge MUST conclude,
 *   - `stubDimensionScores`: a plausible, rubric-consistent per-dimension scoring a
 *     competent judge would emit for this candidate. The OFFLINE scored runner feeds
 *     these through the real aggregate()+scoreToOutcome() to verify the pipeline maps
 *     them to `expectedOutcome`. (They are the judge's "answer key" for offline runs.)
 *
 * Pin: graded against `scaffold-v1` / `score-automation-v1`.
 */

import type { EvalOutcome } from '../../types.js';
import type { ScaffoldSpecSubject, MaturityNarrativeSubject, ConfidenceNarrativeSubject } from '../subjects.js';

export interface ScaffoldJudgeCase {
  id: string;
  suite: 'scaffold';
  description: string;
  rubricVersion: 'scaffold-v1';
  subject: ScaffoldSpecSubject;
  expectedOutcome: EvalOutcome;
  /** Rubric-consistent per-dimension scores a competent judge would emit (offline answer key). */
  stubDimensionScores: Array<{ key: string; score: number; rationale: string }>;
}

export interface MaturityJudgeCase {
  id: string;
  suite: 'score-automation';
  description: string;
  rubricVersion: 'score-automation-v1';
  subject: MaturityNarrativeSubject;
  expectedOutcome: EvalOutcome;
  stubDimensionScores: Array<{ key: string; score: number; rationale: string }>;
}

export interface ConfidenceNarrativeJudgeCase {
  id: string;
  suite: 'confidence';
  description: string;
  rubricVersion: 'confidence-narrative-v1';
  subject: ConfidenceNarrativeSubject;
  expectedOutcome: EvalOutcome;
  stubDimensionScores: Array<{ key: string; score: number; rationale: string }>;
}

export type JudgeGoldenCase = ScaffoldJudgeCase | MaturityJudgeCase | ConfidenceNarrativeJudgeCase;

const ROUTES = ['/', '/login', '/pricing'];

/** A clean Playwright scenario targeting /login used by the good + bad scaffold cases. */
const LOGIN_SCENARIO: ScaffoldSpecSubject['scenario'] = {
  id: 'scn-login-001',
  title: '[HIGH] auth-surface — /login',
  description: 'Verify the sign-in page renders its email/password form and submit affordance.',
  targetPath: '/login',
  steps: [
    { action: 'navigate', target: '/login', description: 'Navigate to /login' },
    { action: 'assert-visible', description: 'Assert the sign-in form is visible' },
  ],
  tags: ['auth-surface', 'high'],
  recommendations: [{ adapter: 'playwright', reason: 'auth flow', confidence: 'medium' }],
  sourceGapIds: ['gap-login'],
};

const SCAFFOLD_CASES: ScaffoldJudgeCase[] = [
  {
    id: 'scaffold-good-login-spec',
    suite: 'scaffold',
    description: 'Well-formed Playwright spec: visits a discovered route, asserts on a role-based selector.',
    rubricVersion: 'scaffold-v1',
    expectedOutcome: 'PASS',
    subject: {
      discoveredRoutes: ROUTES,
      scenario: LOGIN_SCENARIO,
      test: {
        scenarioId: 'scn-login-001',
        adapter: 'playwright',
        filename: 'login.spec.ts',
        outputPath: 'tests/login.spec.ts',
        source: 'template',
        code: [
          `import { test, expect } from '@playwright/test';`,
          ``,
          `test('sign-in page renders its form', async ({ page }) => {`,
          `  await page.goto('/login');`,
          `  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();`,
          `  await expect(page.getByLabel(/email/i)).toBeVisible();`,
          `});`,
        ].join('\n'),
      },
    },
    stubDimensionScores: [
      { key: 'no-hallucinated-routes', score: 1, rationale: '/login is a discovered route.' },
      { key: 'meaningful-assertions', score: 1, rationale: 'Two visibility assertions tied to the sign-in intent.' },
      { key: 'real-selectors', score: 1, rationale: 'Role- and label-based selectors, not brittle ids.' },
    ],
  },
  {
    id: 'scaffold-hallucinated-route',
    suite: 'scaffold',
    description: 'Spec navigates to /admin/secret-dashboard — a route qulib never discovered (hallucination).',
    rubricVersion: 'scaffold-v1',
    expectedOutcome: 'FAIL',
    subject: {
      discoveredRoutes: ROUTES,
      scenario: LOGIN_SCENARIO,
      test: {
        scenarioId: 'scn-login-001',
        adapter: 'playwright',
        filename: 'login.spec.ts',
        outputPath: 'tests/login.spec.ts',
        source: 'llm',
        code: [
          `import { test, expect } from '@playwright/test';`,
          ``,
          `test('admin dashboard loads', async ({ page }) => {`,
          `  await page.goto('/admin/secret-dashboard');`,
          `  await expect(page.getByRole('heading', { name: /admin/i })).toBeVisible();`,
          `});`,
        ].join('\n'),
      },
    },
    // Critical dimension near zero ⇒ pipeline must force FAIL even though others are fine.
    stubDimensionScores: [
      { key: 'no-hallucinated-routes', score: 0, rationale: '/admin/secret-dashboard is not in the discovered routes.' },
      { key: 'meaningful-assertions', score: 1, rationale: 'Has a heading visibility assertion.' },
      { key: 'real-selectors', score: 1, rationale: 'Role-based selector.' },
    ],
  },
  {
    id: 'scaffold-no-assertions',
    suite: 'scaffold',
    description: 'Spec visits a real route but makes no assertion — navigation-only, low confidence.',
    rubricVersion: 'scaffold-v1',
    expectedOutcome: 'WARN',
    subject: {
      discoveredRoutes: ROUTES,
      scenario: LOGIN_SCENARIO,
      test: {
        scenarioId: 'scn-login-001',
        adapter: 'playwright',
        filename: 'login.spec.ts',
        outputPath: 'tests/login.spec.ts',
        source: 'template',
        code: [
          `import { test } from '@playwright/test';`,
          ``,
          `test('open login', async ({ page }) => {`,
          `  await page.goto('/login');`,
          `});`,
        ].join('\n'),
      },
    },
    // Real route (1*0.4=0.4) + thin implicit assertion (0.5*0.35=0.175) +
    // no real selectors exercised, generic-only (0.5*0.25=0.125) ⇒ aggregate 0.7,
    // which lands in the WARN band [warnAt 0.6, passAt 0.8). Verified by the scored runner.
    stubDimensionScores: [
      { key: 'no-hallucinated-routes', score: 1, rationale: '/login is a discovered route.' },
      { key: 'meaningful-assertions', score: 0.5, rationale: 'Navigation implicitly asserts load but no explicit check.' },
      { key: 'real-selectors', score: 0.5, rationale: 'No selectors exercised; spec is navigation-only.' },
    ],
  },
];

const MATURITY_GROUNDING: MaturityNarrativeSubject['maturity'] = {
  computedAt: '2026-05-30T00:00:00.000Z',
  repoPath: '/tmp/fixture-repo',
  overallScore: 42,
  level: 3,
  label: 'L3 — building maturity',
  scoreFormula:
    'overallScore = round( Σ (score * weight) / Σ weight ) for applicable dimensions only. not_applicable and unknown dimensions are excluded from the denominator.',
  dimensions: [
    {
      dimension: 'test-coverage-breadth',
      score: 50,
      weight: 0.28,
      evidence: ['2/4 inferred routes appear in at least one test coveredPaths'],
      recommendations: ['Add route-level smoke tests that assert critical paths.'],
    },
    {
      dimension: 'framework-adoption',
      score: 100,
      weight: 0.22,
      evidence: ['Test runners seen: playwright', 'Playwright or Cypress present — good browser harness signal.'],
      recommendations: [],
    },
    {
      dimension: 'ci-integration',
      score: 0,
      weight: 0.14,
      evidence: ['No GitHub Actions, CircleCI, or Jenkinsfile detected at repo root'],
      recommendations: ['Add a CI workflow that runs unit/E2E tests on every PR.'],
    },
    {
      dimension: 'auth-test-coverage',
      score: 0,
      weight: 0.1,
      evidence: ['No auth routes, auth-named test files, or auth path coverage detected — repo appears auth-free.'],
      recommendations: [],
      applicability: 'not_applicable',
      reason: 'No auth signal detected.',
    },
    {
      dimension: 'component-test-ratio',
      score: 0,
      weight: 0.08,
      evidence: ['No Cypress (e2e or component) tests detected — component-test-ratio does not apply.'],
      recommendations: [],
      applicability: 'not_applicable',
      reason: 'No Cypress tests detected.',
    },
  ],
  topRecommendations: [
    'Add a CI workflow that runs unit/E2E tests on every PR.',
    'Add route-level smoke tests that assert critical paths.',
  ],
};

const MATURITY_CASES: MaturityJudgeCase[] = [
  {
    id: 'maturity-faithful-narrative',
    suite: 'score-automation',
    description: 'Narrative restates the computed L3/42 honestly, grounds CI gap, excludes N/A dims.',
    rubricVersion: 'score-automation-v1',
    expectedOutcome: 'PASS',
    subject: {
      maturity: MATURITY_GROUNDING,
      narrative: [
        'This repository scores 42/100 — L3, building maturity.',
        'Strength: framework adoption is strong (Playwright present, scored 100).',
        'Top gap: there is no CI integration (scored 0) — add a workflow that runs tests on every PR.',
        'Coverage breadth is partial: only 2 of 4 inferred routes are exercised by tests.',
        'Auth and component-test dimensions did not apply to this repo and were excluded from the score.',
      ].join('\n'),
    },
    stubDimensionScores: [
      { key: 'numeric-faithfulness', score: 1, rationale: '42/100, L3, scored values all match the computation.' },
      { key: 'evidence-grounding', score: 1, rationale: 'Every claim traces to the per-dimension evidence.' },
      { key: 'applicability-honesty', score: 1, rationale: 'N/A dimensions explicitly excluded, not penalized.' },
    ],
  },
  {
    id: 'maturity-invented-number',
    suite: 'score-automation',
    description: 'Narrative claims a 78/100 score that contradicts the computed 42 — an invented metric.',
    rubricVersion: 'score-automation-v1',
    expectedOutcome: 'FAIL',
    subject: {
      maturity: MATURITY_GROUNDING,
      narrative: [
        'Great news: this repo scores 78/100 — L4, strong automation, with CI fully wired up.',
        'Component test coverage is excellent.',
      ].join('\n'),
    },
    // numeric-faithfulness is critical and ~0 ⇒ FAIL regardless of aggregate.
    stubDimensionScores: [
      { key: 'numeric-faithfulness', score: 0, rationale: 'Claims 78/L4; computation says 42/L3 — contradicted.' },
      { key: 'evidence-grounding', score: 0, rationale: 'Praises CI (scored 0) and component coverage (N/A).' },
      { key: 'applicability-honesty', score: 0, rationale: 'Reports an N/A dimension as a strength.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Confidence-narrative golden cases (P4 — confidence-narrative-v1 rubric)
//
// These grade the NARRATIVE string against the written rubric. The
// releaseConfidence object is the truth set; the narrative must faithfully
// describe it.
// ---------------------------------------------------------------------------

import type { ReleaseConfidence } from '../../../src/schemas/confidence.schema.js';

/** Shared truth-set used by confidence narrative cases. */
const SHIP_RC: ReleaseConfidence = {
  schemaVersion: 1,
  computedAt: '2026-06-04T12:00:00.000Z',
  subject: { kind: 'release', ref: 'https://app.example.com', tenantId: 'golden' },
  confidenceScore: 86,
  verdict: 'ship',
  level: 5,
  label: 'L5 — advanced QA automation',
  contributions: [
    { source: 'live-app-quality',  score: 92, weight: 0.30, effectiveWeight: 0.455, applicability: 'applicable', blocking: false },
    { source: 'test-automation',   score: 85, weight: 0.22, effectiveWeight: 0.333, applicability: 'applicable', blocking: false },
    { source: 'api-coverage',      score: 75, weight: 0.14, effectiveWeight: 0.212, applicability: 'applicable', blocking: false },
    { source: 'crawl-coverage',    score: 0,  weight: 0.10, effectiveWeight: 0,     applicability: 'not_applicable', blocking: false },
    { source: 'ci-results',        score: 0,  weight: 0.10, effectiveWeight: 0,     applicability: 'unknown',        blocking: false },
  ],
  topRisks: ['2/5 API endpoints lack test coverage.'],
  recommendedNextChecks: ['Add API test coverage for the 2 untested endpoints.'],
  honestyNotes: [
    "'crawl-coverage' source is not applicable for this subject.",
    "'ci-results' source could not produce a reliable score.",
  ],
  blockers: [],
  scoreFormula: 'confidenceScore = round( Σ (score * weight) / Σ weight ) for applicable, non-null, non-blocking evidence only.',
};

/** Truth set for a hold verdict (critical gap). */
const HOLD_RC: ReleaseConfidence = {
  schemaVersion: 1,
  computedAt: '2026-06-04T12:00:00.000Z',
  subject: { kind: 'release', ref: 'https://app.example.com', tenantId: 'golden' },
  confidenceScore: 45,
  verdict: 'hold',
  level: 2,
  label: 'L2 — early automation',
  contributions: [
    { source: 'live-app-quality', score: 45, weight: 0.30, effectiveWeight: 1.0, applicability: 'applicable', blocking: false },
  ],
  topRisks: ['Multiple critical accessibility violations detected (wcag2a: color-contrast, 12 nodes).'],
  recommendedNextChecks: ['Resolve all critical accessibility violations before shipping.'],
  honestyNotes: [],
  blockers: [],
  scoreFormula: 'confidenceScore = round( Σ (score * weight) / Σ weight ) for applicable, non-null, non-blocking evidence only.',
};

const CONFIDENCE_NARRATIVE_CASES: ConfidenceNarrativeJudgeCase[] = [
  {
    id: 'confidence-faithful-ship-narrative',
    suite: 'confidence',
    description: 'Narrative faithfully describes a ship verdict, grounded in contributions, honest about abstentions.',
    rubricVersion: 'confidence-narrative-v1',
    expectedOutcome: 'PASS',
    subject: {
      releaseConfidence: SHIP_RC,
      narrative: [
        'Release confidence: SHIP — L5, advanced QA automation (score 86/100).',
        'Three sources contributed: live-app-quality (92), test-automation (85), api-coverage (75).',
        'Top risk: 2 of 5 API endpoints lack test coverage — recommend adding API tests before the next cycle.',
        'Note: crawl-coverage was not applicable for this release; ci-results could not produce a score (signal unavailable).',
        'Verdict: safe to ship, with the API coverage gap logged as follow-up.',
      ].join('\n'),
    },
    stubDimensionScores: [
      { key: 'correctness',       score: 1,   rationale: 'Verdict SHIP, score 86, level L5 all match the computed result.' },
      { key: 'grounding',        score: 1,   rationale: 'Every factual claim maps to a contribution or topRisks entry.' },
      { key: 'format',           score: 1,   rationale: 'Verdict up-front, risks surfaced, abstentions named, concise.' },
      { key: 'no-hallucination', score: 1,   rationale: 'Nothing invented; all numbers match the input.' },
    ],
  },
  {
    id: 'confidence-wrong-verdict-hallucination',
    suite: 'confidence',
    description: 'Narrative claims SHIP when computed verdict is HOLD — wrong verdict + hallucinated score.',
    rubricVersion: 'confidence-narrative-v1',
    expectedOutcome: 'FAIL',
    subject: {
      releaseConfidence: HOLD_RC,
      narrative: [
        'Release confidence: SHIP — score 92/100, excellent quality (score is 45 in truth).',
        'No risks detected. All checks green.',
      ].join('\n'),
    },
    // correctness=0 (wrong verdict) + no-hallucination=0 (invented 92, invented "no risks") ⇒ hard FAIL
    stubDimensionScores: [
      { key: 'correctness',       score: 0,   rationale: 'Claims SHIP; computed verdict is HOLD at score 45.' },
      { key: 'grounding',        score: 0,   rationale: 'Claims "no risks" but topRisks lists a critical a11y violation.' },
      { key: 'format',           score: 0.5, rationale: 'States a verdict (even if wrong), so format is partially met.' },
      { key: 'no-hallucination', score: 0,   rationale: 'Score 92 is fabricated (actual 45); "no risks" contradicts evidence.' },
    ],
  },
  {
    id: 'confidence-verbose-but-correct',
    suite: 'confidence',
    description: 'Narrative is verbose and padded — verdict buried, borderline grounding. Should be WARN.',
    rubricVersion: 'confidence-narrative-v1',
    expectedOutcome: 'WARN',
    subject: {
      releaseConfidence: SHIP_RC,
      narrative: [
        'I have carefully reviewed the release confidence data and I am very pleased to report that the',
        'overall release confidence score is 86 out of a possible 100, which places it at level 5 out of',
        'the available 5 levels, and the verdict as computed by the qulib release confidence aggregator is',
        'SHIP, which means the system believes the release is ready to ship. The live-app-quality source',
        'contributed a score of 92 (with an effective weight of approximately 0.455), the test-automation',
        'source contributed 85, and api-coverage contributed 75. The crawl-coverage source was marked as',
        'not_applicable and ci-results was unknown and therefore both were excluded from the score.',
        'There is one top risk: 2 API endpoints lack test coverage. Recommendation: add tests.',
      ].join('\n'),
    },
    // Correctness: 0.8 (verdict buried, but all numbers correct — minor structural mismatch).
    // Grounding: 0.8 (mostly grounded; one summary-level claim not directly traceable).
    // Format: 0.3 (verdict buried in prose; heavily padded — format penalty).
    // No-hallucination: 1.0 (nothing invented).
    // Aggregate = 0.8*0.30 + 0.8*0.30 + 0.3*0.15 + 1.0*0.25 = 0.24+0.24+0.045+0.25 = 0.775 → WARN
    stubDimensionScores: [
      { key: 'correctness',       score: 0.8, rationale: 'All numbers match but verdict is buried; structural issue.' },
      { key: 'grounding',        score: 0.8, rationale: 'Mostly grounded; one summary-level claim not directly traceable.' },
      { key: 'format',           score: 0.3, rationale: 'Verdict buried in verbose prose; padding deducts from format.' },
      { key: 'no-hallucination', score: 1.0, rationale: 'Nothing invented; all identifiers appear in the input.' },
    ],
  },
];

/** The full golden corpus (scaffold + score-automation + confidence-narrative judge cases). */
export const JUDGE_GOLDEN_CASES: JudgeGoldenCase[] = [...SCAFFOLD_CASES, ...MATURITY_CASES, ...CONFIDENCE_NARRATIVE_CASES];
