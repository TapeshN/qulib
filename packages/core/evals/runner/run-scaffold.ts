/**
 * `scaffold` suite executor for the eval runner (Q2d).
 *
 * `scaffoldTests(url, opts)` calls `analyzeApp` (network + browser) ONLY when no
 * scenarios are supplied. When `opts.scenarios` is provided it short-circuits the
 * crawl and just renders the adapter spec — fully DETERMINISTIC and offline. The
 * golden corpus therefore pins `scenarios` as input, so the eval is reproducible
 * and never depends on a live site or LLM.
 *
 * This mirrors the `qulib scaffold` CLI surface (it wraps the same scaffoldTests),
 * but grades the generated artifact rather than re-crawling — exactly what the eval
 * must do to be a stable CI merge gate.
 *
 * Golden case shape (validated here, suite-specific):
 *   input.url        : base URL (used for projectConfig.baseUrl; never fetched here).
 *   input.framework  : 'cypress-e2e' | 'playwright' (default cypress-e2e).
 *   input.scenarios  : NeutralScenario[] — the pinned scenarios to render.
 *   expected.specCount        : exact number of generated specs (= scenarios.length).
 *   expected.mustContain      : substrings every-or-any generated spec must contain
 *                               (the REAL selectors/routes drawn from the scenarios).
 *   expected.mustNotContain   : substrings that must NOT appear in any spec
 *                               (hallucination guard: selectors/routes not in input).
 *   expected.baseUrlInConfig  : if true, projectConfig must embed input.url.
 */
import { z } from 'zod';
import type { EvalCase, EvalCaseResult, EvalOutcome } from '../types.js';
import { NeutralScenarioSchema, GeneratedTestSchema } from '../../src/schemas/gap-analysis.schema.js';
import { scaffoldTests } from '../../src/scaffold-tests.js';
import { combineCaseOutcome } from './rollup.js';
import { judgeOrSkip, reduceScaffoldVerdicts, type JudgeImpl } from './judge-bridge.js';

const FrameworkSchema = z.enum(['cypress-e2e', 'playwright']).default('cypress-e2e');

const InputSchema = z.object({
  url: z.string().url(),
  framework: FrameworkSchema,
  scenarios: z.array(NeutralScenarioSchema).min(1),
});

const ExpectedSchema = z.object({
  specCount: z.number().int().min(0),
  mustContain: z.array(z.string()).optional(),
  mustNotContain: z.array(z.string()).optional(),
  baseUrlInConfig: z.boolean().optional(),
});

/**
 * Run one scaffold golden case end-to-end. Never throws — asserts capture failure.
 * `judge` is injectable so the judge-active path is testable offline (defaults to
 * Q2c's real judge, which SKIPs without an ANTHROPIC_API_KEY).
 */
export async function runScaffoldCase(c: EvalCase, judge?: JudgeImpl): Promise<EvalCaseResult> {
  const start = Date.now();
  const notes: string[] = [];
  let outcome: EvalOutcome = 'PASS';

  const fail = (msg: string): void => {
    notes.push(`FAIL: ${msg}`);
    outcome = 'FAIL';
  };

  const input = InputSchema.safeParse(c.input);
  const expected = ExpectedSchema.safeParse(c.expected);
  if (!input.success) {
    fail(`malformed scaffold input: ${input.error.message}`);
    return finalize(c, outcome, notes, start);
  }
  if (!expected.success) {
    fail(`malformed expected block: ${expected.error.message}`);
    return finalize(c, outcome, notes, start);
  }

  // Deterministic path: pass scenarios so scaffoldTests skips analyzeApp entirely.
  const result = await scaffoldTests(input.data.url, {
    framework: input.data.framework,
    scenarios: input.data.scenarios,
  });

  const allCode = result.generatedTests.map((t) => t.code).join('\n');

  // 1) Every generated test must satisfy GeneratedTestSchema (shape gate).
  let shapeOk = true;
  for (const t of result.generatedTests) {
    const parsed = GeneratedTestSchema.safeParse(t);
    if (!parsed.success) {
      shapeOk = false;
      fail(`generated test for scenario "${t.scenarioId}" fails GeneratedTestSchema: ${parsed.error.message}`);
    }
  }
  if (shapeOk) notes.push(`shape: ${result.generatedTests.length} generated test(s) valid`);

  // 2) Framework + spec count must match (no silent under/over-generation).
  if (result.framework !== input.data.framework) {
    fail(`framework expected "${input.data.framework}", got "${result.framework}"`);
  }
  if (result.generatedTests.length !== expected.data.specCount) {
    fail(`specCount expected ${expected.data.specCount}, got ${result.generatedTests.length}`);
  } else {
    notes.push(`specCount: ${result.generatedTests.length} OK`);
  }

  // 3) Each scenario must produce exactly one spec keyed by its id (no dropped/duplicated scenario).
  for (const s of input.data.scenarios) {
    const matches = result.generatedTests.filter((t) => t.scenarioId === s.id);
    if (matches.length !== 1) {
      fail(`scenario "${s.id}" produced ${matches.length} spec(s), expected exactly 1`);
    }
  }

  // 4) Real-selector grounding: every selector that appears in a scenario step
  //    `target` MUST appear in the generated code. This is the anti-drift gate —
  //    the scaffold must target the selectors it was given, verbatim.
  for (const s of input.data.scenarios) {
    for (const step of s.steps) {
      if (step.target && (step.action === 'click' || step.action === 'type' || step.action.startsWith('assert'))) {
        if (!allCode.includes(step.target)) {
          fail(`real selector "${step.target}" (scenario ${s.id}) is absent from the generated spec`);
        }
      }
    }
  }
  notes.push('grounding: all real step selectors present in generated specs');

  // 5) Explicit mustContain / mustNotContain (hallucination guard).
  for (const needle of expected.data.mustContain ?? []) {
    if (!allCode.includes(needle)) fail(`expected substring "${needle}" absent from generated specs`);
  }
  for (const banned of expected.data.mustNotContain ?? []) {
    if (allCode.includes(banned)) {
      fail(`hallucination: banned substring "${banned}" present in generated specs (not in input scenarios)`);
    }
  }
  if ((expected.data.mustContain ?? []).length || (expected.data.mustNotContain ?? []).length) {
    notes.push('substring contract (mustContain / mustNotContain) OK');
  }

  // 6) projectConfig must embed the real base URL when asked.
  if (expected.data.baseUrlInConfig) {
    const configCode = result.projectConfig.configFile.code;
    if (!configCode.includes(input.data.url)) {
      fail(`projectConfig (${result.projectConfig.configFile.filename}) does not embed base URL ${input.data.url}`);
    } else {
      notes.push(`projectConfig embeds base URL OK`);
    }
  }

  // Judge (optional): grade the *quality* of each generated spec (are the assertions
  // meaningful + grounded, not just structurally valid). One verdict per spec, reduced
  // to a case verdict. SKIP unless judge + key present; can only downgrade a PASS,
  // never rescue a deterministic FAIL. The "allowed routes" grounding for these pinned
  // scenarios is every navigate-step target plus each scenario's targetPath — so the
  // judge's no-hallucinated-route dimension has a faithful truth set.
  const discoveredRoutes = Array.from(
    new Set(
      input.data.scenarios.flatMap((s) => [
        s.targetPath,
        ...s.steps.filter((st) => st.action === 'navigate' && st.target).map((st) => st.target as string),
      ])
    )
  );
  const verdicts = [];
  for (const test of result.generatedTests) {
    const scenario = input.data.scenarios.find((s) => s.id === test.scenarioId);
    if (!scenario) continue;
    verdicts.push(await judgeOrSkip({ suite: 'scaffold', test, scenario, discoveredRoutes }, judge));
  }
  const verdict = reduceScaffoldVerdicts(verdicts);

  const caseOutcome = combineCaseOutcome(outcome, verdict.outcome);
  return {
    caseId: c.id,
    suite: 'scaffold',
    outcome: caseOutcome,
    deterministic: { outcome, notes },
    judge: verdict,
    latencyMs: Date.now() - start,
  };
}

function finalize(
  c: EvalCase,
  outcome: EvalOutcome,
  notes: string[],
  start: number
): EvalCaseResult {
  return {
    caseId: c.id,
    suite: 'scaffold',
    outcome,
    deterministic: { outcome, notes },
    latencyMs: Date.now() - start,
  };
}
