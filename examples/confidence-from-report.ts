/**
 * Qulib example — compute release confidence from a saved report fixture.
 *
 * This file shows how to call `computeReleaseConfidence()` programmatically
 * from TypeScript, using frozen CI/PR signals as evidence items.
 *
 * It is HERMETIC: no live network calls, no LLM, no disk writes.
 * It runs entirely from the data defined below.
 *
 * Run from the repo root:
 *
 *   npx tsx examples/confidence-from-report.ts
 *
 * Expected output (verdict depends on the signals below):
 *
 *   {
 *     "verdict": "caution",
 *     "confidenceScore": 55,
 *     ...
 *   }
 */

import {
  computeReleaseConfidence,
} from '../packages/core/src/tools/scoring/confidence.js';
import type { ConfidenceInput, EvidenceItem } from '../packages/core/src/schemas/confidence.schema.js';

// ---------------------------------------------------------------------------
// Evidence items — replace with your own delivery signals.
// ---------------------------------------------------------------------------

/**
 * CI run evidence: your test suite passed (or not) on the latest commit.
 * Adapt `score` and `evidence` to match what your pipeline reports.
 */
const ciEvidence: EvidenceItem = {
  source: 'ci-results',
  score: 80,
  weight: 0.22,
  applicability: 'applicable',
  blocking: false,
  evidence: [
    'All checks passed: typecheck, lint, unit tests',
    'E2E: 42/42 tests green (0 skipped)',
  ],
  recommendations: [],
  reason: undefined,
  collectedAt: new Date().toISOString(),
  collector: { tool: 'manual', inputRef: 'https://github.com/my-org/my-app/actions/runs/12345' },
};

/**
 * Automation maturity evidence: how mature is the test suite?
 * Source: `npx @qulib/core score-automation --repo .`
 * Here we use a static value — run the CLI for a real score.
 */
const automationEvidence: EvidenceItem = {
  source: 'test-automation',
  score: 60,
  weight: 0.22,
  applicability: 'applicable',
  blocking: false,
  evidence: [
    'L3 — moderate automation maturity',
    'Unit tests present; E2E coverage is thin (8 spec files)',
    'No CI integration for accessibility checks',
  ],
  recommendations: ['Add axe-core a11y tests', 'Increase E2E spec coverage'],
  reason: undefined,
  collectedAt: new Date().toISOString(),
  collector: { tool: 'qulib_score_automation', inputRef: '.' },
};

/**
 * Live-app quality evidence: what did `qulib analyze` find?
 * Source: `npx @qulib/core analyze --url https://staging.example.com --agent-summary`
 * Here we use a static value — run the CLI for a real score.
 */
const liveAppEvidence: EvidenceItem = {
  source: 'live-app-quality',
  score: 35,
  weight: 0.3,
  applicability: 'applicable',
  blocking: false,
  evidence: [
    '3 pages scanned (thin coverage)',
    '2 high-severity a11y gaps (missing ARIA labels on nav)',
    '1 broken internal link on /about',
  ],
  recommendations: ['Fix ARIA labels on main nav', 'Fix broken /about link'],
  reason: undefined,
  collectedAt: new Date().toISOString(),
  collector: { tool: 'qulib_analyze_app', inputRef: 'https://staging.example.com' },
};

// ---------------------------------------------------------------------------
// Assemble and compute.
// ---------------------------------------------------------------------------

const input: ConfidenceInput = {
  subject: {
    kind: 'release',
    ref: 'https://staging.example.com',
    tenantId: 'default',
  },
  evidence: [ciEvidence, automationEvidence, liveAppEvidence],
  policy: {
    passThreshold: 80,
    failThreshold: 30,
    maxListLength: 5,
    requiredSources: [],
  },
};

const result = computeReleaseConfidence(input);

// ---------------------------------------------------------------------------
// Print the verdict.
// ---------------------------------------------------------------------------

const output = {
  verdict: result.verdict,
  confidenceScore: result.confidenceScore,
  level: result.level,
  label: result.label,
  topRisks: result.topRisks,
  recommendedNextChecks: result.recommendedNextChecks,
  honestyNotes: result.honestyNotes,
  scoreFormula: result.scoreFormula,
};

console.log(JSON.stringify(output, null, 2));

process.stderr.write(
  `[qulib example] verdict=${result.verdict} score=${result.confidenceScore ?? 'null'}\n`
);
