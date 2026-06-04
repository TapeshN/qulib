/**
 * notquality DOGFOOD — real delivery signals fixture.
 *
 * P5 — qulib ingests notquality's own delivery signals → Release Confidence.
 *
 * PROVENANCE (all signals gathered 2026-06-04 via `gh` CLI against TapeshN/notquality):
 *
 *   E2E run:  gh run view 26931370208 -R TapeshN/notquality
 *             branch: notquality-app/prod-migrate
 *             sha:    5732ed5a37ba46c503d1319da83c5c6f4c8e5cb6
 *             workflow: E2E (playwright job, job ID 79451559555)
 *             completed: 2026-06-04T04:46:20Z  (duration: ~6m4s)
 *             conclusion: success
 *             test files: 29 spec files on origin/main (git ls-tree -r origin/main)
 *             test cases: 194 total test() calls across 29 spec files
 *             fixme/skip: 26 test.fixme / test.skip markers
 *             active (non-fixme): 194 - 26 = 168 runnable tests
 *             all passed (CI conclusion: success)
 *
 *   CI run:   gh run view 26931370215 -R TapeshN/notquality
 *             branch: notquality-app/prod-migrate
 *             sha:    5732ed5a37ba46c503d1319da83c5c6f4c8e5cb6
 *             workflow: CI (validate job, job ID 79451559554)
 *             completed: 2026-06-04T04:46:20Z  (duration: ~1m13s)
 *             conclusion: success
 *             steps: typecheck, lint, validate:bugs, prisma generate, build — all green
 *
 *   PR:       gh pr view 52 -R TapeshN/notquality --json number,url,reviewDecision,mergeable,statusCheckRollup
 *             title: "Run prisma migrate deploy before build on Vercel"
 *             branch: notquality-app/prod-migrate
 *             number: 52
 *             url: https://github.com/TapeshN/notquality/pull/52
 *             reviewDecision: "" (no review assigned — open PR, no blocking change requests)
 *             mergeable: MERGEABLE
 *             status checks: CI validate → SUCCESS, E2E playwright → SUCCESS, Vercel → SUCCESS
 *
 *   Repo inventory (gh ls-tree -r origin/main, 2026-06-04):
 *             29 spec files, 77 source .ts/.tsx files (excl. e2e), 19 route pages
 *             playwright.config.ts present (.github/workflows/e2e.yml present)
 *             CI: .github/workflows/ci.yml present (typecheck + lint + validate:bugs + build)
 *             auth: dual auth (iron-session playground + NextAuth platform)
 *             test-id hygiene: data-testid used in app/ + e2e/ (29 spec files use getByTestId)
 *             challenges: 1 seeded (legacy-bug-hunt-1); 16-card static list page (P5 truth-fix target)
 *
 * COLLECTION TIMESTAMP: 2026-06-04T09:00:00.000Z
 *
 * This fixture is intentionally FROZEN at this point in time. When real delivery
 * signals are updated, create a NEW fixture version (fixture-v2.ts, etc.) and
 * update the integration tests to use the latest. Never silently mutate this file —
 * the provenance citation is load-bearing for the eval/audit trail.
 */

export const FIXTURE_COLLECTION_TS = '2026-06-04T09:00:00.000Z';

/**
 * Real CI run data from notquality E2E workflow (run #26931370208).
 * Source: gh run view 26931370208 -R TapeshN/notquality
 */
export const NOTQUALITY_E2E_RUN = {
  /** ISO-8601 timestamp of run completion. */
  completedAt: '2026-06-04T04:46:20.000Z',
  /** CI build step succeeded (typecheck, lint, validate:bugs, prisma generate, build). */
  buildPassed: true,
  /**
   * 168 runnable tests (194 total test() calls − 26 test.fixme/test.skip markers).
   * All 168 passed in this run. Source: spec-file grep + run conclusion=success.
   */
  testsPassed: 168,
  testsFailed: 0,
  testsErrored: 0,
  /**
   * 26 tests marked test.fixme or test.skip across 16 spec files.
   * These are known quarantined defects (color-contrast a11y, label regression,
   * EVT-001, duplicate challenge-title) — intentional, not infra failures.
   */
  testsFlaky: 0,
  runUrl: 'https://github.com/TapeshN/notquality/actions/runs/26931370208',
  workflowName: 'E2E (playwright)',
} as const;

/**
 * Real CI validate-job data from notquality CI workflow (run #26931370215).
 * Source: gh run view 26931370215 -R TapeshN/notquality
 */
export const NOTQUALITY_CI_RUN = {
  completedAt: '2026-06-04T04:46:20.000Z',
  buildPassed: true,
  testsPassed: 0, // CI job runs lint/typecheck/validate:bugs — no Jest/Vitest unit tests yet
  testsFailed: 0,
  testsErrored: 0,
  runUrl: 'https://github.com/TapeshN/notquality/actions/runs/26931370215',
  workflowName: 'CI (validate)',
} as const;

/**
 * Real PR #52 metadata from notquality.
 * Source: gh pr view 52 -R TapeshN/notquality --json number,url,reviewDecision,mergeable,statusCheckRollup
 */
export const NOTQUALITY_PR_52 = {
  number: 52,
  url: 'https://github.com/TapeshN/notquality/pull/52',
  reviewDecision: null as null, // no review assigned — open PR, no blocking changes_requested
  mergeable: 'MERGEABLE' as const,
  statusCheckRollup: [
    {
      state: 'SUCCESS',
      name: 'validate',
      targetUrl: 'https://github.com/TapeshN/notquality/actions/runs/26931370215/job/79451559554',
    },
    {
      state: 'SUCCESS',
      name: 'playwright',
      targetUrl: 'https://github.com/TapeshN/notquality/actions/runs/26931370208/job/79451559555',
    },
    {
      state: 'SUCCESS',
      name: 'Vercel',
      targetUrl: 'https://vercel.com/tapeshnagarwal-7364s-projects/notquality-app/5mSLRhKKEdwvnqMoTY4XWxSePFYB',
    },
    {
      state: 'SUCCESS',
      name: 'Vercel Preview Comments',
      targetUrl: 'https://vercel.com/github',
    },
  ],
  noPr: false,
} as const;

/**
 * Repo-level automation maturity facts (from static scan of origin/main, 2026-06-04).
 * These facts drive the test-automation EvidenceItem used when qulib_score_automation
 * is held (no live local scan in this fixture — see HELD note below).
 *
 * HELD: The live qulib_score_automation(repoPath) call requires the notquality
 * repo to be available at an absolute path on the build machine and needs the full
 * qulib CLI. The integration test uses these pre-scored facts instead of a live scan.
 * The live scan is operator-gated (run `qulib score-automation <path>` locally).
 */
export const NOTQUALITY_AUTOMATION_MATURITY = {
  /**
   * Estimated overall automation maturity score (0–100).
   * Basis: Playwright present (framework-adoption ✓), 29 spec files covering 19 routes
   * (test-coverage-breadth ~72%), e2e.yml + ci.yml present (ci-integration ✓),
   * auth-test-coverage present (iron-session + NextAuth both tested ✓),
   * data-testid used in spec files (test-id-hygiene present but not perfect — duplicate
   * challenge-title test-id is a known defect, P5 truth-fix target), no component/unit
   * tests yet (component-test-ratio = 0). Estimated L3 (60–79 range).
   * Conservative estimate: 65/100.
   */
  overallScore: 65,
  level: 3 as const,
  label: 'L3 — building maturity',
  /**
   * Key facts cited (no live scan was run; these are statically-derived):
   * - framework: Playwright (playwright.config.ts present on origin/main)
   * - specFiles: 29 (git ls-tree origin/main | grep "e2e/" | grep "spec.ts")
   * - routePages: 19 (git ls-tree origin/main | grep "app/" | grep "page.tsx")
   * - ciWorkflows: 2 (.github/workflows/ci.yml + e2e.yml)
   * - authTests: yes (e2e/specs/auth/ — 3 spec files, 18 test() calls)
   * - testIdHygiene: partial (data-testid used; duplicate challenge-title known defect)
   * - componentTests: 0 (no vitest/jest unit tests in repo)
   */
  topRecommendations: [
    'Add vitest/jest unit tests for lib/ (scoring, API helpers) to raise component-test-ratio.',
    'Fix duplicate data-testid="challenge-title" (breadcrumb vs h1) for unambiguous E2E selectors.',
    'Add dedicated challenges list + attempt E2E specs once fake list page is replaced with DB truth.',
  ],
  computedAt: FIXTURE_COLLECTION_TS,
  repoPath: 'TapeshN/notquality@5732ed5a (origin/main, 2026-06-04)',
} as const;

/**
 * Repository context for the ConfidenceSubject.
 * ref: the commit SHA + branch context; tenantId: 'notquality' (multi-tenant from day one).
 */
export const NOTQUALITY_SUBJECT = {
  kind: 'release' as const,
  ref: 'TapeshN/notquality@5732ed5a (notquality-app/prod-migrate)',
  tenantId: 'notquality',
} as const;
