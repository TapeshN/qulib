/**
 * Chrome DevTools Recorder export shape — the JSON produced by Chrome's
 * built-in "Recorder" panel (Export as JSON) or Puppeteer's `PuppeteerReplay`
 * format. A flow is `{ title, steps: [...] }`; each step has a `type`
 * (navigate, click, change, keyDown, keyUp, doubleClick, hover, scroll,
 * waitForElement, waitForExpression, setViewport, …) plus type-specific
 * fields (`url`, `value`, `key`, `selectors`, `assertedEvents`, …).
 *
 * These schemas validate STRUCTURE only, deliberately loosely:
 *   - every step must be an object with a string `type` — nothing else is
 *     required, so a step from a Recorder version we have not seen yet still
 *     parses (the converter in `tools/journeys/recorder-import.ts` decides
 *     step-by-step whether it knows how to map a given `type`, and skips
 *     with a warning rather than throwing when it does not).
 *   - `.passthrough()` at every level keeps any additional Recorder fields
 *     we do not model (e.g. `offsetX`/`offsetY`, `duration`, `frame`)
 *     intact on the parsed object instead of silently stripping them.
 *
 * `selectors` is Recorder's fallback-chain shape: an array of "selector
 * groups", where each group is itself an array of equivalent selector
 * strings prefixed by engine (`aria/`, `text/`, `xpath/` — note the second
 * slash of an XPath expression makes this `xpath//…`, `pierce/`, or a bare
 * CSS selector with no prefix). The converter flattens + ranks these to
 * pick the most resilient one — see `pickResilientSelector`.
 */
import { z } from 'zod';

export const RecorderAssertedEventSchema = z
  .object({
    type: z.string(),
    url: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();

export const RecorderStepSchema = z
  .object({
    type: z.string().min(1),
    /** Frame/target the step runs against (usually "main"). Not a selector. */
    target: z.string().optional(),
    /** Fallback-chain selector groups — see module doc. */
    selectors: z.array(z.array(z.string())).optional(),
    /** navigate: the destination URL. */
    url: z.string().optional(),
    /** change: the value typed into the field. */
    value: z.string().optional(),
    /** keyDown/keyUp: the key name (e.g. "Enter", "Tab"). */
    key: z.string().optional(),
    /** waitForElement: false = wait for the element to become hidden/absent. */
    visible: z.boolean().optional(),
    /**
     * waitForElement: an element-COUNT assertion instead of a single-element
     * visibility check — e.g. "wait until >= 3 matching elements exist".
     * When present, the converter emits an `assert-count` TestStep instead
     * of `assert-visible`/`assert-hidden` (see recorder-import.ts).
     */
    count: z.number().optional(),
    /**
     * waitForElement: the comparison Recorder recorded for `count` (">=",
     * "==", "<=", …). Only ">=" has a faithful Cypress adapter rendering
     * today (`should('have.length.gte', …)`) — any other operator is
     * converted with a warning rather than silently mis-rendered.
     */
    operator: z.string().optional(),
    /** waitForExpression: the JS expression Recorder waited on. */
    expression: z.string().optional(),
    /** Expected side effects Recorder observed after this step (e.g. a navigation). */
    assertedEvents: z.array(RecorderAssertedEventSchema).optional(),
  })
  .passthrough();

export const RecorderFlowSchema = z
  .object({
    title: z.string(),
    steps: z.array(RecorderStepSchema),
    /**
     * Optional journey metadata tags (e.g. "smoke", "regression").
     * Consumed by the Cypress suite generator for describe-title annotations
     * (`@smoke`, `@regression`). Additive — older Recorder exports omit this.
     */
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

export type RecorderAssertedEvent = z.infer<typeof RecorderAssertedEventSchema>;
export type RecorderStep = z.infer<typeof RecorderStepSchema>;
export type RecorderFlow = z.infer<typeof RecorderFlowSchema>;
