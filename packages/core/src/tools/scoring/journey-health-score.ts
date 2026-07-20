/**
 * Cypress run results → journey health-score artifact.
 *
 * Pure, fixture-driven, no network, no DB, no filesystem. Parses a Cypress
 * mocha-json (or nested suites) results object into:
 *   `{ score: 0-100, perJourney: [{ id, passed, failed }] }`
 *
 * Journey ids match the suite generator: `recorder-<slug>` derived from the
 * describe/suite title with `@smoke` / `@regression` annotations stripped so
 * a tagged describe still maps back to the same journey id the generator
 * wrote into `// qulib-generated — scenario: …`.
 */
import {
  CypressRunResultsSchema,
  JourneyHealthScoreSchema,
  type CypressRunResults,
  type JourneyHealthPerJourney,
  type JourneyHealthScore,
} from '../../schemas/journey-health.schema.js';

/** Strip describe-title annotations and slugify to a recorder journey id. */
export function journeyIdFromSuiteTitle(suiteTitle: string): string {
  const withoutAnnotations = suiteTitle.replace(/(?:^|\s)@\w+/g, ' ').replace(/\s+/g, ' ').trim();
  const slug = withoutAnnotations
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `recorder-${slug.length > 0 ? slug : 'untitled'}`;
}

interface FlatTest {
  suiteTitle: string;
  passed: boolean;
}

function suiteTitleFromFullTitle(fullTitle: string, title: string | undefined): string {
  if (title && fullTitle.endsWith(title)) {
    const suite = fullTitle.slice(0, fullTitle.length - title.length).trim();
    return suite.length > 0 ? suite : fullTitle;
  }
  // Fallback: first segment before the last space-separated token group is
  // unreliable; keep the full title as the suite key rather than invent one.
  return fullTitle;
}

function isFailedState(state: string | undefined, hasErr: boolean): boolean {
  if (state === 'failed' || state === 'fail') return true;
  if (state === 'passed' || state === 'pass' || state === 'pending' || state === 'skipped') {
    return false;
  }
  return hasErr;
}

function collectFromFlatLists(results: CypressRunResults): FlatTest[] {
  const out: FlatTest[] = [];

  const push = (t: { title?: string; fullTitle?: string; state?: string; err?: unknown }, passed: boolean) => {
    const fullTitle = t.fullTitle ?? t.title ?? 'untitled';
    const suiteTitle = suiteTitleFromFullTitle(fullTitle, t.title);
    out.push({ suiteTitle, passed });
  };

  if (results.passes) {
    for (const t of results.passes) push(t, true);
  }
  if (results.failures) {
    for (const t of results.failures) push(t, false);
  }

  // Prefer explicit passes/failures lists when present; otherwise walk `tests`.
  if ((!results.passes || results.passes.length === 0) && (!results.failures || results.failures.length === 0)) {
    for (const t of results.tests ?? []) {
      const failed = isFailedState(t.state, t.err != null && t.err !== undefined && Object.keys(t.err as object).length > 0);
      // Skip pending/skipped so they don't inflate pass-rate with false confidence.
      if (t.state === 'pending' || t.state === 'skipped') continue;
      push(t, !failed);
    }
  }

  return out;
}

/**
 * Walk nested `results[].suites[]` (and recursive `suites`) collecting tests.
 * Tolerates unknown shapes — only objects with a string `title` + `tests`/`suites`
 * arrays are descended into.
 */
function collectFromNestedResults(results: CypressRunResults): FlatTest[] {
  const out: FlatTest[] = [];

  const walkSuite = (suite: unknown, parentTitle: string): void => {
    if (typeof suite !== 'object' || suite === null) return;
    const s = suite as Record<string, unknown>;
    const title = typeof s.title === 'string' ? s.title : parentTitle;
    const suiteTitle = title.length > 0 ? title : parentTitle || 'untitled';

    if (Array.isArray(s.tests)) {
      for (const raw of s.tests) {
        if (typeof raw !== 'object' || raw === null) continue;
        const t = raw as Record<string, unknown>;
        const state = typeof t.state === 'string' ? t.state : undefined;
        if (state === 'pending' || state === 'skipped') continue;
        const hasErr = t.err != null && typeof t.err === 'object';
        const passed = !isFailedState(state, hasErr);
        // Prefer the suite title over fullTitle so nested describes keep a
        // stable journey id matching the top-level describe the generator emits.
        out.push({ suiteTitle, passed });
      }
    }
    if (Array.isArray(s.suites)) {
      for (const child of s.suites) walkSuite(child, suiteTitle);
    }
  };

  for (const result of results.results ?? []) {
    if (typeof result !== 'object' || result === null) continue;
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.suites)) {
      for (const suite of r.suites) walkSuite(suite, '');
    }
    // Some reporters put tests directly on the file result.
    if (Array.isArray(r.tests)) {
      walkSuite({ title: typeof r.file === 'string' ? r.file : 'untitled', tests: r.tests }, '');
    }
  }

  return out;
}

function aggregatePerJourney(tests: FlatTest[]): JourneyHealthPerJourney[] {
  const map = new Map<string, { passed: number; failed: number }>();
  for (const t of tests) {
    const id = journeyIdFromSuiteTitle(t.suiteTitle);
    const bucket = map.get(id) ?? { passed: 0, failed: 0 };
    if (t.passed) bucket.passed += 1;
    else bucket.failed += 1;
    map.set(id, bucket);
  }
  return [...map.entries()]
    .map(([id, counts]) => ({ id, passed: counts.passed, failed: counts.failed }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Compute overall score from pass/fail counts.
 * Honest empty-suite rule: zero executed tests → score 0 (not 100).
 */
export function scoreFromCounts(passed: number, failed: number): number {
  const total = passed + failed;
  if (total === 0) return 0;
  return Math.round((passed / total) * 100);
}

/**
 * Pure health-score function. Validates the Cypress results envelope, then
 * aggregates per-journey pass/fail counts into the documented artifact shape.
 */
export function computeJourneyHealthScore(raw: unknown): JourneyHealthScore {
  const parsed = CypressRunResultsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Cypress run results failed schema validation: ${parsed.error.message}`);
  }
  const results = parsed.data;

  let tests = collectFromFlatLists(results);
  if (tests.length === 0) {
    tests = collectFromNestedResults(results);
  }

  // Last-resort: stats-only fixture with no per-test detail → single synthetic bucket.
  if (tests.length === 0 && results.stats) {
    const passed = results.stats.passes ?? 0;
    const failed = results.stats.failures ?? 0;
    if (passed + failed > 0) {
      const artifact = {
        score: scoreFromCounts(passed, failed),
        perJourney: [{ id: 'recorder-untitled', passed, failed }],
      };
      return JourneyHealthScoreSchema.parse(artifact);
    }
  }

  const perJourney = aggregatePerJourney(tests);
  const passed = perJourney.reduce((n, j) => n + j.passed, 0);
  const failed = perJourney.reduce((n, j) => n + j.failed, 0);
  return JourneyHealthScoreSchema.parse({
    score: scoreFromCounts(passed, failed),
    perJourney,
  });
}
