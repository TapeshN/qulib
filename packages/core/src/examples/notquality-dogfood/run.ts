/**
 * notquality DOGFOOD — runnable example.
 *
 * P5: qulib scoring a real app we own. This is the confidence-layer thesis
 * proven on a live delivery pipeline: qulib ingests notquality's CI results,
 * PR metadata, and automation maturity, then emits a real Release Confidence
 * score + verdict.
 *
 * Run with:
 *   npx tsx packages/core/src/examples/notquality-dogfood/run.ts
 *
 * What it does:
 *   1. Loads DATED real-sample fixture (provenance: gh CLI, 2026-06-04).
 *   2. Maps CI run → ciResultsToEvidence (EvidenceItem, source='ci-results').
 *   3. Maps PR metadata → prMetadataToEvidence (EvidenceItem, source='deploy-metadata').
 *   4. Builds a test-automation EvidenceItem from the pre-scored maturity facts.
 *   5. Calls computeReleaseConfidence → fused score + verdict.
 *   6. Prints a structured JSON report to stdout.
 *
 * HELD signals (operator-gated, not run here):
 *   - qulib_score_automation live scan (requires local notquality checkout + qulib CLI).
 *     Instead this example uses the statically-derived NOTQUALITY_AUTOMATION_MATURITY
 *     from the fixture (documented, conservative, clearly labelled as pre-scored).
 *   - analyze_app deployed crawl (external HTTP + optional LLM cost).
 *     The live-app-quality and accessibility EvidenceItems are omitted here; the
 *     pipeline runs correctly with a subset of evidence (partial-evidence honesty).
 *
 * Output format: NDJSON line appended to stdout (one JSON object per run).
 * The rubricVersion field versions the roll-up formula so it can evolve without
 * silently changing meaning (P5 stopgap formula; retires when qulib's own aggregator
 * ships in P3/P4 roadmap).
 */

import { ciResultsToEvidence } from '../../adapters/ci-results-adapter.js';
import { prMetadataToEvidence } from '../../adapters/pr-metadata-adapter.js';
import { computeReleaseConfidence } from '../../tools/scoring/confidence.js';
import type { EvidenceItem, ConfidenceInput } from '../../schemas/confidence.schema.js';
import {
  FIXTURE_COLLECTION_TS,
  NOTQUALITY_E2E_RUN,
  NOTQUALITY_PR_52,
  NOTQUALITY_AUTOMATION_MATURITY,
  NOTQUALITY_SUBJECT,
} from './fixture.js';

// ---------------------------------------------------------------------------
// Build the evidence bundle from real notquality delivery signals
// ---------------------------------------------------------------------------

/**
 * E2E CI run → ci-results evidence item.
 * Source: run #26931370208, E2E workflow, 2026-06-04.
 */
const e2eEvidence: EvidenceItem = ciResultsToEvidence(
  NOTQUALITY_E2E_RUN,
  FIXTURE_COLLECTION_TS
);

/**
 * PR #52 metadata → deploy-metadata evidence item.
 * Source: gh pr view 52 -R TapeshN/notquality, 2026-06-04.
 */
const prEvidence: EvidenceItem = prMetadataToEvidence(
  {
    ...NOTQUALITY_PR_52,
    statusCheckRollup: NOTQUALITY_PR_52.statusCheckRollup.map((c) => ({ ...c })),
  },
  FIXTURE_COLLECTION_TS
);

/**
 * Automation maturity → test-automation evidence item.
 * Source: static scan of origin/main, 2026-06-04.
 * NOTE: This is a pre-scored estimate. Live qulib_score_automation(repoPath)
 * is the authoritative signal; this is the operator-held substitute.
 */
const automationEvidence: EvidenceItem = {
  source: 'test-automation',
  score: NOTQUALITY_AUTOMATION_MATURITY.overallScore,
  weight: 0.22,
  applicability: 'applicable',
  blocking: false,
  evidence: [
    `Automation maturity: ${NOTQUALITY_AUTOMATION_MATURITY.label} (score ${NOTQUALITY_AUTOMATION_MATURITY.overallScore})`,
    `Source: static scan of ${NOTQUALITY_AUTOMATION_MATURITY.repoPath}`,
    '29 E2E spec files, 168 runnable tests (26 fixme/skip quarantined), Playwright + CI wired.',
    'No vitest/jest unit tests yet (component-test-ratio = 0).',
  ],
  recommendations: NOTQUALITY_AUTOMATION_MATURITY.topRecommendations.slice(),
  reason: undefined,
  collectedAt: FIXTURE_COLLECTION_TS,
  collector: {
    tool: 'qulib_score_automation.pre-scored',
    inputRef: NOTQUALITY_AUTOMATION_MATURITY.repoPath,
  },
};

// ---------------------------------------------------------------------------
// Assemble ConfidenceInput and compute the score
// ---------------------------------------------------------------------------

const input: ConfidenceInput = {
  subject: NOTQUALITY_SUBJECT,
  evidence: [e2eEvidence, prEvidence, automationEvidence],
  policy: {
    passThreshold: 80,
    failThreshold: 30,
    maxListLength: 5,
    requiredSources: [],
    // Default weights apply; explicit ci-results weight already on the EvidenceItem.
  },
};

const result = computeReleaseConfidence(input);

// ---------------------------------------------------------------------------
// Emit the structured report
// ---------------------------------------------------------------------------

const report = {
  rubricVersion: 'p5-dogfood-v1',
  collectionTimestamp: FIXTURE_COLLECTION_TS,
  tenantId: NOTQUALITY_SUBJECT.tenantId,
  subject: NOTQUALITY_SUBJECT.ref,
  sources: {
    e2eRun: NOTQUALITY_E2E_RUN.runUrl,
    ciRun: 'https://github.com/TapeshN/notquality/actions/runs/26931370215',
    pr: NOTQUALITY_PR_52.url,
    automationMaturity: `pre-scored from ${NOTQUALITY_AUTOMATION_MATURITY.repoPath}`,
  },
  heldSignals: [
    'qulib_score_automation live scan (operator-gated: requires local notquality checkout)',
    'analyze_app deployed crawl (operator-gated: external HTTP + optional LLM cost)',
  ],
  confidence: {
    score: result.confidenceScore,
    verdict: result.verdict,
    level: result.level,
    label: result.label,
  },
  contributions: result.contributions.map((c) => ({
    source: c.source,
    score: c.score,
    effectiveWeight: c.effectiveWeight,
    applicability: c.applicability,
  })),
  topRisks: result.topRisks,
  recommendations: result.recommendedNextChecks,
  honestyNotes: result.honestyNotes,
  scoreFormula: result.scoreFormula,
};

// eslint-disable-next-line no-console
console.log(JSON.stringify(report, null, 2));

// Print a human-readable summary line on stderr for quick reading in CI.
const verdictEmoji: Record<string, string> = {
  ship: 'SHIP',
  caution: 'CAUTION',
  hold: 'HOLD',
  block: 'BLOCK',
};
const v = verdictEmoji[result.verdict] ?? result.verdict.toUpperCase();
process.stderr.write(
  `[notquality dogfood] confidence=${result.confidenceScore ?? 'null'} verdict=${v} (${result.label})\n`
);
