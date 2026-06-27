import { z } from 'zod';

export const SpecRequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(2000),
});

export const SpecValidationInputSchema = z.object({
  requirements: z.array(SpecRequirementSchema).min(1).max(100),
  observed: z.object({
    url: z.string().optional(),
    summary: z.string().min(1).max(20000),
  }),
  enableLlmJudge: z.boolean().optional(),
});

export const RequirementVerdictSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(2000),
  conforms: z.enum(['yes', 'no', 'unknown']),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  scoringPath: z.enum(['llm-judge', 'deterministic-fallback']),
});

export const SpecConformanceResultSchema = z.object({
  requirements: z.array(RequirementVerdictSchema),
  conformanceRate: z.number().min(0).max(1),
  verdict: z.enum(['conforms', 'partial', 'violates', 'insufficient-evidence']),
  unmet: z.array(z.string()),
  schemaVersion: z.literal(1),
});

export type SpecRequirement = z.infer<typeof SpecRequirementSchema>;
export type SpecValidationInput = z.infer<typeof SpecValidationInputSchema>;
export type RequirementVerdict = z.infer<typeof RequirementVerdictSchema>;
export type SpecConformanceResult = z.infer<typeof SpecConformanceResultSchema>;
