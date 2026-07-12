import type { TestAdapter } from './adapter.interface.js';
import type { NeutralScenario, GeneratedTest, TestStep } from '../schemas/gap-analysis.schema.js';
import {
  isCypressTypeableKey,
  toCypressTypeToken,
  isSingleTypeableCharacter,
  escapeCypressType,
} from './cypress-special-keys.js';
import { sanitizeForComment } from './comment-safety.js';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function renderStep(step: TestStep): string {
  const t = step.target != null ? JSON.stringify(step.target) : null;
  const v = step.value != null ? JSON.stringify(step.value) : null;

  switch (step.action) {
    case 'navigate':
      return `    cy.visit(${JSON.stringify(step.target ?? step.value ?? '/')});`;
    case 'click':
      return t ? `    cy.get(${t}).click();` : `    // click: ${sanitizeForComment(step.description)}`;
    // FINDING 1 (round-6 STRUCTURAL fix): this is the COMMON path — any
    // recorded `change`-event text becomes a 'type' TestStep — and it used
    // to interpolate `v` (a plain `JSON.stringify(step.value)`) into
    // `.type()` with NO Cypress-DSL escaping. `JSON.stringify` only escapes
    // for the surrounding JS *string literal*; it does nothing about `{`,
    // which Cypress's `.type()` DSL treats as a special-sequence opener at
    // its OWN runtime layer, one level below JS string parsing. A value
    // like `"press {enter} to search"` compiled fine but silently typed
    // "press ", fired a REAL Enter keypress, then typed " to search" — see
    // `escapeCypressType` in cypress-special-keys.ts for the full citation.
    // Every `.type()` call in this file now routes through that ONE
    // choke-point — see the guard test in
    // __tests__/type-and-comment-choke-point-guard.test.ts, which fails the
    // build if a future `.type()` site bypasses it.
    case 'type':
      return t && step.value != null
        ? `    cy.get(${t}).type(${JSON.stringify(escapeCypressType(step.value))});`
        : `    // type: ${sanitizeForComment(step.description)}`;
    case 'select':
      return t && v ? `    cy.get(${t}).select(${v});` : `    // select: ${sanitizeForComment(step.description)}`;
    case 'key-press': {
      const key = step.value;
      if (!t || !key) return `    // key-press: ${sanitizeForComment(step.description)}`;
      if (isCypressTypeableKey(key)) {
        return `    cy.get(${t}).type(${JSON.stringify(toCypressTypeToken(key))});`;
      }
      // FINDING 2 (round-4): a single printable character (letter/digit/
      // punctuation/space) is NOT a Cypress special-sequence token, but it
      // renders FAITHFULLY via a plain unbraced .type(char) call — the exact
      // same primitive the 'type' action above already uses — firing a real
      // keydown/keypress/input/keyup sequence. Routing this through the
      // {token} whitelist check (which it can never pass, since it isn't a
      // multi-character key NAME) or the safe-comment fallback below would
      // be an inverse facade: a common single-key shortcut recording (e.g.
      // Gmail's "c"/"j"/"k") would wrongly get a broken comment instead of
      // the working code. Never route this through toCypressTypeToken —
      // that throws for anything outside CYPRESS_SPECIAL_KEY_MAP.
      //
      // FINDING 1 (round-5 fix, round-6 re-homed): "faithful" is not
      // "verbatim". A literal "{" keypress is a single printable character,
      // but Cypress's .type() treats an unescaped "{" as the OPENING of a
      // {token} special-sequence — cy.get(t).type("{") THROWS at real
      // Cypress runtime (it never finds a closing "}" that resolves to a
      // known token), even though the generated spec compiles fine. This
      // now routes through the SAME escapeCypressType choke-point the
      // 'type' action above uses (round-6 unified the two call sites into
      // one escaper — see cypress-special-keys.ts) rather than a
      // single-char-only variant; every other single printable character
      // (including "}", which is never special on its own) still passes
      // through unchanged.
      if (isSingleTypeableCharacter(key)) {
        return `    cy.get(${t}).type(${JSON.stringify(escapeCypressType(key))});`;
      }
      // Genuinely un-typeable: outside BOTH the {token} whitelist AND a
      // single printable character (e.g. "Tab", "F1", "Shift") —
      // cy.type("{tab}") throws at real Cypress runtime, so NEVER emit that
      // string. A safe, non-throwing comment naming the exact gap beats a
      // spec that compiles but crashes the first time it actually runs.
      // FINDING 3 (round-5): `key` and `step.description` are raw external
      // text going straight into a `//` comment — sanitizeForComment strips
      // any embedded newline so neither field can prematurely terminate
      // this comment and leak the rest of the line as live code.
      return (
        `    // key-press: "${sanitizeForComment(key)}" is outside Cypress's .type() special-sequence whitelist — ` +
        `cy.type() would throw at runtime for this key. Use cy.get(${t}).trigger('keydown', { key: ${JSON.stringify(key)} }) ` +
        `or cy.realPress(${JSON.stringify(key)}) (cypress-real-events) instead. ${sanitizeForComment(step.description)}`
      );
    }
    case 'assert-visible':
      return t ? `    cy.get(${t}).should('be.visible');` : `    cy.get('body').should('be.visible');`;
    case 'assert-hidden':
      return t
        ? `    cy.get(${t}).should('not.be.visible');`
        : `    // assert-hidden: ${sanitizeForComment(step.description)}`;
    case 'assert-text':
      if (t && v) return `    cy.get(${t}).should('contain.text', ${v});`;
      if (t) return `    cy.get(${t}).should('not.be.empty');`;
      return `    // assert-text: ${sanitizeForComment(step.description)}`;
    case 'assert-disabled':
      return t
        ? `    cy.get(${t}).should('be.disabled');`
        : `    // assert-disabled: ${sanitizeForComment(step.description)}`;
    case 'assert-count':
      return t
        ? `    cy.get(${t}).should('have.length.gte', ${parseInt(step.value ?? '1', 10)});`
        : `    // assert-count: ${sanitizeForComment(step.description)}`;
    case 'wait':
      return `    cy.wait(${parseInt(step.value ?? '1000', 10)});`;
    case 'api-call':
      return `    cy.request(${JSON.stringify(step.target ?? step.value ?? '/')}).its('status').should('eq', 200);`;
    default:
      return `    // TODO: ${sanitizeForComment(step.description)}`;
  }
}

/**
 * Render a recipe-specific step override for Cypress.
 * Returns null when no override applies — falls through to renderStep.
 */
function renderRecipeStep(step: TestStep, scenario: NeutralScenario): string | null {
  const tags = scenario.tags ?? [];
  // a11y recipe: title assertion — cy.title() instead of cy.get('title')
  if (tags.includes('recipe-a11y') && step.action === 'assert-text' && step.target === 'title') {
    return `    cy.title().should('not.be.empty');`;
  }
  // a11y recipe: nav count using proper Cypress assertion
  if (tags.includes('recipe-a11y') && step.action === 'assert-count') {
    const t = step.target != null ? JSON.stringify(step.target) : null;
    if (t) {
      return `    cy.get(${t}).its('length').should('be.gte', ${parseInt(step.value ?? '1', 10)});`;
    }
  }
  return null;
}

export class CypressE2EAdapter implements TestAdapter {
  readonly adapterType = 'cypress-e2e';

  render(scenario: NeutralScenario): GeneratedTest {
    const slug = slugify(scenario.title);
    const filename = `${slug}.cy.ts`;

    const stepLines = scenario.steps
      .map((step) => renderRecipeStep(step, scenario) ?? renderStep(step))
      .join('\n');

    const recipeTag = (scenario.tags ?? []).find((t) => t.startsWith('recipe-'));
    // FINDING 3: recipeTag/scenario.description/scenario.id/scenario.targetPath
    // are all raw, externally-derived fields (NeutralScenario is a caller-
    // supplied shape, not something only Recorder ever produces) going
    // straight into `//` header comments below — sanitizeForComment strips
    // any embedded newline so none of them can prematurely terminate a
    // comment and leak trailing text as live code.
    //
    // ROUND-7: this used to be built as a separate `recipeComment` string
    // (itself safely sanitized) and then spliced into the SAME template as a
    // second, bare `${recipeComment}` interpolation. The round-7 guard is
    // shape-based — it flags every unsanitized `${...}` hole in a `//`
    // comment, with no "trust me, this one's already safe" carve-out — so a
    // bare-identifier splice like that reads as a violation even though the
    // value itself was safe. Emitting the recipe note as its own standalone
    // comment line (only when present) avoids the double-interpolation
    // pattern entirely: each `//` line now sanitizes its own field directly.
    const recipeLine = recipeTag ? `// recipe: ${sanitizeForComment(recipeTag.replace('recipe-', ''))}` : null;

    const code = [
      `// ${sanitizeForComment(scenario.description)}`,
      `// qulib-generated — scenario: ${sanitizeForComment(scenario.id)}`,
      ...(recipeLine ? [recipeLine] : []),
      ``,
      `describe(${JSON.stringify(scenario.title)}, () => {`,
      `  it(${JSON.stringify(scenario.description)}, () => {`,
      stepLines || `    // no steps — add assertions for: ${sanitizeForComment(scenario.targetPath)}`,
      `  });`,
      `});`,
      ``,
    ].join('\n');

    return {
      scenarioId: scenario.id,
      adapter: 'cypress-e2e',
      filename,
      code,
      source: 'template',
      outputPath: `cypress/e2e/${filename}`,
    };
  }

  renderAll(scenarios: NeutralScenario[]): GeneratedTest[] {
    return scenarios.map((s) => this.render(s));
  }
}
