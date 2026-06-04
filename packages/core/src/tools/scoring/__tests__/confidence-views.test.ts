/**
 * View-projection tests for diffConfidence, deriveInbox, buildReplay, toAuditEntry.
 *
 * Test plan (P3 spec §6.C):
 * - buildReplay: step order + provenance fields present
 * - deriveInbox: raises exactly blockers/unknown-required items
 * - toAuditEntry: round-trips + recordHash stable + changes on mutation
 * - diffConfidence: delta sign/magnitude
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReplay,
  deriveInbox,
  toAuditEntry,
  diffConfidence,
} from '../confidence-views.js';
import { computeReleaseConfidence } from '../confidence.js';
import type { ConfidenceInput, EvidenceItem, ReleaseConfidence } from '../../../schemas/confidence.schema.js';
import { AuditEntrySchema, ReplayTraceSchema, DeliveryTrafficPointSchema } from '../../../schemas/views.schema.js';

const NOW = new Date().toISOString();

function makeItem(
  source: EvidenceItem['source'],
  score: number | null,
  weight: number,
  overrides: Partial<EvidenceItem> = {}
): EvidenceItem {
  return {
    source,
    score,
    weight,
    applicability: 'applicable',
    blocking: false,
    evidence: [`${source} evidence`],
    recommendations: [],
    collectedAt: NOW,
    collector: {
      tool: `tool_${source}`,
      inputRef: `/repo/${source}`,
      durationMs: 100,
    },
    ...overrides,
  };
}

function baseSubject() {
  return { kind: 'release' as const, ref: 'https://example.com', tenantId: 'test' };
}

function makeInput(items: EvidenceItem[], policy?: ConfidenceInput['policy']): ConfidenceInput {
  return { subject: baseSubject(), evidence: items, policy };
}

function makeRc(items: EvidenceItem[], policy?: ConfidenceInput['policy']): { input: ConfidenceInput; rc: ReleaseConfidence } {
  const input = makeInput(items, policy);
  const rc = computeReleaseConfidence(input);
  return { input, rc };
}

// ---------------------------------------------------------------------------
// View 4 — buildReplay
// ---------------------------------------------------------------------------

test('buildReplay: step order matches evidence array order', () => {
  const items = [
    makeItem('live-app-quality', 80, 0.30),
    makeItem('test-automation', 60, 0.22),
    makeItem('api-coverage', 40, 0.15),
  ];
  const { input, rc } = makeRc(items);
  const trace = buildReplay(input, rc);

  assert.equal(trace.steps.length, 3);
  assert.equal(trace.steps[0]!.source, 'live-app-quality');
  assert.equal(trace.steps[1]!.source, 'test-automation');
  assert.equal(trace.steps[2]!.source, 'api-coverage');
});

test('buildReplay: provenance fields (tool, inputRef, durationMs) are present', () => {
  const items = [makeItem('live-app-quality', 80, 0.30)];
  const { input, rc } = makeRc(items);
  const trace = buildReplay(input, rc);

  assert.equal(trace.steps[0]!.tool, 'tool_live-app-quality');
  assert.equal(trace.steps[0]!.inputRef, '/repo/live-app-quality');
  assert.equal(trace.steps[0]!.durationMs, 100);
});

test('buildReplay: formula and finalVerdict present', () => {
  const items = [makeItem('live-app-quality', 85, 0.30)];
  const { input, rc } = makeRc(items);
  const trace = buildReplay(input, rc);

  assert.ok(trace.formula, 'formula present');
  assert.match(trace.formula, /applicable/i);
  assert.ok(['ship', 'caution', 'hold', 'block'].includes(trace.finalVerdict));
});

test('buildReplay: parses against ReplayTraceSchema (runtime-import check)', () => {
  const items = [makeItem('live-app-quality', 75, 0.30)];
  const { input, rc } = makeRc(items);
  const trace = buildReplay(input, rc);
  const parsed = ReplayTraceSchema.safeParse(trace);
  assert.ok(parsed.success, `schema failed: ${JSON.stringify(parsed.error ?? null)}`);
});

// ---------------------------------------------------------------------------
// View 3 — deriveInbox
// ---------------------------------------------------------------------------

test('deriveInbox: blocking item → inbox item with kind=blocker', () => {
  const items = [
    makeItem('live-app-quality', 95, 0.30),
    makeItem('crawl-coverage', 0, 0.10, { blocking: true, reason: 'critical gap' }),
  ];
  const { input, rc } = makeRc(items);
  const inbox = deriveInbox(rc, input);

  assert.ok(inbox.length >= 1, 'at least one inbox item');
  const blocker = inbox.find((i) => i.kind === 'blocker');
  assert.ok(blocker, 'blocker inbox item present');
  assert.equal(blocker!.source, 'crawl-coverage');
});

test('deriveInbox: unknown on requiredSource → inbox item with kind=unknown-signal', () => {
  const items = [
    makeItem('live-app-quality', 90, 0.30),
    makeItem('test-automation', 0, 0.22, { applicability: 'unknown', reason: 'no signal' }),
  ];
  const { input, rc } = makeRc(items, { requiredSources: ['test-automation'] });
  const inbox = deriveInbox(rc, input);

  const unknownItem = inbox.find((i) => i.kind === 'unknown-signal');
  assert.ok(unknownItem, 'unknown-signal inbox item for required source');
  assert.equal(unknownItem!.source, 'test-automation');
});

test('deriveInbox: non-required unknown source does NOT raise inbox item', () => {
  const items = [
    makeItem('live-app-quality', 90, 0.30),
    makeItem('test-automation', 0, 0.22, { applicability: 'unknown' }),
  ];
  const { input, rc } = makeRc(items, { requiredSources: [] });
  const inbox = deriveInbox(rc, input);
  const unknownItem = inbox.find((i) => i.source === 'test-automation');
  assert.equal(unknownItem, undefined, 'no inbox item for non-required unknown source');
});

test('deriveInbox: verdict=block with null score and no blockers → approval-needed item', () => {
  const { input, rc } = makeRc([]);
  assert.equal(rc.verdict, 'block');
  const inbox = deriveInbox(rc, input);
  const approvalItem = inbox.find((i) => i.kind === 'approval-needed');
  assert.ok(approvalItem, 'approval-needed item when nothing evaluable');
});

// ---------------------------------------------------------------------------
// View 5 — toAuditEntry
// ---------------------------------------------------------------------------

test('toAuditEntry: round-trips through AuditEntrySchema', () => {
  const { rc } = makeRc([makeItem('live-app-quality', 75, 0.30)]);
  const entry = toAuditEntry(rc, 1);
  const parsed = AuditEntrySchema.safeParse(entry);
  assert.ok(parsed.success, `schema failed: ${JSON.stringify(parsed.error ?? null)}`);
});

test('toAuditEntry: recordHash is a non-empty string', () => {
  const { rc } = makeRc([makeItem('live-app-quality', 75, 0.30)]);
  const entry = toAuditEntry(rc, 1);
  assert.ok(entry.recordHash, 'recordHash present');
  assert.equal(entry.recordHash.length, 64, 'SHA-256 hex is 64 chars');
});

test('toAuditEntry: recordHash is stable for the same input', () => {
  const items = [makeItem('live-app-quality', 75, 0.30)];
  const input = makeInput(items);
  const rc = computeReleaseConfidence(input);
  const entry1 = toAuditEntry(rc, 1);
  const entry2 = toAuditEntry(rc, 1);
  assert.equal(entry1.recordHash, entry2.recordHash, 'hash stable for same input');
});

test('toAuditEntry: recordHash changes when confidenceScore changes (tamper-evidence)', () => {
  const items1 = [makeItem('live-app-quality', 75, 0.30)];
  const items2 = [makeItem('live-app-quality', 90, 0.30)];
  const rc1 = computeReleaseConfidence(makeInput(items1));
  const rc2 = computeReleaseConfidence(makeInput(items2));
  const entry1 = toAuditEntry(rc1, 1);
  const entry2 = toAuditEntry(rc2, 1);
  assert.notEqual(entry1.recordHash, entry2.recordHash, 'hash changes on different scores');
});

test('toAuditEntry: fields match the ReleaseConfidence source', () => {
  const { rc } = makeRc([makeItem('live-app-quality', 75, 0.30)]);
  const entry = toAuditEntry(rc, 1);
  assert.equal(entry.tenantId, rc.subject.tenantId);
  assert.equal(entry.subjectRef, rc.subject.ref);
  assert.equal(entry.computedAt, rc.computedAt);
  assert.equal(entry.confidenceScore, rc.confidenceScore);
  assert.equal(entry.verdict, rc.verdict);
  assert.equal(entry.schemaVersion, 1);
});

// ---------------------------------------------------------------------------
// View 2 — diffConfidence
// ---------------------------------------------------------------------------

test('diffConfidence: delta is positive when score improves', () => {
  const rc1 = computeReleaseConfidence(makeInput([makeItem('live-app-quality', 60, 0.30)]));
  const rc2 = computeReleaseConfidence(makeInput([makeItem('live-app-quality', 80, 0.30)]));
  const point = diffConfidence(rc2, rc1);
  assert.ok(point.deltaFromPrev! > 0, 'positive delta for improvement');
  assert.equal(point.deltaFromPrev, 20);
});

test('diffConfidence: delta is negative when score regresses', () => {
  const rc1 = computeReleaseConfidence(makeInput([makeItem('live-app-quality', 80, 0.30)]));
  const rc2 = computeReleaseConfidence(makeInput([makeItem('live-app-quality', 60, 0.30)]));
  const point = diffConfidence(rc2, rc1);
  assert.equal(point.deltaFromPrev, -20);
});

test('diffConfidence: deltaFromPrev null when no prior', () => {
  const rc = computeReleaseConfidence(makeInput([makeItem('live-app-quality', 75, 0.30)]));
  const point = diffConfidence(rc, null);
  assert.equal(point.deltaFromPrev, null);
});

test('diffConfidence: parses against DeliveryTrafficPointSchema', () => {
  const rc = computeReleaseConfidence(makeInput([makeItem('live-app-quality', 75, 0.30)]));
  const point = diffConfidence(rc, null);
  const parsed = DeliveryTrafficPointSchema.safeParse(point);
  assert.ok(parsed.success, `schema failed: ${JSON.stringify(parsed.error ?? null)}`);
});
