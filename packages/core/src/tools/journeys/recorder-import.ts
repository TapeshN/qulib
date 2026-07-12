/**
 * Chrome DevTools Recorder → NeutralScenario converter.
 *
 * Chrome's Recorder panel (and Puppeteer's `PuppeteerReplay` export) captures
 * a user flow as `{ title, steps: [...] }`. This module maps that shape onto
 * qulib's existing `NeutralScenario` model (`schemas/gap-analysis.schema.ts`)
 * — the SAME model `analyzeApp`'s crawl produces, recipes (`recipes/*.ts`)
 * produce, and `scaffoldTests`/every `TestAdapter` (`adapters/*.ts`) consume.
 * A converted scenario is indistinguishable, downstream, from a
 * crawl-derived or recipe-derived one: it flows through
 * `scaffoldTests(url, { scenarios })` exactly the same way (see
 * `scaffold-tests.ts` — `options.scenarios` is precisely where externally
 * supplied journeys already enter the pipeline; the MCP tool wiring in
 * `packages/mcp/src/index.ts` adds a Recorder-JSON path onto that same
 * entry point).
 *
 * Mapping table (recorder step `type` → NeutralScenario `TestStep.action`) —
 * see the exhaustive step-type x adapter fidelity matrix in this module's
 * test file (`__tests__/recorder-import.test.ts`) for the authoritative,
 * test-backed version of this table:
 *   navigate           → 'navigate'        (also seeds `targetPath` from the
 *                                            FIRST navigate step's URL path)
 *   click, doubleClick → 'click'           (doubleClick downgrades to a
 *                                            single click — TestStep has no
 *                                            distinct double-click action —
 *                                            and is warned about)
 *   change             → 'type'            (value carried through verbatim —
 *                                            see the "change vs select vs
 *                                            checkbox/radio" warning below;
 *                                            Recorder cannot tell a
 *                                            `<select>`/checkbox/radio from
 *                                            a text input, so this is a
 *                                            WARNED guess, never a silent one)
 *   keyDown            → 'key-press'       (a framework-neutral key-press
 *                                            TestStep — NOT Cypress-only
 *                                            `{key}` syntax, which would be
 *                                            wrong under Playwright (a
 *                                            literal string) AND wrong under
 *                                            Cypress for any key outside its
 *                                            small special-sequence
 *                                            whitelist (e.g. "Tab" throws).
 *                                            Each adapter renders `key-press`
 *                                            in its own idiom at RENDER
 *                                            time — see cypress-e2e-adapter
 *                                            .ts / playwright-adapter.ts —
 *                                            against the last interacted
 *                                            selector, since keyDown steps in
 *                                            a Recorder export do not carry
 *                                            their own `selectors`, they act
 *                                            on whatever currently has focus.
 *                                            A key outside Cypress's
 *                                            whitelist is warned about by
 *                                            name here, at conversion time,
 *                                            since Playwright's `.press()`
 *                                            renders virtually any key
 *                                            faithfully and only Cypress is
 *                                            at risk)
 *   waitForElement     → 'assert-visible' / 'assert-hidden' (per `visible`),
 *                         or 'assert-count' when the step carries a `count`
 *                         (an element-COUNT assertion rather than a single-
 *                         element check) — only the `>=` `operator` has a
 *                         faithful rendering in EITHER adapter today (both
 *                         cypress-e2e and playwright only render `>=`), any
 *                         other operator ("==", "<=", …) is converted with a
 *                         warning naming BOTH adapters since it cannot be
 *                         rendered faithfully in either
 *   assertedEvents     → an extra 'assert-visible' step per `navigation`
 *                         event that carries a `url` (appended right after
 *                         the step that caused it — NeutralScenario has no
 *                         dedicated "expected outcome" field, so this is
 *                         encoded as an assertion step rather than silently
 *                         dropped); a `navigation` event with no `url`, or
 *                         any event whose `type` is not `navigation`, is
 *                         warned about by name rather than silently no-op'd
 *
 * Change vs select vs checkbox/radio: Chrome Recorder's `change` step looks
 * IDENTICAL whether the user typed into a text input, picked an option from
 * a `<select>`, or toggled a checkbox/radio — there is no field that
 * disambiguates any of these. Guessing 'type' silently would be false
 * confidence: the generated `.type(value)` throws at runtime in BOTH
 * Cypress (`cy.get(t).type(v)`) and Playwright (`page.locator(t).fill(v)`)
 * against a real `<select>`, checkbox, or radio, even though the scenario is
 * schema-valid and the generated spec compiles. So every `change` step is
 * converted to 'type' AND paired with a warning naming ALL THREE
 * non-text-input risks — never a warning that reassures a reviewer about
 * only one of several equally-real failure modes. A reviewer who confirms
 * the target is a `<select>` can hand-edit that one step's `action` to the
 * 'select' TestStep action (renders `cy.get(t).select(v)` /
 * `page.locator(t).selectOption(v)`); a checkbox/radio target should become
 * a 'click' step instead.
 *
 * Anything else Recorder can emit (keyUp, hover, scroll, waitForExpression,
 * and any step type we have never seen) is TOLERATED — parsing never throws
 * on it — but is not mappable to today's TestStep vocabulary, so it is
 * skipped with a warning rather than silently dropped or forced into a
 * misleading action. The one exception is `setViewport`, which is genuinely
 * informational (viewport metadata, not a user-facing action) but is still
 * warned about — the recorded dimensions are NOT threaded into the
 * generated project config (which uses a fixed default viewport), so
 * silently no-op'ing it would drop real signal without a trace. `keyUp` is
 * the one truly silent no-op: it is always paired with the `keyDown` that
 * already produced a full `key-press` step, so nothing is lost.
 *
 * Selector resilience: a Recorder step's `selectors` field is a fallback
 * chain of alternative selector strings, engine-prefixed (`aria/`, `text/`,
 * `xpath/` — an XPath expression's own leading `/` makes this look like
 * `xpath//…`, `pierce/`) or bare CSS. `pickResilientSelector` ranks
 * `aria` > `text` > `css`/`pierce` > `xpath`, preferring the selectors least
 * coupled to DOM structure — an aria-label or visible-text selector survives
 * a markup refactor that would break a brittle XPath or nth-child CSS path.
 */
import type { NeutralScenario, TestStep } from '../../schemas/gap-analysis.schema.js';
import { NeutralScenarioSchema } from '../../schemas/gap-analysis.schema.js';
import { RecorderFlowSchema, type RecorderFlow, type RecorderStep } from '../../schemas/recorder-flow.schema.js';
import { isCypressTypeableKey } from '../../adapters/cypress-special-keys.js';

// ---------------------------------------------------------------------------
// Format auto-detection
// ---------------------------------------------------------------------------

/**
 * Cheap structural check — NOT full schema validation — for "does this look
 * like a Chrome DevTools Recorder export": an object with a string `title`
 * and a `steps` array whose entries each carry a string `type`. This is the
 * discriminator the MCP tool surface uses to auto-detect a Recorder journey
 * among otherwise-NeutralScenario-shaped input: a NeutralScenario's steps
 * carry `action`, never `type`, so the two shapes never collide.
 */
export function isRecorderFlow(value: unknown): value is { title: string; steps: unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || !Array.isArray(v.steps)) return false;
  if (v.steps.length === 0) return true;
  return v.steps.every(
    (s) => typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).type === 'string'
  );
}

// ---------------------------------------------------------------------------
// Selector resilience
// ---------------------------------------------------------------------------

export type SelectorRank = 'aria' | 'text' | 'css' | 'pierce' | 'xpath';

/** Preference order, most resilient first. Lower index = preferred. */
const RANK_ORDER: readonly SelectorRank[] = ['aria', 'text', 'css', 'pierce', 'xpath'];

export interface ResilientSelector {
  selector: string;
  rank: SelectorRank;
}

function classifySelector(selector: string): SelectorRank {
  if (selector.startsWith('aria/')) return 'aria';
  if (selector.startsWith('text/')) return 'text';
  if (selector.startsWith('xpath/')) return 'xpath'; // covers 'xpath//…'
  if (selector.startsWith('pierce/')) return 'pierce';
  return 'css';
}

/**
 * Flatten a Recorder `selectors` fallback chain and pick the most resilient
 * entry (aria > text > css/pierce > xpath). Returns `undefined` when the
 * step carries no selectors at all (e.g. a `keyDown` acting on whatever
 * currently has focus).
 */
export function pickResilientSelector(selectors: string[][] | undefined): ResilientSelector | undefined {
  if (!selectors) return undefined;
  const flat = selectors.flat().filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (flat.length === 0) return undefined;

  let best: (ResilientSelector & { order: number }) | undefined;
  for (const selector of flat) {
    const rank = classifySelector(selector);
    const order = RANK_ORDER.indexOf(rank);
    if (!best || order < best.order) {
      best = { selector, rank, order };
    }
  }
  return best ? { selector: best.selector, rank: best.rank } : undefined;
}

function describeSelector(pick: ResilientSelector | undefined): string {
  if (!pick) return 'the target element';
  if (pick.rank === 'aria') return `"${pick.selector.replace(/^aria\//, '')}" (aria)`;
  if (pick.rank === 'text') return `"${pick.selector.replace(/^text\//, '')}" (text)`;
  return pick.selector;
}

// ---------------------------------------------------------------------------
// URL → path
// ---------------------------------------------------------------------------

/**
 * Reduce a navigate step's absolute URL to a baseUrl-relative path (+ query),
 * matching how every existing NeutralScenario producer (recipes/*.ts, the
 * scaffold golden corpus) expresses `TestStep.target` for navigation — a
 * path Cypress/Playwright resolve against their own configured baseUrl, not
 * a hard-coded origin that may not match the app under test.
 */
function pathFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    return path.length > 0 ? path : '/';
  } catch {
    // Not an absolute URL. Keep it as a path rather than throwing — a
    // malformed navigate URL is a warning-worthy oddity, not a hard failure.
    return url.startsWith('/') ? url : `/${url}`;
  }
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

export interface RecorderImportResult {
  scenario: NeutralScenario;
  /**
   * Non-fatal notes: steps that were tolerated but not mapped (unknown
   * types, hover/scroll/waitForExpression, a doubleClick downgraded to
   * click, a keyDown with no known target, …). Never throws for these —
   * only a structurally malformed flow (see `RecorderFlowSchema`) throws.
   */
  warnings: string[];
  /**
   * `true` when NOT ONE recorded step converted to a TestStep — every step
   * was unmappable (hover/scroll/waitForExpression/unknown) or skipped for
   * lack of a usable selector. `scenario` is still returned (self-verifying,
   * schema-valid) so a caller not tracking rejection still gets a well-formed
   * value, but a caller that scaffolds/counts scenarios MUST treat a
   * `rejected: true` result as "nothing to test", never a successful
   * conversion — see `resolveJourneyScenarios` (the MCP wiring) for the
   * consumer that acts on this flag.
   */
  rejected: boolean;
}

/**
 * Parse + convert a Chrome DevTools Recorder export into a NeutralScenario.
 * Throws a precise error when `raw` does not even match the Recorder
 * envelope shape (not an object, no `title`, `steps` not an array, or a
 * step that is not an object with a string `type`). Never throws for a step
 * whose `type` we simply do not know how to map — that is a warning.
 */
export function importRecorderFlow(raw: unknown): RecorderImportResult {
  const parsed = RecorderFlowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Chrome DevTools Recorder flow failed schema validation: ${parsed.error.message}`);
  }
  const flow: RecorderFlow = parsed.data;
  const title = flow.title.trim().length > 0 ? flow.title.trim() : 'Untitled Recorder Flow';

  const warnings: string[] = [];
  const steps: TestStep[] = [];
  let targetPath: string | undefined;
  let lastTarget: string | undefined;

  const pushAssertedEvents = (step: RecorderStep, index: number): void => {
    for (const event of step.assertedEvents ?? []) {
      if (event.type === 'navigation' && event.url) {
        steps.push({
          action: 'assert-visible',
          description: `Expect navigation to complete: ${event.url}${event.title ? ` ("${event.title}")` : ''}`,
        });
      } else if (event.type === 'navigation') {
        warnings.push(`step ${index}: assertedEvents navigation had no url — skipped assertion`);
      } else {
        // FINDING 3: any assertedEvents type other than "navigation" was
        // previously a silent no-op — contradicting this module's own
        // "unmappable signals are skipped WITH A WARNING" contract. Never
        // drop an observed event without saying so.
        warnings.push(
          `step ${index}: assertedEvents type "${event.type}" has no NeutralScenario equivalent — skipped`
        );
      }
    }
  };

  flow.steps.forEach((step, index) => {
    switch (step.type) {
      case 'setViewport':
        // Informational device/viewport metadata — no user-facing action to
        // map to a TestStep. Still warned about (not a silent no-op): the
        // recorded dimensions are NOT threaded into the generated project
        // config, which uses a fixed default viewport regardless — a
        // reviewer relying on the recorded viewport would be silently wrong.
        warnings.push(
          `setViewport step at index ${index} is informational only — its dimensions are not translated into ` +
            `a TestStep or the generated project config (cypress.config.ts / playwright.config.ts both use a ` +
            `fixed default viewport, not the recorded one)`
        );
        break;

      case 'navigate': {
        const url = step.url ?? step.value;
        if (!url) {
          warnings.push(`navigate step at index ${index} has no url — skipped`);
          break;
        }
        const path = pathFromUrl(url);
        if (targetPath === undefined) targetPath = path;
        steps.push({ action: 'navigate', target: path, description: `Navigate to ${url}` });
        break;
      }

      case 'click':
      case 'doubleClick': {
        const pick = pickResilientSelector(step.selectors);
        if (!pick) {
          warnings.push(`${step.type} step at index ${index} has no usable selector — skipped`);
          break;
        }
        lastTarget = pick.selector;
        if (step.type === 'doubleClick') {
          warnings.push(
            `doubleClick step at index ${index} mapped to a single click (NeutralScenario has no distinct double-click action)`
          );
        }
        const verb = step.type === 'doubleClick' ? 'Double-click' : 'Click';
        steps.push({ action: 'click', target: pick.selector, description: `${verb} ${describeSelector(pick)}` });
        break;
      }

      case 'change': {
        const pick = pickResilientSelector(step.selectors);
        if (!pick) {
          warnings.push(`change step at index ${index} has no usable selector — skipped`);
          break;
        }
        lastTarget = pick.selector;
        const value = step.value ?? '';
        steps.push({
          action: 'type',
          target: pick.selector,
          value,
          description: `Type ${JSON.stringify(value)} into ${describeSelector(pick)}`,
        });
        // Recorder's `change` step is identical for a text input, a
        // <select>, a checkbox, and a radio button — there is no field that
        // disambiguates any of them. Guessing 'type' silently would be false
        // confidence: BOTH cy.get(t).type(v) (Cypress) and
        // page.locator(t).fill(v) (Playwright) throw at runtime against a
        // real <select>, checkbox, or radio, even though this scenario is
        // schema-valid and the generated spec compiles. Warn on EVERY change
        // step, naming ALL THREE non-text-input risks — a warning that
        // trains a reviewer to rule out only ONE of several real risks
        // (e.g. "may be a <select>" alone, when checkbox/radio are equally
        // real) is worse than no warning at all (FINDING 2).
        warnings.push(
          `change step at index ${index}: target ${describeSelector(pick)} may be a non-text-input element — ` +
            `Recorder's change step looks identical for a text input, a <select>, a checkbox, and a radio ` +
            `button. Both cy.get(t).type(v) (Cypress) and page.locator(t).fill(v) (Playwright) require a ` +
            `text-like input, textarea, or [contenteditable] target and throw at runtime against a <select>, ` +
            `checkbox, or radio. If this targets a <select>, change this step's action to "select" (renders ` +
            `cy.get(...).select(value) / page.locator(...).selectOption(value)) after confirming against the ` +
            `real page. If it targets a checkbox or radio, change this step's action to "click" instead.`
        );
        break;
      }

      case 'keyDown': {
        // FINDING 1: keyDown maps to a framework-neutral 'key-press'
        // TestStep, carrying the RAW key name (Recorder's own
        // KeyboardEvent.key value, e.g. "Enter", "Tab") — never
        // Cypress-only `{key}` syntax baked in at conversion time. That
        // would be wrong under Playwright (fill()/type-equivalents would
        // write the LITERAL string "{enter}" rather than pressing a key)
        // and wrong under Cypress itself for any key outside its small
        // special-sequence whitelist (e.g. "Tab" throws). Each adapter
        // renders 'key-press' in its own idiom at RENDER time — see
        // cypress-e2e-adapter.ts and playwright-adapter.ts.
        const key = step.key;
        if (!key) {
          warnings.push(`keyDown step at index ${index} has no key — skipped`);
          break;
        }
        const pick = pickResilientSelector(step.selectors);
        const target = pick?.selector ?? lastTarget;
        if (!target) {
          warnings.push(`keyDown step at index ${index} (key="${key}") has no known target element — skipped`);
          break;
        }
        // Playwright's page.locator(t).press() accepts virtually any
        // KeyboardEvent.key value faithfully, so it is never at risk here.
        // Cypress's .type() is limited to a small special-sequence
        // whitelist — a key outside it (e.g. "Tab") is warned about BY
        // NAME at conversion time, since the Cypress adapter will fall back
        // to a safe comment rather than emitting code that throws.
        if (!isCypressTypeableKey(key)) {
          warnings.push(
            `keyDown step at index ${index}: key "${key}" is outside Cypress's .type() special-sequence ` +
              `whitelist — the cypress-e2e adapter cannot render a real key-press for this key (it will emit ` +
              `a non-throwing placeholder comment instead of code that crashes at runtime); the playwright ` +
              `adapter renders it faithfully via .press("${key}").`
          );
        }
        steps.push({
          action: 'key-press',
          target,
          value: key,
          description: `Press ${key} on ${describeSelector(pick ?? { selector: target, rank: 'css' })}`,
        });
        break;
      }

      case 'keyUp':
        // Paired with keyDown — the key press is already captured; keyUp adds nothing new.
        break;

      case 'waitForElement': {
        const pick = pickResilientSelector(step.selectors);
        if (!pick) {
          warnings.push(`waitForElement step at index ${index} has no usable selector — skipped`);
          break;
        }
        if (step.count !== undefined) {
          // An element-COUNT assertion, not a single-element visibility
          // check — TestStep already has 'assert-count' and the Cypress
          // adapter already renders it (should('have.length.gte', …)).
          // Silently downgrading this to assert-visible would discard the
          // count semantics entirely with zero warning.
          const operator = step.operator ?? '>=';
          if (operator !== '>=') {
            // Naming only ONE adapter here would be a false-reassurance
            // warning (the same class as FINDING 2): both cypress-e2e and
            // playwright are equally limited to ">=" for assert-count today,
            // so a reviewer must not be led to think switching adapters
            // fixes the fidelity gap.
            warnings.push(
              `waitForElement step at index ${index}: element-count operator "${operator}" has no faithful ` +
                `rendering in EITHER adapter (cypress-e2e only renders ">=" via should('have.length.gte', …); ` +
                `playwright only renders ">=" via toBeGreaterThanOrEqual(…)) — converted to assert-count ` +
                `anyway, but it will enforce ">=" semantics, not "${operator}", regardless of which adapter ` +
                `generates the spec`
            );
          }
          steps.push({
            action: 'assert-count',
            target: pick.selector,
            value: String(step.count),
            description: `Wait for ${describeSelector(pick)} count ${operator} ${step.count}`,
          });
          break;
        }
        const hidden = step.visible === false;
        steps.push({
          action: hidden ? 'assert-hidden' : 'assert-visible',
          target: pick.selector,
          description: `Wait for ${describeSelector(pick)} to be ${hidden ? 'hidden' : 'visible'}`,
        });
        break;
      }

      case 'hover':
        warnings.push(`hover step at index ${index} has no NeutralScenario equivalent — skipped`);
        break;

      case 'scroll':
        warnings.push(`scroll step at index ${index} has no NeutralScenario equivalent — skipped`);
        break;

      case 'waitForExpression':
        warnings.push(
          `waitForExpression step at index ${index} cannot be safely translated (arbitrary JS expression) — skipped`
        );
        break;

      default:
        warnings.push(`unknown step type "${step.type}" at index ${index} — skipped`);
        break;
    }

    pushAssertedEvents(step, index);
  });

  if (targetPath === undefined) {
    warnings.push('flow has no navigate step — scenario targetPath defaults to "/"');
    targetPath = '/';
  }
  if (steps.length === 0) {
    warnings.push('no steps could be converted from this recorder flow — resulting scenario has zero steps');
  }

  const scenario: NeutralScenario = {
    id: `recorder-${slugify(title)}`,
    title,
    description: `Imported from a Chrome DevTools Recorder flow ("${title}", ${flow.steps.length} recorded step(s), ${steps.length} converted).`,
    targetPath,
    steps,
    tags: ['recorder-import'],
    recommendations: [
      {
        adapter: 'cypress-e2e',
        reason: 'Recorder selector fallback chains map cleanly onto Cypress cy.get() selector-based steps.',
        confidence: 'medium',
      },
    ],
    sourceGapIds: [],
  };

  // Self-verifying: never hand back a scenario that would fail the schema
  // every other producer/consumer in the codebase already trusts.
  return { scenario: NeutralScenarioSchema.parse(scenario), warnings, rejected: steps.length === 0 };
}
