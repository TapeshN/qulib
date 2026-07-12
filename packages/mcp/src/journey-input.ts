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

/**
 * A journeys[] entry that converted (or parsed) to a scenario with ZERO
 * steps — nothing for scaffoldTests to actually generate an assertion for.
 * Excluded from `scenarios`/the downstream `testCount`/`scenarioCount` so a
 * useless stub never reads as a successful conversion; surfaced here as a
 * distinct, hard-to-ignore signal instead.
 */
export interface RejectedJourney {
  index: number;
  id: string;
  title: string;
  reason: string;
}

export interface ResolveJourneysResult {
  scenarios: NeutralScenario[];
  /** Non-fatal notes surfaced from Recorder conversion (skipped/unmapped steps). */
  warnings: string[];
  /**
   * journeys[] entries that produced a zero-step scenario — every step was
   * unmappable (Recorder) or the entry was already an empty NeutralScenario.
   * These NEVER appear in `scenarios` and must never be counted as a
   * successful conversion by a caller (see handleScaffoldTests, which
   * surfaces this list under a distinct `rejectedJourneys` response field
   * rather than folding it into `scenarioCount`/`testCount`).
   */
  rejectedJourneys: RejectedJourney[];
}

/**
 * Convert the raw `journeys` MCP input into NeutralScenarios. Throws a
 * precise, index-prefixed error when an entry is neither a valid Recorder
 * export nor a valid NeutralScenario — the caller (handleScaffoldTests)
 * turns that into a QULIB_INPUT_INVALID tool error rather than a stack trace.
 *
 * A zero-step scenario — every step unmappable, or an already-empty
 * NeutralScenario — is NOT a conversion failure (it does not throw) but it
 * is also not a usable scenario: it is excluded from `scenarios` and
 * reported in `rejectedJourneys` instead, so a caller counting
 * `scenarios.length` never mistakes a useless stub for real coverage.
 */
export function resolveJourneyScenarios(
  journeys: Array<Record<string, unknown>> | undefined
): ResolveJourneysResult {
  const scenarios: NeutralScenario[] = [];
  const warnings: string[] = [];
  const rejectedJourneys: RejectedJourney[] = [];
  if (!journeys) return { scenarios, warnings, rejectedJourneys };

  journeys.forEach((entry, index) => {
    if (isRecorderFlow(entry)) {
      let converted;
      try {
        converted = importRecorderFlow(entry);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`journeys[${index}]: ${msg}`);
      }
      for (const w of converted.warnings) warnings.push(`journeys[${index}]: ${w}`);
      if (converted.rejected) {
        rejectedJourneys.push({
          index,
          id: converted.scenario.id,
          title: converted.scenario.title,
          reason: 'no steps could be converted from this Recorder flow — every step was unmappable',
        });
        return;
      }
      scenarios.push(converted.scenario);
      return;
    }

    const parsed = NeutralScenarioSchema.safeParse(entry);
    if (!parsed.success) {
      throw new Error(
        `journeys[${index}] is neither a Chrome DevTools Recorder export ({ title, steps: [{ type, ... }] }) ` +
          `nor a valid NeutralScenario ({ id, title, steps: [{ action, ... }], ... }): ${parsed.error.message}`
      );
    }
    if (parsed.data.steps.length === 0) {
      rejectedJourneys.push({
        index,
        id: parsed.data.id,
        title: parsed.data.title,
        reason: 'supplied NeutralScenario has zero steps — nothing to test',
      });
      return;
    }
    scenarios.push(parsed.data);
  });

  return { scenarios, warnings, rejectedJourneys };
}
