/**
 * `qulib_scaffold_tests`'s `journeys` input: pre-recorded user flows supplied
 * by the caller instead of (or in addition to) crawling the URL. Each entry
 * is auto-detected as EITHER a Chrome DevTools Recorder export (`{ title,
 * steps: [{ type, ... }] }` — export a flow from Chrome DevTools > Recorder
 * panel > "Export as JSON") OR an already-shaped qulib NeutralScenario
 * (`{ id, title, steps: [{ action, ... }], ... }`). This is the MCP surface
 * onto `@qulib/core`'s `importRecorderFlow`/`isRecorderFlow`, which in turn
 * feeds the exact same `scaffoldTests(url, { scenarios })` entry point that
 * crawl-derived and recipe-derived scenarios already use — see
 * `scaffold-tests.ts` in `@qulib/core`.
 */
import { NeutralScenarioSchema, importRecorderFlow, isRecorderFlow, type NeutralScenario } from '@qulib/core';

export interface ResolveJourneysResult {
  scenarios: NeutralScenario[];
  /** Non-fatal notes surfaced from Recorder conversion (skipped/unmapped steps). */
  warnings: string[];
}

/**
 * Convert the raw `journeys` MCP input into NeutralScenarios. Throws a
 * precise, index-prefixed error when an entry is neither a valid Recorder
 * export nor a valid NeutralScenario — the caller (handleScaffoldTests)
 * turns that into a QULIB_INPUT_INVALID tool error rather than a stack trace.
 */
export function resolveJourneyScenarios(
  journeys: Array<Record<string, unknown>> | undefined
): ResolveJourneysResult {
  const scenarios: NeutralScenario[] = [];
  const warnings: string[] = [];
  if (!journeys) return { scenarios, warnings };

  journeys.forEach((entry, index) => {
    if (isRecorderFlow(entry)) {
      let converted;
      try {
        converted = importRecorderFlow(entry);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`journeys[${index}]: ${msg}`);
      }
      scenarios.push(converted.scenario);
      for (const w of converted.warnings) warnings.push(`journeys[${index}]: ${w}`);
      return;
    }

    const parsed = NeutralScenarioSchema.safeParse(entry);
    if (!parsed.success) {
      throw new Error(
        `journeys[${index}] is neither a Chrome DevTools Recorder export ({ title, steps: [{ type, ... }] }) ` +
          `nor a valid NeutralScenario ({ id, title, steps: [{ action, ... }], ... }): ${parsed.error.message}`
      );
    }
    scenarios.push(parsed.data);
  });

  return { scenarios, warnings };
}
