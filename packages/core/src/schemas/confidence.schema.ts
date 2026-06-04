/**
 * Release Confidence Aggregator — Zod schemas (single source of truth).
 *
 * P3 — qulib Confidence Layer v1.
 * Pure schema definitions; no I/O. Scorer lives in tools/scoring/confidence.ts.
 *
 * Architecture note (§1d of spec):
 * - EvidenceItem is the universal adapter envelope — any signal feeds the same scorer.
 * - EvidenceSourceKind enum reserves external sources (ci-results, deploy-metadata, …)
 *   for P4 wiring; qulib-native sources are wired in P3.
 * - tenantId on every record (CLAUDE.md rule 17 — multi-tenant from day one).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Evidence source kinds
// ---------------------------------------------------------------------------

export const EvidenceSourceKindSchema = z.enum([
  // qulib-native (P3 wires these)
  'live-app-quality',
  'accessibility',
  'crawl-coverage',
  'test-automation',
  'api-coverage',
  // external — schema reserves them; P4 wires them
  'ci-results',
  'deploy-metadata',
  'error-telemetry',
  'feature-flags',
  'doc-health',
  'human-approval',
  'agent-evidence',
]);
export type EvidenceSourceKind = z.infer<typeof EvidenceSourceKindSchema>;

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const ConfidencePolicySchema = z.object({
  /**
   * Confidence score at or above this is required for verdict='ship'. Default 80.
   * Mirrors AgentSummaryPolicy.passConfidenceThreshold.
   */
  passThreshold: z.number().min(0).max(100).default(80),
  /**
   * Confidence score below this produces verdict='hold'. Default 30.
   * Mirrors AgentSummaryPolicy.failConfidenceThreshold.
   */
  failThreshold: z.number().min(0).max(100).default(30),
  /** Max items in topRisks / recommendedNextChecks / honestyNotes lists. Default 5. */
  maxListLength: z.number().int().min(1).default(5),
  /**
   * Sources listed here produce verdict='caution' when their applicability is 'unknown'.
   * Empty by default — callers can require specific sources for stricter gates.
   */
  requiredSources: z.array(EvidenceSourceKindSchema).default([]),
  /**
   * Per-source weight overrides. When provided, these replace the scorer's default weights
   * for the named sources; unmentioned sources keep their defaults.
   */
  weights: z.record(EvidenceSourceKindSchema, z.number().min(0).max(1)).optional(),
});
export type ConfidencePolicy = z.infer<typeof ConfidencePolicySchema>;

// ---------------------------------------------------------------------------
// Evidence item (universal adapter envelope)
// ---------------------------------------------------------------------------

export const EvidenceItemSchema = z.object({
  source: EvidenceSourceKindSchema,
  /**
   * 0–100 normalized score, or null when the source ran but could not produce
   * an honest score (e.g. auth-blocked crawl). null → excluded from denominator
   * AND contributes to honesty notes.
   */
  score: z.number().min(0).max(100).nullable(),
  weight: z.number().min(0).max(1),
  /**
   * - applicable     — qulib has signal and produced a real score.
   * - not_applicable — the capability does not apply (e.g. api-coverage with 0 endpoints).
   *                    Score is reported but excluded from the denominator.
   * - unknown        — qulib could not collect enough signal to score honestly.
   *                    Excluded from denominator; narrated in honestyNotes.
   */
  applicability: z.enum(['applicable', 'not_applicable', 'unknown']).default('applicable'),
  /**
   * When true, forces verdict='block' regardless of score.
   * Use for hard gates: auth wall, critical gap, failed deploy.
   */
  blocking: z.boolean().default(false),
  /** Human-readable "why this score" bullet points. */
  evidence: z.array(z.string()),
  recommendations: z.array(z.string()).default([]),
  /** Required when applicability !== 'applicable'. Explains why the source was excluded. */
  reason: z.string().optional(),
  /** ISO-8601 datetime when this evidence was collected. */
  collectedAt: z.string().datetime(),
  /**
   * Provenance for Replay/Audit views — how this item was produced.
   */
  collector: z.object({
    tool: z.string(),
    inputRef: z.string().optional(),
    durationMs: z.number().optional(),
    cost: z
      .object({
        inputTokens: z.number(),
        outputTokens: z.number(),
      })
      .optional(),
  }),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

// ---------------------------------------------------------------------------
// Subject (what we are judging)
// ---------------------------------------------------------------------------

export const ConfidenceSubjectSchema = z.object({
  kind: z.enum(['release', 'pr', 'deploy', 'app', 'repo']),
  ref: z.string(),
  /** Multi-tenant stamp (CLAUDE.md rule 17). Default 'default' while single-tenant. */
  tenantId: z.string().default('default'),
});
export type ConfidenceSubject = z.infer<typeof ConfidenceSubjectSchema>;

// ---------------------------------------------------------------------------
// Confidence input (the scorer's full input)
// ---------------------------------------------------------------------------

export const ConfidenceInputSchema = z.object({
  subject: ConfidenceSubjectSchema,
  evidence: z.array(EvidenceItemSchema),
  policy: ConfidencePolicySchema.optional(),
});
export type ConfidenceInput = z.infer<typeof ConfidenceInputSchema>;

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export const ConfidenceVerdictSchema = z.enum(['ship', 'caution', 'hold', 'block']);
export type ConfidenceVerdict = z.infer<typeof ConfidenceVerdictSchema>;

// ---------------------------------------------------------------------------
// Release confidence output (the aggregator's result — View 1)
// ---------------------------------------------------------------------------

export const ConfidenceContributionSchema = z.object({
  source: EvidenceSourceKindSchema,
  score: z.number().min(0).max(100).nullable(),
  weight: z.number(),
  /** Renormalized weight over the applicable set (sums to 1.0 across applicable items). */
  effectiveWeight: z.number(),
  applicability: z.enum(['applicable', 'not_applicable', 'unknown']),
  blocking: z.boolean(),
});
export type ConfidenceContribution = z.infer<typeof ConfidenceContributionSchema>;

export const ReleaseConfidenceSchema = z.object({
  schemaVersion: z.literal(1),
  computedAt: z.string().datetime(),
  subject: ConfidenceSubjectSchema,
  /**
   * Fused confidence score (0–100) over applicable, non-null evidence only.
   * null when no applicable evidence exists (honesty floor → verdict = 'block').
   */
  confidenceScore: z.number().min(0).max(100).nullable(),
  verdict: ConfidenceVerdictSchema,
  level: z.number().int().min(1).max(5),
  label: z.string(),
  /** Per-source breakdown including excluded (not_applicable / unknown) items. */
  contributions: z.array(ConfidenceContributionSchema),
  topRisks: z.array(z.string()),
  recommendedNextChecks: z.array(z.string()),
  /** One note per degraded/excluded/partial source — the honesty layer. */
  honestyNotes: z.array(z.string()),
  /** Non-empty only when verdict='block'; explains what caused the block. */
  blockers: z.array(z.string()),
  scoreFormula: z.string(),
});
export type ReleaseConfidence = z.infer<typeof ReleaseConfidenceSchema>;
