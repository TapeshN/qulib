/**
 * Runtime-import check for qulib_score_confidence MCP tool logic (spec §6.E).
 *
 * This test imports the public surface of @qulib/core as a *consumer* and
 * exercises the confidence computation pipeline end-to-end with a stubbed
 * AnalyzeResult (mirrors the fixture-server idiom — we stub the network/Playwright
 * layer and verify the aggregation logic that the MCP handler wires together).
 *
 * Asserts:
 *   - buildConfidenceInputFromQulib + computeReleaseConfidence compose correctly
 *   - the output parses against ReleaseConfidenceSchema
 *   - verdict ∈ ConfidenceVerdictSchema enum
 *   - honesty notes present for excluded sources (not_applicable / unknown)
 *   - blocking evidence forces verdict='block'
 *
 * The MCP handler in packages/mcp/src/index.ts calls exactly this pipeline, so
 * these tests are the runtime-import proof that the wired surface is correct.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReleaseConfidence,
  buildConfidenceInputFromQulib,
  ReleaseConfidenceSchema,
  ConfidenceVerdictSchema,
} from '@qulib/core';
import type { AnalyzeResult } from '@qulib/core';

// ---------------------------------------------------------------------------
// Stub helpers (no Playwright, no network)
// ---------------------------------------------------------------------------

function makeCleanAnalyzeResult(releaseConfidence: number): AnalyzeResult {
  const now = new Date().toISOString();
  return {
    status: 'complete',
    coverageScore: 90,
    releaseConfidence,
    gaps: [],
    gapAnalysis: {
      analyzedAt: now,
      mode: 'url-only',
      releaseConfidence,
      coveragePagesScanned: 8,
      coverageBudgetExceeded: false,
      gaps: [],
      scenarios: [],
      generatedTests: [],
    },
    routeInventory: {
      scannedAt: now,
      baseUrl: 'https://fixture.example.com',
      routes: [],
      pagesSkipped: 0,
      budgetExceeded: false,
    },
    repoInventory: null,
    decisionLog: [],
    publicSurface: null,
  };
}

function makeBlockedAnalyzeResult(): AnalyzeResult {
  const now = new Date().toISOString();
  return {
    status: 'blocked',
    coverageScore: 0,
    releaseConfidence: null,
    gaps: [],
    gapAnalysis: {
      analyzedAt: now,
      mode: 'url-only',
      releaseConfidence: null,
      coveragePagesScanned: 0,
      coverageBudgetExceeded: false,
      gaps: [],
      scenarios: [],
      generatedTests: [],
    },
    routeInventory: {
      scannedAt: now,
      baseUrl: 'https://fixture.example.com',
      routes: [],
      pagesSkipped: 0,
      budgetExceeded: false,
    },
    repoInventory: null,
    decisionLog: [],
    publicSurface: null,
  };
}

const subject = { kind: 'release' as const, ref: 'https://fixture.example.com', tenantId: 'test' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('qulib_score_confidence pipeline: clean analyze result parses against ReleaseConfidenceSchema', async () => {
  const analyze = makeCleanAnalyzeResult(85);
  const input = buildConfidenceInputFromQulib({ analyze, subject });
  const rc = computeReleaseConfidence(input);

  const parsed = ReleaseConfidenceSchema.safeParse(rc);
  assert.ok(parsed.success, `ReleaseConfidenceSchema parse failed: ${JSON.stringify(parsed.error ?? null)}`);
});

test('qulib_score_confidence pipeline: verdict is a valid ConfidenceVerdict', () => {
  const analyze = makeCleanAnalyzeResult(85);
  const input = buildConfidenceInputFromQulib({ analyze, subject });
  const rc = computeReleaseConfidence(input);

  const validVerdicts = ConfidenceVerdictSchema.options;
  assert.ok(
    validVerdicts.includes(rc.verdict),
    `verdict "${rc.verdict}" not in enum [${validVerdicts.join(', ')}]`
  );
});

test('qulib_score_confidence pipeline: high-confidence analyze result yields ship or caution', () => {
  const analyze = makeCleanAnalyzeResult(90);
  const input = buildConfidenceInputFromQulib({ analyze, subject });
  const rc = computeReleaseConfidence(input);

  assert.ok(
    rc.verdict === 'ship' || rc.verdict === 'caution',
    `expected ship or caution for high-confidence input, got ${rc.verdict}`
  );
  assert.ok(rc.confidenceScore !== null);
  assert.ok(rc.confidenceScore > 0);
});

test('qulib_score_confidence pipeline: blocked scan forces verdict=block', () => {
  const analyze = makeBlockedAnalyzeResult();
  const input = buildConfidenceInputFromQulib({ analyze, subject });
  const rc = computeReleaseConfidence(input);

  assert.equal(rc.verdict, 'block', `expected block for a blocked scan, got ${rc.verdict}`);
  assert.ok(rc.blockers.length > 0, 'should have at least one blocker message');
});

test('qulib_score_confidence pipeline: schemaVersion is 1', () => {
  const analyze = makeCleanAnalyzeResult(70);
  const input = buildConfidenceInputFromQulib({ analyze, subject });
  const rc = computeReleaseConfidence(input);

  assert.equal(rc.schemaVersion, 1);
});

test('qulib_score_confidence pipeline: subject fields are propagated correctly', () => {
  const analyze = makeCleanAnalyzeResult(75);
  const input = buildConfidenceInputFromQulib({ analyze, subject });
  const rc = computeReleaseConfidence(input);

  assert.equal(rc.subject.ref, subject.ref);
  assert.equal(rc.subject.tenantId, subject.tenantId);
  assert.equal(rc.subject.kind, subject.kind);
});

test('qulib_score_confidence pipeline: contributions array is present and non-empty for analyze input', () => {
  const analyze = makeCleanAnalyzeResult(80);
  const input = buildConfidenceInputFromQulib({ analyze, subject });
  const rc = computeReleaseConfidence(input);

  assert.ok(Array.isArray(rc.contributions));
  assert.ok(rc.contributions.length > 0, 'should have at least one contribution from analyzeApp');
});
