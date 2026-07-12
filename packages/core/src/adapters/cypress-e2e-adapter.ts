import type { TestAdapter } from './adapter.interface.js';
import type { NeutralScenario, GeneratedTest, TestStep } from '../schemas/gap-analysis.schema.js';

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
      return t ? `    cy.get(${t}).click();` : `    // click: ${step.description}`;
    case 'type':
      return t && v ? `    cy.get(${t}).type(${v});` : `    // type: ${step.description}`;
    case 'select':
      return t && v ? `    cy.get(${t}).select(${v});` : `    // select: ${step.description}`;
    case 'assert-visible':
      return t ? `    cy.get(${t}).should('be.visible');` : `    cy.get('body').should('be.visible');`;
    case 'assert-hidden':
      return t ? `    cy.get(${t}).should('not.be.visible');` : `    // assert-hidden: ${step.description}`;
    case 'assert-text':
      if (t && v) return `    cy.get(${t}).should('contain.text', ${v});`;
      if (t) return `    cy.get(${t}).should('not.be.empty');`;
      return `    // assert-text: ${step.description}`;
    case 'assert-disabled':
      return t ? `    cy.get(${t}).should('be.disabled');` : `    // assert-disabled: ${step.description}`;
    case 'assert-count':
      return t
        ? `    cy.get(${t}).should('have.length.gte', ${parseInt(step.value ?? '1', 10)});`
        : `    // assert-count: ${step.description}`;
    case 'wait':
      return `    cy.wait(${parseInt(step.value ?? '1000', 10)});`;
    case 'api-call':
      return `    cy.request(${JSON.stringify(step.target ?? step.value ?? '/')}).its('status').should('eq', 200);`;
    default:
      return `    // TODO: ${step.description}`;
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
    const recipeComment = recipeTag ? `\n// recipe: ${recipeTag.replace('recipe-', '')}` : '';

    const code = [
      `// ${scenario.description}`,
      `// qulib-generated — scenario: ${scenario.id}${recipeComment}`,
      ``,
      `describe(${JSON.stringify(scenario.title)}, () => {`,
      `  it(${JSON.stringify(scenario.description)}, () => {`,
      stepLines || `    // no steps — add assertions for: ${scenario.targetPath}`,
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
