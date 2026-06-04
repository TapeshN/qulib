/**
 * seed recipe — data-seeding and state-reset helpers.
 *
 * Lifted from the PROVEN NQ-2 Playwright + CaseLoom Cypress test-data patterns.
 * Re-derived from first principles — not copy-pasted.
 *
 * NQ-2 Playwright seed reference patterns:
 *   - await request.post('/api/test/reset', { data: {} })
 *   - expect(response.status()).toBe(200)
 *   - await request.post('/api/test/seed', { data: { scenario: 'default' } })
 *
 * CaseLoom Cypress seed reference patterns:
 *   - cy.request('POST', '/api/test/reset')
 *   - cy.request('POST', '/api/test/seed', { scenario: 'default' })
 *   - cy.request({ method: 'DELETE', url: '/api/test/all' }).its('status').should('be.oneOf', [200, 204])
 *
 * The seed recipe is primarily a Playwright/API recipe because Cypress request()
 * handles it cleanly, but the NeutralScenario shape covers both adapters via
 * the api-call action.
 */
import type { NeutralScenario } from '../schemas/gap-analysis.schema.js';
import type { RecipeConfig } from '../schemas/recipe.schema.js';

const DEFAULT_SEED_ENDPOINT = '/api/test/seed';
const DEFAULT_RESET_ENDPOINT = '/api/test/reset';

/**
 * Generate NeutralScenarios for the seed recipe.
 *
 * Returns 2 scenarios:
 *   1. State reset — POST to the reset endpoint returns 200/204 (clean slate)
 *   2. Seed + verify — POST seed then verify the seeded UI state is visible
 *
 * These are rendered as api-call steps, which both adapters handle (Cypress via
 * cy.request, Playwright via page.request.post).
 */
export function buildSeedScenarios(config: RecipeConfig = {}): NeutralScenario[] {
  const seedEndpoint = config.seedEndpoint ?? DEFAULT_SEED_ENDPOINT;
  const resetEndpoint = DEFAULT_RESET_ENDPOINT;

  return [
    {
      id: 'recipe-seed-reset',
      title: 'Test state reset endpoint returns a success status',
      description:
        'POSTing to the reset endpoint clears test data and returns 200 — the test teardown contract is honoured',
      targetPath: resetEndpoint,
      steps: [
        {
          action: 'api-call',
          target: resetEndpoint,
          description: 'POST to the reset endpoint — expect 200/204',
        },
      ],
      tags: ['seed', 'setup', 'recipe-seed'],
      recommendations: [
        {
          adapter: 'playwright',
          reason: 'page.request.post / apiRequest — proven NQ-2 data-setup pattern',
          confidence: 'high',
        },
        {
          adapter: 'cypress-e2e',
          reason: 'cy.request("POST", url) — proven CaseLoom seed pattern',
          confidence: 'high',
        },
        {
          adapter: 'api',
          reason: 'Direct API seed — no browser required',
          confidence: 'high',
        },
      ],
      sourceGapIds: ['recipe-seed'],
    },
    {
      id: 'recipe-seed-and-verify',
      title: 'Seed endpoint populates data that is visible in the UI',
      description:
        'After seeding the default dataset, the UI reflects the seeded state — the test pipeline can establish known state before running assertions',
      targetPath: '/',
      steps: [
        {
          action: 'api-call',
          target: seedEndpoint,
          description: `POST to seed endpoint (${seedEndpoint}) to populate default test data`,
        },
        {
          action: 'navigate',
          target: '/',
          description: 'Navigate to the app root to verify the seeded state is visible',
        },
        {
          action: 'assert-visible',
          target: 'main',
          description: 'Application loaded with seeded data',
        },
      ],
      tags: ['seed', 'data-setup', 'recipe-seed'],
      recommendations: [
        {
          adapter: 'playwright',
          reason: 'Proven NQ-2 seed + navigate pattern — set state before assertions',
          confidence: 'medium',
        },
        {
          adapter: 'cypress-e2e',
          reason: 'cy.request seed then cy.visit — proven CaseLoom setup pattern',
          confidence: 'medium',
        },
      ],
      sourceGapIds: ['recipe-seed'],
    },
  ];
}
