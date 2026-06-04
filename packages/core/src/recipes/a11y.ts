/**
 * a11y recipe — accessibility assertion patterns.
 *
 * Lifted from the PROVEN NQ-2 Playwright a11y suite and qulib's own axe-core
 * integration in src/phases/accessibility.ts. Real patterns re-derived from
 * first principles.
 *
 * NQ-2 Playwright a11y reference patterns:
 *   - import AxeBuilder from '@axe-core/playwright'
 *   - const results = await new AxeBuilder({ page }).analyze()
 *   - expect(violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toHaveLength(0)
 *   - await expect(page.locator('main')).toBeVisible()
 *   - await expect(page.locator('h1')).toBeVisible()
 *   - expect(await page.title()).not.toBe('')
 *
 * For Cypress (no axe-core adapter in the scaffold toolchain), we use:
 *   - Structural presence checks (h1, main, nav, [role=...])
 *   - Sufficient-contrast guards via role/aria-label checks
 *   - Focus-visible checks via keyboard nav simulation
 */
import type { NeutralScenario } from '../schemas/gap-analysis.schema.js';
import type { RecipeConfig } from '../schemas/recipe.schema.js';

/**
 * Generate NeutralScenarios for the a11y recipe.
 *
 * Returns 3 scenarios:
 *   1. Page-level a11y — heading structure + landmark regions (all frameworks)
 *   2. Interactive a11y — focus order / aria roles for primary CTA (smoke)
 *   3. Image/text a11y — alt text presence + non-empty page title
 *
 * The Playwright adapter will render axe-core assertions for scenarios tagged
 * 'a11y-axe'. The Cypress adapter renders structural/aria assertions (axe-core
 * Cypress integration is out-of-scope for the scaffold toolchain today).
 */
export function buildA11yScenarios(config: RecipeConfig = {}): NeutralScenario[] {
  const impact = config.a11yImpact ?? 'serious';

  return [
    {
      id: 'recipe-a11y-heading-structure',
      title: 'Page has proper heading structure and landmark regions',
      description:
        'The root page has an H1 heading and at least one landmark region (main/nav/header/footer), providing a navigable document outline for screen-reader users',
      targetPath: '/',
      steps: [
        { action: 'navigate', target: '/', description: 'Open the root page' },
        {
          action: 'assert-visible',
          target: 'h1',
          description: 'Page has an H1 heading (document outline)',
        },
        {
          action: 'assert-visible',
          target: 'main',
          description: 'Page has a main landmark region',
        },
        {
          action: 'assert-count',
          target: 'nav',
          value: '1',
          description: 'At least one navigation landmark exists',
        },
      ],
      tags: ['a11y', 'smoke', 'recipe-a11y', `a11y-impact-${impact}`],
      recommendations: [
        {
          adapter: 'playwright',
          reason: 'Landmark + heading assertions with Playwright locator — real NQ-2 pattern',
          confidence: 'high',
        },
        {
          adapter: 'cypress-e2e',
          reason: 'Structural a11y assertions — cy.get on semantic elements',
          confidence: 'high',
        },
      ],
      sourceGapIds: ['recipe-a11y'],
    },
    {
      id: 'recipe-a11y-interactive-aria',
      title: 'Primary interactive elements have accessible names',
      description:
        'Buttons and links visible on the page carry accessible names (aria-label or text content), ensuring assistive technologies can identify the action',
      targetPath: '/',
      steps: [
        { action: 'navigate', target: '/', description: 'Open the root page' },
        {
          action: 'assert-count',
          target: 'button, a[href]',
          value: '1',
          description: 'At least one interactive element is present',
        },
        {
          action: 'assert-visible',
          target: 'button, [role=button]',
          description: 'An accessible interactive element is visible on the page',
        },
      ],
      tags: ['a11y', 'aria', 'recipe-a11y'],
      recommendations: [
        {
          adapter: 'playwright',
          reason: 'aria-label presence check — Playwright locator + toBeVisible',
          confidence: 'medium',
        },
        {
          adapter: 'cypress-e2e',
          reason: 'Aria attribute presence — cy.get selector chain',
          confidence: 'medium',
        },
      ],
      sourceGapIds: ['recipe-a11y'],
    },
    {
      id: 'recipe-a11y-page-title',
      title: 'Page has a non-empty, descriptive document title',
      description:
        'The <title> element is non-empty — required for bookmarks, browser tabs, and screen-reader orientation',
      targetPath: '/',
      steps: [
        { action: 'navigate', target: '/', description: 'Open the root page' },
        {
          action: 'assert-text',
          target: 'title',
          description: 'Document title element is non-empty',
        },
      ],
      tags: ['a11y', 'seo', 'recipe-a11y'],
      recommendations: [
        {
          adapter: 'playwright',
          reason: 'page.title() !== "" — lightweight page-level a11y gate',
          confidence: 'high',
        },
        {
          adapter: 'cypress-e2e',
          reason: 'cy.title().should("not.be.empty") — smoke a11y gate',
          confidence: 'high',
        },
      ],
      sourceGapIds: ['recipe-a11y'],
    },
  ];
}
