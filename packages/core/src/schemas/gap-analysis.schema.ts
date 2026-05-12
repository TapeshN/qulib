import { z } from 'zod';

export const GapSchema = z.object({
  id: z.string(),
  path: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
  category: z.enum(['untested-route', 'a11y', 'console-error', 'broken-link']),
});

export const FrameworkRecommendationSchema = z.object({
  adapter: z.enum(['playwright', 'cypress-e2e', 'cypress-component', 'api', 'accessibility']),
  reason: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const TestStepSchema = z.object({
  action: z.enum([
    'navigate',
    'click',
    'type',
    'assert-visible',
    'assert-hidden',
    'assert-text',
    'assert-disabled',
    'assert-count',
    'wait',
    'api-call',
  ]),
  target: z.string().optional(),
  value: z.string().optional(),
  description: z.string(),
});

export const NeutralScenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  targetPath: z.string(),
  targetComponent: z.string().optional(),
  steps: z.array(TestStepSchema),
  tags: z.array(z.string()),
  recommendations: z.array(FrameworkRecommendationSchema),
  sourceGapIds: z.array(z.string()),
});

export const GeneratedTestSchema = z.object({
  scenarioId: z.string(),
  adapter: z.enum(['playwright', 'cypress-e2e', 'cypress-component', 'api', 'accessibility']),
  filename: z.string(),
  code: z.string(),
  source: z.enum(['llm', 'template']),
  outputPath: z.string(),
});

export const GapAnalysisSchema = z.object({
  analyzedAt: z.string().datetime(),
  mode: z.enum(['url-only', 'url-repo', 'auth-required']),
  releaseConfidence: z.number().min(0).max(100),
  coveragePagesScanned: z.number().int().min(0),
  coverageBudgetExceeded: z.boolean(),
  coverageWarning: z
    .enum(['budget-exceeded', 'low-coverage', 'navigation-failures', 'auth-required'])
    .optional(),
  gaps: z.array(GapSchema),
  scenarios: z.array(NeutralScenarioSchema),
  generatedTests: z.array(GeneratedTestSchema),
});

export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;
export type Gap = z.infer<typeof GapSchema>;
export type NeutralScenario = z.infer<typeof NeutralScenarioSchema>;
export type GeneratedTest = z.infer<typeof GeneratedTestSchema>;
export type TestStep = z.infer<typeof TestStepSchema>;
export type FrameworkRecommendation = z.infer<typeof FrameworkRecommendationSchema>;
