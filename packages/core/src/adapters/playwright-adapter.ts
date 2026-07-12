import type { TestAdapter } from './adapter.interface.js';
import type { NeutralScenario, GeneratedTest, TestStep } from '../schemas/gap-analysis.schema.js';
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
      return `    await page.goto(${JSON.stringify(step.target ?? step.value ?? '/')});`;
    case 'click':
      return t ? `    await page.locator(${t}).click();` : `    // click: ${sanitizeForComment(step.description)}`;
    case 'type':
      return t && v
        ? `    await page.locator(${t}).fill(${v});`
        : `    // type: ${sanitizeForComment(step.description)}`;
    case 'select':
      return t && v
        ? `    await page.locator(${t}).selectOption(${v});`
        : `    // select: ${sanitizeForComment(step.description)}`;
    case 'key-press':
      // Playwright's .press() takes the exact same key names Chrome
      // DevTools Recorder captures (KeyboardEvent.key values like "Enter",
      // "Tab", "ArrowDown") — unlike Cypress's .type(), it is not limited
      // to a fixed special-sequence whitelist, so this is faithful for
      // every key the converter hands it, including ones Cypress cannot
      // render (see cypress-e2e-adapter.ts's key-press case).
      return t && v
        ? `    await page.locator(${t}).press(${v});`
        : `    // key-press: ${sanitizeForComment(step.description)}`;
    case 'assert-visible':
      return t
        ? `    await expect(page.locator(${t})).toBeVisible();`
        : `    await expect(page.locator('body')).toBeVisible();`;
    case 'assert-hidden':
      return t
        ? `    await expect(page.locator(${t})).toBeHidden();`
        : `    // assert-hidden: ${sanitizeForComment(step.description)}`;
    case 'assert-text':
      if (t && v) return `    await expect(page.locator(${t})).toContainText(${v});`;
      if (t) return `    await expect(page.locator(${t})).not.toBeEmpty();`;
      return `    // assert-text: ${sanitizeForComment(step.description)}`;
    case 'assert-disabled':
      return t
        ? `    await expect(page.locator(${t})).toBeDisabled();`
        : `    // assert-disabled: ${sanitizeForComment(step.description)}`;
    case 'assert-count':
      return t
        ? `    expect(await page.locator(${t}).count()).toBeGreaterThanOrEqual(${parseInt(step.value ?? '1', 10)});`
        : `    // assert-count: ${sanitizeForComment(step.description)}`;
    case 'wait':
      return `    await page.waitForTimeout(${parseInt(step.value ?? '1000', 10)});`;
    case 'api-call':
      return `    expect((await page.request.get(${JSON.stringify(step.target ?? step.value ?? '/')})).status()).toBe(200);`;
    default:
      return `    // TODO: ${sanitizeForComment(step.description)}`;
  }
}

/**
 * Render a recipe-specific step override for Playwright.
 * Returns null when no override applies — falls through to renderStep.
 */
function renderRecipeStep(step: TestStep, scenario: NeutralScenario): string | null {
  const tags = scenario.tags ?? [];
  // a11y recipe: title assertion — page.title() instead of page.locator('title')
  if (tags.includes('recipe-a11y') && step.action === 'assert-text' && step.target === 'title') {
    return `    expect(await page.title()).not.toBe('');`;
  }
  // a11y recipe: nav count using Playwright count()
  if (tags.includes('recipe-a11y') && step.action === 'assert-count') {
    const t = step.target != null ? JSON.stringify(step.target) : null;
    if (t) {
      return `    expect(await page.locator(${t}).count()).toBeGreaterThanOrEqual(${parseInt(step.value ?? '1', 10)});`;
    }
  }
  return null;
}

export class PlaywrightAdapter implements TestAdapter {
  readonly adapterType = 'playwright';

  render(scenario: NeutralScenario): GeneratedTest {
    const slug = slugify(scenario.title);
    const filename = `${slug}.spec.ts`;

    const stepLines = scenario.steps
      .map((step) => renderRecipeStep(step, scenario) ?? renderStep(step))
      .join('\n');

    const recipeTag = (scenario.tags ?? []).find((t) => t.startsWith('recipe-'));
    // FINDING 3: same newline-safe-comment fix as cypress-e2e-adapter.ts —
    // these are raw, externally-derived NeutralScenario fields going
    // straight into `//` header comments below.
    const recipeComment = recipeTag ? `\n// recipe: ${sanitizeForComment(recipeTag.replace('recipe-', ''))}` : '';

    const code = [
      `// ${sanitizeForComment(scenario.description)}`,
      `// qulib-generated — scenario: ${sanitizeForComment(scenario.id)}${recipeComment}`,
      ``,
      `import { test, expect } from '@playwright/test';`,
      ``,
      `test.describe(${JSON.stringify(scenario.title)}, () => {`,
      `  test(${JSON.stringify(scenario.description)}, async ({ page }) => {`,
      stepLines || `    // no steps — add assertions for: ${sanitizeForComment(scenario.targetPath)}`,
      `  });`,
      `});`,
      ``,
    ].join('\n');

    return {
      scenarioId: scenario.id,
      adapter: 'playwright',
      filename,
      code,
      source: 'template',
      outputPath: `tests/${filename}`,
    };
  }

  renderAll(scenarios: NeutralScenario[]): GeneratedTest[] {
    return scenarios.map((s) => this.render(s));
  }
}
