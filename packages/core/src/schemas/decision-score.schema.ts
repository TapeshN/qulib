import { z } from 'zod';

export const ForkKindSchema = z.enum([
  'gate_block_vs_pass',
  'stop_vs_continue',
  'escalate_vs_proceed',
]);

export const DecisionForkSchema = z.object({
  fork_id: z.string().min(1).max(200),
  fork_kind: ForkKindSchema,
  options: z.array(z.string().min(1).max(500)).min(2).max(20),
  choice: z.string().min(1).max(500),
  constraint: z.string().min(1).max(8000),
  settleable: z.boolean(),
  source_event_id: z.string().min(1).max(200),
  ts: z.string().min(1).max(100),
});

export const ScoreDecisionsInputSchema = z.object({
  forksPath: z.string().min(1),
  enableLlmJudge: z.boolean().optional(),
});

export const DecisionScoringPathSchema = z.enum(['deterministic', 'llm-refined']);

export const ScoredDecisionForkSchema = z.object({
  fork_id: z.string(),
  fork_kind: ForkKindSchema,
  choice: z.string(),
  decisionQuality: z.number().min(0).max(1),
  seniorCorrect: z.boolean(),
  rationale: z.string(),
  scoringPath: DecisionScoringPathSchema,
});

export const DecisionScoreAggregateSchema = z.object({
  meanDecisionQuality: z.number().min(0).max(1),
  byKind: z.record(ForkKindSchema, z.number().min(0).max(1)),
  count: z.number().int().min(0),
});

export const DecisionScoreResultSchema = z.object({
  scored: z.array(ScoredDecisionForkSchema),
  aggregate: DecisionScoreAggregateSchema,
});

export type ForkKind = z.infer<typeof ForkKindSchema>;
export type DecisionFork = z.infer<typeof DecisionForkSchema>;
export type ScoreDecisionsInput = z.infer<typeof ScoreDecisionsInputSchema>;
export type DecisionScoringPath = z.infer<typeof DecisionScoringPathSchema>;
export type ScoredDecisionFork = z.infer<typeof ScoredDecisionForkSchema>;
export type DecisionScoreAggregate = z.infer<typeof DecisionScoreAggregateSchema>;
export type DecisionScoreResult = z.infer<typeof DecisionScoreResultSchema>;
