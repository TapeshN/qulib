import { z } from 'zod';

/**
 * A snapshot of a single gap found during a scan, stored in a baseline.
 * Intentionally lighter than the full GapSchema: only the fields needed to
 * detect meaningful drift between scans are captured.
 */
export const BaselineGapSchema = z.object({
  path: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.enum([
    'untested-route',
    'a11y',
    'console-error',
    'broken-link',
    'auth-surface',
    'coverage',
    'untested-api-endpoint',
  ]),
  reason: z.string(),
});

export type BaselineGap = z.infer<typeof BaselineGapSchema>;

/**
 * A persisted baseline snapshot for a given URL, saved by `qulib baseline save`.
 */
export const BaselineSnapshotSchema = z.object({
  /** Monotonic slug used as the on-disk filename stem: <url-slug>__<timestamp> */
  id: z.string(),
  url: z.string(),
  savedAt: z.string().datetime(),
  releaseConfidence: z.number().min(0).max(100),
  gapCount: z.number().int().min(0),
  gaps: z.array(BaselineGapSchema),
  label: z.string().optional(),
});

export type BaselineSnapshot = z.infer<typeof BaselineSnapshotSchema>;

/**
 * A single change in gap status between two baselines.
 */
export const BaselineDeltaItemSchema = z.object({
  path: z.string(),
  category: BaselineGapSchema.shape.category,
  severity: BaselineGapSchema.shape.severity,
  reason: z.string(),
  status: z.enum(['new', 'resolved', 'severity-increased', 'severity-decreased']),
});

export type BaselineDeltaItem = z.infer<typeof BaselineDeltaItemSchema>;

/**
 * The result of comparing two snapshots.
 */
export const BaselineDeltaSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  fromSavedAt: z.string().datetime(),
  toSavedAt: z.string().datetime(),
  fromReleaseConfidence: z.number().min(0).max(100),
  toReleaseConfidence: z.number().min(0).max(100),
  confidenceDelta: z.number(),
  newGaps: z.array(BaselineDeltaItemSchema),
  resolvedGaps: z.array(BaselineDeltaItemSchema),
  severityChanges: z.array(BaselineDeltaItemSchema),
  summary: z.string(),
});

export type BaselineDelta = z.infer<typeof BaselineDeltaSchema>;
