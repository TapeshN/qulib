/**
 * Journey suite health-score artifact — the JSON shape TapQuality (and the
 * `qulib journey-health` CLI) emit after parsing a Cypress run results file.
 *
 * Additive schema only. Pure scoring lives in
 * `tools/scoring/journey-health-score.ts`.
 */
import { z } from 'zod';

export const JourneyHealthPerJourneySchema = z.object({
  id: z.string().min(1),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
});

export const JourneyHealthScoreSchema = z.object({
  /** Overall pass-rate score in [0, 100]. Integer. */
  score: z.number().int().min(0).max(100),
  /** Per-journey pass/fail counts, ordered by journey id ascending. */
  perJourney: z.array(JourneyHealthPerJourneySchema),
});

export type JourneyHealthPerJourney = z.infer<typeof JourneyHealthPerJourneySchema>;
export type JourneyHealthScore = z.infer<typeof JourneyHealthScoreSchema>;

/**
 * Minimal Cypress mocha-json reporter shape we accept as a fixture.
 * Extra fields are ignored (`.passthrough()` / optional arrays).
 *
 * Supports both:
 *   - flat mocha-json (`passes` / `failures` / `tests` arrays + `stats`)
 *   - nested mocha-multi / cypress-mochawesome-style `results[].suites[]`
 */
export const CypressRunTestSchema = z
  .object({
    title: z.string().optional(),
    fullTitle: z.string().optional(),
    state: z.string().optional(),
    /** Present on some reporters when the test failed. */
    err: z.unknown().optional(),
  })
  .passthrough();

export const CypressRunResultsSchema = z
  .object({
    stats: z
      .object({
        passes: z.number().optional(),
        failures: z.number().optional(),
        tests: z.number().optional(),
        pending: z.number().optional(),
      })
      .passthrough()
      .optional(),
    passes: z.array(CypressRunTestSchema).optional(),
    failures: z.array(CypressRunTestSchema).optional(),
    tests: z.array(CypressRunTestSchema).optional(),
    pending: z.array(CypressRunTestSchema).optional(),
    /** Nested reporter variant (cypress + mocha recursive suites). */
    results: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type CypressRunResults = z.infer<typeof CypressRunResultsSchema>;
