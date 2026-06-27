import { z } from 'zod';

export const BugReportSeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const BugReportInputSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(8000),
  steps: z.string().min(1).max(8000),
  severity: BugReportSeveritySchema,
});

export const BugReportTargetSchema = z.object({
  description: z.string().min(1).max(8000),
  type: z.string().min(1).max(200),
  severity: BugReportSeveritySchema,
  expectedBehavior: z.string().min(1).max(8000),
});

export const ScoreBugReportInputSchema = z.object({
  report: BugReportInputSchema,
  target: BugReportTargetSchema,
});

export const BugReportRubricSchema = z.object({
  coverage: z.number().min(0).max(25),
  severity: z.number().min(0).max(25),
  repro: z.number().min(0).max(25),
  evidence: z.number().min(0).max(25),
});

export const BugReportScoringPathSchema = z.enum(['llm-judge', 'deterministic-fallback']);

export const BugReportScoreResultSchema = z.object({
  matched: z.boolean(),
  matchConfidence: z.number().min(0).max(1),
  rubric: BugReportRubricSchema,
  feedback: z.string(),
  scoringPath: BugReportScoringPathSchema,
});

export type BugReportSeverity = z.infer<typeof BugReportSeveritySchema>;
export type BugReportInput = z.infer<typeof BugReportInputSchema>;
export type BugReportTarget = z.infer<typeof BugReportTargetSchema>;
export type ScoreBugReportInput = z.infer<typeof ScoreBugReportInputSchema>;
export type BugReportRubric = z.infer<typeof BugReportRubricSchema>;
export type BugReportScoringPath = z.infer<typeof BugReportScoringPathSchema>;
export type BugReportScoreResult = z.infer<typeof BugReportScoreResultSchema>;
