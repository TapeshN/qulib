import { z } from 'zod';

export const AutomationMaturityApplicabilitySchema = z.enum([
  'applicable',
  'not_applicable',
  'unknown',
]);

/**
 * Maturity dimension with explicit applicability so absent capabilities are not silently
 * awarded partial credit.
 *
 * - `applicable`   — Qulib has enough signal to compute a real `score`.
 * - `not_applicable` — The capability does not apply to this repo (e.g. component-test-ratio
 *                     with no Cypress detected, auth-test-coverage when no auth signal exists).
 *                     `score` is reported but excluded from the overall calculation.
 * - `unknown`      — Qulib could not collect enough signal to score honestly (e.g. zero
 *                     interactive elements scanned for test-id hygiene). Excluded from overall.
 *
 * Overall score formula (in `computeAutomationMaturity`):
 *   numerator   = Σ score_i * weight_i  for i ∈ applicable dimensions
 *   denominator = Σ weight_i            for i ∈ applicable dimensions
 *   overallScore = round(numerator / denominator) when denominator > 0, else 0
 *
 * Schema fields stay backward compatible: both `applicability` and `reason` are optional.
 * Existing consumers that don't read them keep working; honest reports populate them.
 */
export const AutomationMaturityDimensionSchema = z.object({
  dimension: z.enum([
    'test-coverage-breadth',
    'framework-adoption',
    'test-id-hygiene',
    'ci-integration',
    'auth-test-coverage',
    'component-test-ratio',
  ]),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  recommendations: z.array(z.string()),
  applicability: AutomationMaturityApplicabilitySchema.optional(),
  reason: z.string().optional(),
});

export const AutomationMaturitySchema = z.object({
  computedAt: z.string().datetime(),
  repoPath: z.string(),
  overallScore: z.number().min(0).max(100),
  level: z.number().int().min(1).max(5),
  label: z.string(),
  dimensions: z.array(AutomationMaturityDimensionSchema),
  topRecommendations: z.array(z.string()),
  scoreFormula: z.string().optional(),
});

export type AutomationMaturityApplicability = z.infer<typeof AutomationMaturityApplicabilitySchema>;
export type AutomationMaturityDimension = z.infer<typeof AutomationMaturityDimensionSchema>;
export type AutomationMaturity = z.infer<typeof AutomationMaturitySchema>;
