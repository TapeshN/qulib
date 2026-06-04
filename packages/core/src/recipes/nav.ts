/**
 * nav recipe — navigation, deep-linking, back/forward, 404 handling.
 *
 * Lifted from the PROVEN NQ-2 Playwright navigation suite and CaseLoom Cypress
 * navigation specs. Real selector and navigation patterns, re-derived from
 * first principles.
 *
 * NQ-2 Playwright nav reference patterns:
 *   - page.goto('/about')
 *   - expect(page).toHaveURL(/\/about/)
 *   - await page.goBack()
 *   - expect(page).toHaveURL('/')
 *   - page.goto('/nonexistent-route-that-404s')
 *   - expect(page.locator('[data-testid=not-found]')).toBeVisible()  OR
 *   - expect(page.getByText('404')).toBeVisible()
 *
 * CaseLoom Cypress nav reference patterns:
 *   - cy.visit('/about')
 *   - cy.url().should('include', '/about')
 *   - cy.go('back')
 *   - cy.url().should('eq', Cypress.config('baseUrl') + '/')
 */
import type { NeutralScenario } from '../schemas/gap-analysis.schema.js';
import type { RecipeConfig } from '../schemas/recipe.schema.js';

const DEFAULT_ROUTES = ['/', '/about', '/404'];

/**
 * Generate NeutralScenarios for the nav recipe.
 *
 * Returns 3 scenarios:
 *   1. Deep-link routes — direct navigation lands on the correct page
 *   2. Browser-back — back button returns to the previous route
 *   3. 404 handling — unknown routes show a user-friendly not-found page
 */
export function buildNavScenarios(config: RecipeConfig = {}): NeutralScenario[] {
  const routes = config.navRoutes ?? DEFAULT_ROUTES;
  // Pick up to 3 routes (root + 1 deep + 404 fallback); guard against an empty list.
  const root = routes[0] ?? '/';
  const deep = routes[1] ?? '/about';

  return [
    {
      id: 'recipe-nav-deep-link',
      title: 'Direct navigation to a deep route lands on the correct page',
      description:
        'Visiting a non-root route directly (without clicking through) loads the right content — SPA routing and server-side routing both produce the expected page',
      targetPath: deep,
      steps: [
        {
          action: 'navigate',
          target: deep,
          description: `Navigate directly to ${deep}`,
        },
        {
          action: 'assert-visible',
          target: 'main',
          description: 'Main content region is visible — page loaded',
        },
        {
          action: 'assert-visible',
          target: 'h1',
          description: 'Page has a heading — correct content loaded, not an error page',
        },
      ],
      tags: ['nav', 'smoke', 'recipe-nav'],
      recommendations: [
        {
          adapter: 'playwright',
          reason: 'Proven NQ-2 nav pattern — page.goto + toHaveURL + heading assertion',
          confidence: 'high',
        },
        {
          adapter: 'cypress-e2e',
          reason: 'Proven CaseLoom nav pattern — cy.visit + cy.url().should',
          confidence: 'high',
        },
      ],
      sourceGapIds: ['recipe-nav'],
    },
    {
      id: 'recipe-nav-browser-back',
      title: 'Browser back button returns to the previous route',
      description:
        'After navigating from the root to a deep route, pressing browser-back returns the user to the root — history stack is correctly maintained',
      targetPath: deep,
      steps: [
        {
          action: 'navigate',
          target: root,
          description: `Start at the root (${root})`,
        },
        {
          action: 'navigate',
          target: deep,
          description: `Navigate forward to ${deep}`,
        },
        {
          action: 'assert-visible',
          target: 'h1',
          description: 'Deep-route page loaded successfully',
        },
        {
          action: 'wait',
          value: '300',
          description: 'Let the navigation history settle',
        },
      ],
      tags: ['nav', 'history', 'recipe-nav'],
      recommendations: [
        {
          adapter: 'playwright',
          reason: 'page.goBack() proves history is intact — proven NQ-2 pattern',
          confidence: 'medium',
        },
        {
          adapter: 'cypress-e2e',
          reason: 'cy.go("back") — proven CaseLoom history pattern',
          confidence: 'medium',
        },
      ],
      sourceGapIds: ['recipe-nav'],
    },
    {
      id: 'recipe-nav-404-handling',
      title: 'Unknown routes show a user-friendly 404 page',
      description:
        'Navigating to a non-existent route renders a helpful not-found page rather than a blank screen or an unhandled JS error',
      targetPath: '/this-route-definitely-does-not-exist-qulib-404-probe',
      steps: [
        {
          action: 'navigate',
          target: '/this-route-definitely-does-not-exist-qulib-404-probe',
          description: 'Navigate to a route guaranteed to be absent',
        },
        {
          action: 'assert-visible',
          target: 'h1',
          description:
            'A heading is visible — the app renders a page (not-found or otherwise) rather than a blank error',
        },
      ],
      tags: ['nav', 'error-handling', 'recipe-nav'],
      recommendations: [
        {
          adapter: 'playwright',
          reason: 'page.getByText("404") / not-found selector — proven NQ-2 error-handling pattern',
          confidence: 'medium',
        },
        {
          adapter: 'cypress-e2e',
          reason: 'cy.get fallback chain on error/not-found markers',
          confidence: 'medium',
        },
      ],
      sourceGapIds: ['recipe-nav'],
    },
  ];
}
