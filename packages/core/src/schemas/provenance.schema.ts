/**
 * Provenance grading + Witnessed-State-Ratio (WSR) — Zod schemas.
 *
 * Deterministic rubric (no LLM self-judgment). Grades whether release evidence
 * is WITNESSED (tool/CI/artifact trail) or merely CLAIMED (assertions).
 *
 * Rubric version is pinned so golden cases and MCP consumers can audit drift.
 */

import { z } from 'zod';
import { ConfidenceSubjectSchema, EvidenceItemSchema } from './confidence.schema.js';

/** Pinned rubric identifier — bump only with golden-case review. */
export const PROVENANCE_RUBRIC_VERSION = 'provenance-v1' as const;

export const ProvenanceRubricVersionSchema = z.literal(PROVENANCE_RUBRIC_VERSION);

/**
 * Per-evidence provenance grade (deterministic w_i ladder):
 *   high — tool/CI/artifact-with-provenance (witnessed)
 *   mid  — verified-external (URL-backed, not qulib-executed)
 *   low  — unverified collector (tool ran but no verifiable ref)
 *   none — bare assertion (no execution trail)
 */
export const ProvenanceGradeSchema = z.enum(['high', 'mid', 'low', 'none']);
export type ProvenanceGrade = z.infer<typeof ProvenanceGradeSchema>;

/** Bucket for WSR numerator/denominator. */
export const EvidenceStateClassSchema = z.enum(['witnessed', 'claimed', 'stale']);
export type EvidenceStateClass = z.infer<typeof EvidenceStateClassSchema>;

export const ShipGateSchema = z.enum(['ship', 'no-ship']);
export type ShipGate = z.infer<typeof ShipGateSchema>;

/** Change types for witnessed-coverage taxonomy. */
export const ChangeTypeSchema = z.enum([
  'refactor',
  'new-export',
  'artifact-reader',
  'config-change',
  'dependency-bump',
  'test-addition',
  'unknown',
]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const WitnessRequirementSchema = z.object({
  changeType: ChangeTypeSchema,
  requiredWitness: z.string(),
  description: z.string(),
});
export type WitnessRequirement = z.infer<typeof WitnessRequirementSchema>;

export const ProvenancePolicySchema = z.object({
  /** Minimum WSR for shipGate='ship'. Default 0.6 (60% witnessed mass). */
  wsrShipThreshold: z.number().min(0).max(1).default(0.6),
  /** Evidence older than this (seconds) is classified stale. Default 24h. */
  staleAfterSeconds: z.number().positive().default(60 * 60 * 24),
  /** Fresh window before linear TTL decay begins. Default 4h. */
  freshThresholdSeconds: z.number().positive().default(60 * 60 * 4),
  rubricVersion: ProvenanceRubricVersionSchema.default(PROVENANCE_RUBRIC_VERSION),
});
export type ProvenancePolicy = z.infer<typeof ProvenancePolicySchema>;

export const ProvenanceInputSchema = z.object({
  subject: ConfidenceSubjectSchema,
  evidence: z.array(EvidenceItemSchema),
  policy: ProvenancePolicySchema.optional(),
  /** Optional change types present in this release — drives witness-coverage gaps. */
  changeTypes: z.array(ChangeTypeSchema).optional(),
});
export type ProvenanceInput = z.infer<typeof ProvenanceInputSchema>;

export const GradedEvidenceSchema = z.object({
  source: z.string(),
  grade: ProvenanceGradeSchema,
  /** Numeric grade weight: high=1.0, mid=0.6, low=0.3, none=0. */
  gradeWeight: z.number().min(0).max(1),
  stateClass: EvidenceStateClassSchema,
  /** Evidence mass used in WSR (item weight × freshness factor). */
  mass: z.number().min(0),
  /** Freshness multiplier after TTL decay (1.0 = fresh, 0 = fully stale). */
  freshnessFactor: z.number().min(0).max(1),
  ageSeconds: z.number().min(0),
  collectorTool: z.string(),
  inputRef: z.string().optional(),
  rationale: z.string(),
});
export type GradedEvidence = z.infer<typeof GradedEvidenceSchema>;

export const WitnessCoverageGapSchema = z.object({
  changeType: ChangeTypeSchema,
  requiredWitness: z.string(),
  description: z.string(),
  satisfied: z.boolean(),
});
export type WitnessCoverageGap = z.infer<typeof WitnessCoverageGapSchema>;

export const ProvenanceScoreSchema = z.object({
  schemaVersion: z.literal(1),
  computedAt: z.string().datetime(),
  rubricVersion: ProvenanceRubricVersionSchema,
  subject: ConfidenceSubjectSchema,
  /**
   * Witnessed-State-Ratio = W / (W + C + S).
   * null when no evidence mass exists (honesty floor).
   */
  wsr: z.number().min(0).max(1).nullable(),
  witnessedMass: z.number().min(0),
  claimedMass: z.number().min(0),
  staleMass: z.number().min(0),
  shipGate: ShipGateSchema,
  gradedEvidence: z.array(GradedEvidenceSchema),
  witnessCoverage: z.array(WitnessCoverageGapSchema),
  honestyNotes: z.array(z.string()),
  formula: z.string(),
});
export type ProvenanceScore = z.infer<typeof ProvenanceScoreSchema>;
