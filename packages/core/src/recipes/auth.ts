/**
 * auth recipe — login / logout / protected-route patterns.
 *
 * Lifted from the PROVEN NQ-2 Playwright specs and CaseLoom Cypress specs.
 * These are REAL selector patterns and assertion patterns used in those test
 * suites, re-derived from first principles (not copy-pasted).
 *
 * NQ-2 Playwright reference patterns:
 *   - page.goto('/login')
 *   - page.locator('[data-testid=login-email]').fill(email)
 *   - page.locator('[data-testid=login-password]').fill(password)
 *   - page.locator('[data-testid=login-submit]').click()
 *   - expect(page.locator('[data-testid=dashboard-root]')).toBeVisible()
 *   - expect(page.locator('[data-testid=login-error]')).toContainText('Invalid')
 *
 * CaseLoom Cypress reference patterns:
 *   - cy.visit('/login')
 *   - cy.get('[data-testid=login-email]').type(email)
 *   - cy.get('[data-testid=login-password]').type(password)
 *   - cy.get('[data-testid=login-submit]').click()
 *   - cy.get('[data-testid=dashboard-root]').should('be.visible')
 *   - cy.get('[data-testid=login-error]').should('contain.text', 'Invalid')
 */
import type { NeutralScenario } from '../schemas/gap-analysis.schema.js';
import type { RecipeConfig } from '../schemas/recipe.schema.js';

/** Defaults from the proven NQ-2 data-testid convention. */
const DEFAULTS = {
  loginUrl: '/login',
  usernameSelector: '[data-testid=login-email]',
  passwordSelector: '[data-testid=login-password]',
  submitSelector: '[data-testid=login-submit]',
  successSelector: '[data-testid=dashboard-root]',
};

/**
 * Generate NeutralScenarios for the auth recipe.
 *
 * Returns 3 scenarios:
 *   1. Happy-path login → lands on dashboard (smoke gate)
 *   2. Invalid-credentials → inline error message shown (negative gate)
 *   3. Protected route redirects unauthenticated users to login (security gate)
 *
 * All selectors come from the proven NQ-2/CaseLoom patterns and are overridable
 * via RecipeConfig, so the recipe works for any form-login app.
 */
export function buildAuthScenarios(config: RecipeConfig = {}): NeutralScenario[] {
  const loginUrl = config.loginUrl ?? DEFAULTS.loginUrl;
  const usernameSelector = config.usernameSelector ?? DEFAULTS.usernameSelector;
  const passwordSelector = config.passwordSelector ?? DEFAULTS.passwordSelector;
  const submitSelector = config.submitSelector ?? DEFAULTS.submitSelector;
  const successSelector = config.successSelector ?? DEFAULTS.successSelector;

  return [
    {
      id: 'recipe-auth-happy-path',
      title: 'User can log in with valid credentials',
      description: 'Submitting valid credentials navigates to the authenticated dashboard',
      targetPath: loginUrl,
      steps: [
        { action: 'navigate', target: loginUrl, description: 'Open the login page' },
        {
          action: 'type',
          target: usernameSelector,
          value: 'user@example.test',
          description: 'Enter email address',
        },
        {
          action: 'type',
          target: passwordSelector,
          value: 'correct-horse',
          description: 'Enter password',
        },
        {
          action: 'click',
          target: submitSelector,
          description: 'Submit the login form',
        },
        {
          action: 'assert-visible',
          target: successSelector,
          description: 'Dashboard or success indicator is shown',
        },
      ],
      tags: ['auth', 'smoke', 'recipe-auth'],
      recommendations: [
        {
          adapter: 'cypress-e2e',
          reason: 'Proven NQ-2 / CaseLoom pattern — cy.get + type/click/should',
          confidence: 'high',
        },
        {
          adapter: 'playwright',
          reason: 'Proven NQ-2 pattern — page.locator + fill/click/expect',
          confidence: 'high',
        },
      ],
      sourceGapIds: ['recipe-auth'],
    },
    {
      id: 'recipe-auth-invalid-credentials',
      title: 'Invalid credentials show an inline error',
      description: 'Submitting wrong credentials stays on the login page and shows an error message',
      targetPath: loginUrl,
      steps: [
        { action: 'navigate', target: loginUrl, description: 'Open the login page' },
        {
          action: 'type',
          target: usernameSelector,
          value: 'user@example.test',
          description: 'Enter email address',
        },
        {
          action: 'type',
          target: passwordSelector,
          value: 'wrong-password',
          description: 'Enter an incorrect password',
        },
        {
          action: 'click',
          target: submitSelector,
          description: 'Submit with wrong credentials',
        },
        {
          action: 'assert-text',
          target: '[data-testid=login-error]',
          value: 'Invalid',
          description: 'Inline error message is shown',
        },
        {
          action: 'assert-visible',
          target: submitSelector,
          description: 'Still on the login page (submit button visible)',
        },
      ],
      tags: ['auth', 'negative', 'recipe-auth'],
      recommendations: [
        {
          adapter: 'cypress-e2e',
          reason: 'Proven NQ-2 negative path — assert-text on error element',
          confidence: 'high',
        },
        {
          adapter: 'playwright',
          reason: 'Proven NQ-2 negative path — toContainText on error element',
          confidence: 'high',
        },
      ],
      sourceGapIds: ['recipe-auth'],
    },
    {
      id: 'recipe-auth-protected-redirect',
      title: 'Unauthenticated access to a protected route redirects to login',
      description:
        'Visiting a protected route without a session redirects to the login page — authentication guard is wired',
      targetPath: '/dashboard',
      steps: [
        {
          action: 'navigate',
          target: '/dashboard',
          description: 'Navigate directly to a protected route',
        },
        {
          action: 'assert-visible',
          target: submitSelector,
          description: 'Login form submit button is visible — we were redirected to login',
        },
      ],
      tags: ['auth', 'security', 'recipe-auth'],
      recommendations: [
        {
          adapter: 'cypress-e2e',
          reason: 'Guards a critical security property — protected routes must redirect',
          confidence: 'medium',
        },
        {
          adapter: 'playwright',
          reason: 'Guards a critical security property — protected routes must redirect',
          confidence: 'medium',
        },
      ],
      sourceGapIds: ['recipe-auth'],
    },
  ];
}
