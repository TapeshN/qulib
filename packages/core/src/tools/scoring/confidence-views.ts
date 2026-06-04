/**
 * Pure view projections for the qulib Confidence Layer (Views 2–5).
 *
 * P3 — qulib Confidence Layer v1.
 *
 * All functions are pure (no I/O). Persistence sinks (file/db) are deferred to P4.
 * View 1 (Release Confidence) IS the ReleaseConfidence object from the scorer.
 *
 * View 2 — diffConfidence: build a DeliveryTrafficPoint from two consecutive verdicts.
 * View 3 — deriveInbox: extract human-judgment items from a verdict.
 * View 4 — buildReplay: construct the provenance trace from input + result.
 * View 5 — toAuditEntry: serialize a verdict to a tamper-evident audit record.
 */

import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { ReleaseConfidence, ConfidenceInput } from '../../schemas/confidence.schema.js';
import type {
  DeliveryTrafficPoint,
  InboxItem,
  ReplayTrace,
  AuditEntry,
} from '../../schemas/views.schema.js';
import {
  DeliveryTrafficPointSchema,
  InboxItemSchema,
  ReplayTraceSchema,
  AuditEntrySchema,
} from '../../schemas/views.schema.js';

// ---------------------------------------------------------------------------
// View 2 — Delivery Traffic
// ---------------------------------------------------------------------------

/**
 * Build a DeliveryTrafficPoint from the current verdict and an optional prior verdict.
 * deltaFromPrev is null when there is no prior point.
 */
export function diffConfidence(
  current: ReleaseConfidence,
  prior: ReleaseConfidence | null
): DeliveryTrafficPoint {
  const delta =
    prior !== null &&
    current.confidenceScore !== null &&
    prior.confidenceScore !== null
      ? current.confidenceScore - prior.confidenceScore
      : null;

  return DeliveryTrafficPointSchema.parse({
    subjectRef: current.subject.ref,
    tenantId: current.subject.tenantId,
    computedAt: current.computedAt,
    confidenceScore: current.confidenceScore,
    verdict: current.verdict,
    deltaFromPrev: delta,
  });
}

// ---------------------------------------------------------------------------
// View 3 — Inbox
// ---------------------------------------------------------------------------

/**
 * Derive human-judgment inbox items from a verdict.
 * Raises items for:
 *   - every blocking evidence item
 *   - every 'unknown' contribution on a requiredSource (when policy provides them)
 *   - 'block' verdict with a null score (nothing evaluable)
 */
export function deriveInbox(
  rc: ReleaseConfidence,
  input: ConfidenceInput
): InboxItem[] {
  const items: InboxItem[] = [];
  const now = rc.computedAt;
  const requiredSources = input.policy?.requiredSources ?? [];

  for (const evidence of input.evidence) {
    if (evidence.blocking) {
      items.push(
        InboxItemSchema.parse({
          id: randomUUID(),
          subjectRef: rc.subject.ref,
          tenantId: rc.subject.tenantId,
          kind: 'blocker',
          source: evidence.source,
          summary: evidence.reason
            ? `${evidence.source}: ${evidence.reason}`
            : `${evidence.source} is a hard blocker.`,
          raisedAt: now,
        })
      );
    } else if (
      (evidence.applicability ?? 'applicable') === 'unknown' &&
      requiredSources.includes(evidence.source)
    ) {
      items.push(
        InboxItemSchema.parse({
          id: randomUUID(),
          subjectRef: rc.subject.ref,
          tenantId: rc.subject.tenantId,
          kind: 'unknown-signal',
          source: evidence.source,
          summary: evidence.reason
            ? `${evidence.source}: ${evidence.reason}`
            : `${evidence.source} could not produce a reliable score and is a required source.`,
          raisedAt: now,
        })
      );
    }
  }

  // Raise an inbox item if verdict=block with null score (nothing evaluable).
  if (rc.verdict === 'block' && rc.confidenceScore === null && input.evidence.every((e) => !e.blocking)) {
    items.push(
      InboxItemSchema.parse({
        id: randomUUID(),
        subjectRef: rc.subject.ref,
        tenantId: rc.subject.tenantId,
        kind: 'approval-needed',
        source: 'human-approval',
        summary: 'No applicable evidence produced a score — manual review required before shipping.',
        raisedAt: now,
      })
    );
  }

  return items;
}

// ---------------------------------------------------------------------------
// View 4 — Replay
// ---------------------------------------------------------------------------

/**
 * Build the provenance trace from the scorer input + result.
 * Steps are ordered by their appearance in the input evidence array,
 * with all provenance fields carried from EvidenceItem.collector.
 */
export function buildReplay(input: ConfidenceInput, rc: ReleaseConfidence): ReplayTrace {
  const steps = input.evidence.map((item, idx) => {
    const contribution = rc.contributions[idx];
    return {
      source: item.source,
      tool: item.collector.tool,
      inputRef: item.collector.inputRef,
      score: item.score,
      weight: contribution?.weight ?? item.weight,
      effectiveWeight: contribution?.effectiveWeight ?? 0,
      durationMs: item.collector.durationMs,
      cost: item.collector.cost,
    };
  });

  return ReplayTraceSchema.parse({
    subjectRef: rc.subject.ref,
    computedAt: rc.computedAt,
    steps,
    formula: rc.scoreFormula,
    finalVerdict: rc.verdict,
  });
}

// ---------------------------------------------------------------------------
// View 5 — Audit Trail
// ---------------------------------------------------------------------------

/**
 * Canonical audit record shape for hashing.
 * Fields are sorted so the hash is deterministic regardless of insertion order.
 */
function canonicalRecord(
  rc: ReleaseConfidence,
  evidenceSourceCount: number
): string {
  return JSON.stringify({
    blockers: [...rc.blockers].sort(),
    computedAt: rc.computedAt,
    confidenceScore: rc.confidenceScore,
    evidenceSourceCount,
    schemaVersion: 1,
    subjectRef: rc.subject.ref,
    tenantId: rc.subject.tenantId,
    verdict: rc.verdict,
  });
}

/**
 * Serialize a verdict to a tamper-evident audit record.
 * recordHash is SHA-256 over the canonical record — changes when any field changes.
 */
export function toAuditEntry(rc: ReleaseConfidence, evidenceSourceCount: number): AuditEntry {
  const canonical = canonicalRecord(rc, evidenceSourceCount);
  const recordHash = createHash('sha256').update(canonical).digest('hex');

  return AuditEntrySchema.parse({
    tenantId: rc.subject.tenantId,
    subjectRef: rc.subject.ref,
    computedAt: rc.computedAt,
    confidenceScore: rc.confidenceScore,
    verdict: rc.verdict,
    evidenceSourceCount,
    blockers: rc.blockers,
    schemaVersion: 1,
    recordHash,
  });
}
