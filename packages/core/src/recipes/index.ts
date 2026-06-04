/**
 * Recipe toolshed — reusable NeutralScenario builders.
 *
 * Each recipe module exports a build* function that returns NeutralScenario[].
 * Recipes are merged (additive) into whatever scenarios the adapter already has;
 * they never replace existing scenarios.
 *
 * Available recipes:
 *   auth  — login / logout / protected-route flows
 *   a11y  — accessibility checks (landmark/heading/aria/title)
 *   nav   — deep-link / browser-back / 404-handling
 *   seed  — data-seeding and state-reset helpers
 */
import type { RecipeId, RecipeConfig } from '../schemas/recipe.schema.js';
import type { NeutralScenario } from '../schemas/gap-analysis.schema.js';
import { buildAuthScenarios } from './auth.js';
import { buildA11yScenarios } from './a11y.js';
import { buildNavScenarios } from './nav.js';
import { buildSeedScenarios } from './seed.js';

export { buildAuthScenarios } from './auth.js';
export { buildA11yScenarios } from './a11y.js';
export { buildNavScenarios } from './nav.js';
export { buildSeedScenarios } from './seed.js';

/**
 * Expand a list of RecipeIds into their NeutralScenario arrays, applying
 * optional per-recipe config. Returns an empty array when ids is empty or
 * undefined — safe to call unconditionally.
 */
export function expandRecipes(
  ids: RecipeId[] | undefined,
  config: RecipeConfig = {}
): NeutralScenario[] {
  if (!ids || ids.length === 0) return [];

  const scenarios: NeutralScenario[] = [];
  for (const id of ids) {
    switch (id) {
      case 'auth':
        scenarios.push(...buildAuthScenarios(config));
        break;
      case 'a11y':
        scenarios.push(...buildA11yScenarios(config));
        break;
      case 'nav':
        scenarios.push(...buildNavScenarios(config));
        break;
      case 'seed':
        scenarios.push(...buildSeedScenarios(config));
        break;
      default: {
        // TypeScript exhaustiveness: if a new RecipeId is added without a case
        // this will cause a compile error.
        const _exhaustive: never = id;
        throw new Error(`Unknown recipe id: ${String(_exhaustive)}`);
      }
    }
  }
  return scenarios;
}
