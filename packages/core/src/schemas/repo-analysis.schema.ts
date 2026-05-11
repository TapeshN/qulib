import { z } from 'zod';

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
});

export type RepoAnalysis = z.infer<typeof RepoAnalysisSchema>;
export type CypressStructure = z.infer<typeof CypressStructureSchema>;
