/**
 * 5-View schemas for the qulib Confidence Layer (P3).
 *
 * View 1 — Release Confidence: ReleaseConfidenceSchema (defined in confidence.schema.ts).
 * View 2 — Delivery Traffic: time series of confidence summaries.
 * View 3 — Inbox: human-judgment items derived from blocking / unknown signals.
 * View 4 — Replay: provenance chain explaining how a verdict formed.
 * View 5 — Audit Trail: append-only tamper-evident ledger.
 *
 * P3: ships schemas + pure projection functions (buildReplay, deriveInbox, toAuditEntry,
 *     diffConfidence). Persistence sinks (file/db) and accumulation are deferred to P4.
 *
 * All records carry tenantId (CLAUDE.md rule 17 — multi-tenant from day one).
 */

import { z } from 'zod';
import { EvidenceSourceKindSchema, ConfidenceVerdictSchema } from './confidence.schema.js';

// ---------------------------------------------------------------------------
// View 2 — Delivery Traffic
// ---------------------------------------------------------------------------

export const DeliveryTrafficPointSchema = z.object({
  subjectRef: z.string(),
  tenantId: z.string().default('default'),
  computedAt: z.string().datetime(),
  confidenceScore: z.number().min(0).max(100).nullable(),
  verdict: ConfidenceVerdictSchema,
  /** Change in confidenceScore vs the previous point (null when no prior exists). */
  deltaFromPrev: z.number().nullable(),
});
export type DeliveryTrafficPoint = z.infer<typeof DeliveryTrafficPointSchema>;

// ---------------------------------------------------------------------------
// View 3 — Inbox
// ---------------------------------------------------------------------------

export const InboxItemKindSchema = z.enum(['blocker', 'unknown-signal', 'approval-needed']);
export type InboxItemKind = z.infer<typeof InboxItemKindSchema>;

export const InboxItemSchema = z.object({
  id: z.string(),
  subjectRef: z.string(),
  tenantId: z.string().default('default'),
  kind: InboxItemKindSchema,
  source: EvidenceSourceKindSchema,
  summary: z.string(),
  raisedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

// ---------------------------------------------------------------------------
// View 4 — Replay
// ---------------------------------------------------------------------------

export const ReplayStepSchema = z.object({
  source: EvidenceSourceKindSchema,
  tool: z.string(),
  inputRef: z.string().optional(),
  score: z.number().min(0).max(100).nullable(),
  weight: z.number(),
  effectiveWeight: z.number(),
  durationMs: z.number().optional(),
  cost: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
    })
    .optional(),
});
export type ReplayStep = z.infer<typeof ReplayStepSchema>;

export const ReplayTraceSchema = z.object({
  subjectRef: z.string(),
  computedAt: z.string().datetime(),
  steps: z.array(ReplayStepSchema),
  formula: z.string(),
  finalVerdict: ConfidenceVerdictSchema,
});
export type ReplayTrace = z.infer<typeof ReplayTraceSchema>;

// ---------------------------------------------------------------------------
// View 5 — Audit Trail
// ---------------------------------------------------------------------------

export const AuditEntrySchema = z.object({
  tenantId: z.string().default('default'),
  subjectRef: z.string(),
  computedAt: z.string().datetime(),
  confidenceScore: z.number().min(0).max(100).nullable(),
  verdict: ConfidenceVerdictSchema,
  evidenceSourceCount: z.number().int().min(0),
  blockers: z.array(z.string()),
  schemaVersion: z.literal(1),
  /** SHA-256 hex digest over the canonical record — tamper-evident. */
  recordHash: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
