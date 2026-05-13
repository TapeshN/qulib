import { z } from 'zod';
import { AutomationMaturitySchema } from './automation-maturity.schema.js';

export const DetectedFrameworkPrimarySchema = z.enum([
  'nextjs-app-router',
  'nextjs-pages-router',
  'express',
  'remix',
  'nuxt',
  'sveltekit',
  'astro',
  'vite',
  'unknown',
]);

export const FrameworkDetectionConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const TestFrameworkDetectedSchema = z.enum([
  'playwright',
  'cypress-e2e',
  'cypress-component',
  'jest',
  'vitest',
  'other',
]);

export const FrameworkDetectionSchema = z.object({
  primary: DetectedFrameworkPrimarySchema,
  confidence: FrameworkDetectionConfidenceSchema,
  evidence: z.array(z.string()),
  testFrameworks: z.array(TestFrameworkDetectedSchema),
});

export type DetectedFrameworkPrimary = z.infer<typeof DetectedFrameworkPrimarySchema>;
export type FrameworkDetectionResult = z.infer<typeof FrameworkDetectionSchema>;

export const RepoRouteSchema = z.object({
  path: z.string(),
  file: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'unknown']),
});

export const TestFileSchema = z.object({
  file: z.string(),
  type: z.enum(['playwright', 'cypress-e2e', 'cypress-component', 'jest', 'vitest', 'other']),
  coveredPaths: z.array(z.string()),
});

export const CypressStructureSchema = z.object({
  detected: z.boolean(),
  e2eFolder: z.string().optional(),
  componentFolder: z.string().optional(),
  fixturesFolder: z.string().optional(),
  supportFolder: z.string().optional(),
  hasCommandsFile: z.boolean(),
  existingE2eFiles: z.array(z.string()),
  existingComponentFiles: z.array(z.string()),
});

export const RepoAnalysisSchema = z.object({
  scannedAt: z.string().datetime(),
  repoPath: z.string(),
  routes: z.array(RepoRouteSchema),
  testFiles: z.array(TestFileSchema),
  missingTestIds: z.array(z.string()),
  cypressStructure: CypressStructureSchema,
  framework: FrameworkDetectionSchema.optional(),
  automationMaturity: AutomationMaturitySchema.optional(),
});

export type RepoAnalysis = z.infer<typeof RepoAnalysisSchema>;
export type CypressStructure = z.infer<typeof CypressStructureSchema>;
