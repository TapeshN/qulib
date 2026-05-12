import { z } from 'zod';

export const LlmDataQualitySchema = z.enum(['actual', 'estimated', 'mixed', 'none']);

export const LlmOperationTypeSchema = z.enum(['scenario-generation']);

export const LlmUsageRecordSchema = z.object({
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  estimatedCostUsd: z.number().optional(),
  operationType: LlmOperationTypeSchema,
  timestamp: z.string().datetime(),
  promptHash: z.string().optional(),
  resultHash: z.string().optional(),
  dataQuality: LlmDataQualitySchema,
  notes: z.string().optional(),
});

export const RepeatedAiPatternSchema = z.object({
  promptHash: z.string(),
  count: z.number().int().min(2),
  recommendation: z.string(),
});

export const DeterministicMaturitySchema = z.object({
  level: z.number().int().min(0).max(5),
  label: z.string(),
  rationale: z.string(),
  ceilingNote: z.string().optional(),
});

export const CostIntelligenceSchema = z.object({
  maxOutputTokensPerLlmCall: z.number().int().positive(),
  budgetRole: z.literal('max-output-tokens-per-llm-call'),
  records: z.array(LlmUsageRecordSchema),
  budgetWarnings: z.array(z.string()),
  usageSummary: z.object({
    totalInputTokens: z.number().int().min(0),
    totalOutputTokens: z.number().int().min(0),
    dataQuality: LlmDataQualitySchema,
  }),
  repeatedOperations: z.array(RepeatedAiPatternSchema),
  deterministicMaturity: DeterministicMaturitySchema,
  conversionRecommendations: z.array(z.string()),
});

export type LlmDataQuality = z.infer<typeof LlmDataQualitySchema>;
export type LlmOperationType = z.infer<typeof LlmOperationTypeSchema>;
export type LlmUsageRecord = z.infer<typeof LlmUsageRecordSchema>;
export type RepeatedAiPattern = z.infer<typeof RepeatedAiPatternSchema>;
export type DeterministicMaturity = z.infer<typeof DeterministicMaturitySchema>;
export type CostIntelligence = z.infer<typeof CostIntelligenceSchema>;
