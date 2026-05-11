import { z } from 'zod';

export const DecisionLogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  phase: z.enum(['observe', 'think', 'act', 'harness']),
  decision: z.string(),
  reason: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type DecisionLogEntry = z.infer<typeof DecisionLogEntrySchema>;
