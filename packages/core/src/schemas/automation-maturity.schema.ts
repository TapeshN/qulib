import { z } from 'zod';

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
});

export const AutomationMaturitySchema = z.object({
  computedAt: z.string().datetime(),
  repoPath: z.string(),
  overallScore: z.number().min(0).max(100),
  level: z.number().int().min(1).max(5),
  label: z.string(),
  dimensions: z.array(AutomationMaturityDimensionSchema),
  topRecommendations: z.array(z.string()),
});

export type AutomationMaturityDimension = z.infer<typeof AutomationMaturityDimensionSchema>;
export type AutomationMaturity = z.infer<typeof AutomationMaturitySchema>;
