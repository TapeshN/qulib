import { z } from 'zod';

/**
 * RecipeId — the stable vocabulary of reusable test patterns.
 *
 * Each value corresponds to a recipe module under src/recipes/:
 *   auth  — login / logout / protected-route flows
 *   a11y  — accessibility checks (axe-core assertions / aria probes)
 *   nav   — navigation, deep-linking, back/forward, 404 handling
 *   seed  — data-seeding helpers (reset, pre-populate state via API or UI)
 *
 * The enum is additive — new recipes can be appended without breaking callers.
 */
export const RecipeIdSchema = z.enum(['auth', 'a11y', 'nav', 'seed']);
export type RecipeId = z.infer<typeof RecipeIdSchema>;

/**
 * Per-recipe configuration that callers may pass alongside a RecipeId to
 * override defaults. All fields are optional — recipes work without config.
 */
export const RecipeConfigSchema = z.object({
  /**
   * Selectors to use for form-login auth steps (recipe: auth).
   * When provided, the auth recipe uses these instead of the defaults derived
   * from the NQ-2 / CaseLoom proven patterns.
   */
  loginUrl: z.string().optional(),
  usernameSelector: z.string().optional(),
  passwordSelector: z.string().optional(),
  submitSelector: z.string().optional(),
  /** Selector for a success indicator visible after login (recipe: auth). */
  successSelector: z.string().optional(),
  /**
   * Routes that the nav recipe should visit in addition to the root (recipe: nav).
   * If omitted the recipe generates scenarios for '/', '/about', and '/404'.
   */
  navRoutes: z.array(z.string()).optional(),
  /**
   * axe-core impact level threshold — violations at or above this level are
   * asserted (recipe: a11y). Default 'serious'.
   */
  a11yImpact: z.enum(['minor', 'moderate', 'serious', 'critical']).optional(),
  /**
   * API endpoint to call for seeding/resetting state (recipe: seed).
   * POST with an empty body; expects 200/201/204.
   */
  seedEndpoint: z.string().optional(),
});
export type RecipeConfig = z.infer<typeof RecipeConfigSchema>;
