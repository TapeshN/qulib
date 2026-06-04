/**
 * Pinned LLM-as-judge rubrics (Q2c — eval-judge).
 *
 * Each rubric is a versioned, immutable contract: a set of weighted dimensions
 * (weights sum to 1) plus per-band thresholds. A `JudgeVerdict` records the
 * `rubricVersion` used so any verdict is reproducible/auditable
 * (root CLAUDE.md doctrine #11 — pin judge model + rubric version).
 *
 * VERSIONING RULE (additive / immutable):
 *   - NEVER mutate the dimensions, weights, or thresholds of a published version.
 *   - To change grading, ADD a new `*-vN` rubric and flip `*_RUBRIC` to point at it.
 *   - The golden judge dataset pins a `rubricVersion` per case; bumping a rubric
 *     means re-grading the golden cases and (intentionally) moving the ledger score.
 *
 * Two suites are graded (mirroring evals/types.ts `EvalSuite`):
 *   - `scaffold`         → grades a generated test spec (real selectors? meaningful
 *                          assertions? no hallucinated routes?).
 *   - `score-automation` → grades the maturity NARRATIVE (label/recommendations
 *                          grounded in the computed evidence; no invented numbers).
 */

import type { EvalOutcome, EvalSuite } from '../types.js';

/** A single weighted rubric dimension the judge must score 0..1. */
export interface RubricDimension {
  /** Stable key, kebab-case; appears verbatim in the judge's JSON response. */
  key: string;
  /** Human title shown in the judge prompt. */
  title: string;
  /** What "1.0" means vs "0.0" — the explicit grading instruction. */
  guidance: string;
  /** Weight in the aggregate score. All weights in a rubric sum to 1. */
  weight: number;
  /**
   * If true, a near-zero score on this dimension caps the whole verdict at FAIL
   * regardless of the weighted aggregate. Used for hard correctness gates
   * (e.g. a hallucinated route, or an invented maturity number).
   */
  critical?: boolean;
}

export interface Rubric {
  suite: EvalSuite;
  /** Pinned version string recorded on every verdict, e.g. "scaffold-v1". */
  version: string;
  /** One-line summary of what this rubric grades. */
  summary: string;
  dimensions: RubricDimension[];
  /** Score bands → outcome. aggregate >= passAt ⇒ PASS, >= warnAt ⇒ WARN, else FAIL. */
  thresholds: { passAt: number; warnAt: number };
  /**
   * Critical-dimension floor: if any `critical` dimension scores <= this, the
   * verdict is forced to FAIL (a hallucination/grounding failure can't be averaged away).
   */
  criticalFloor: number;
}

/**
 * scaffold-v1 — grades a single generated E2E spec (Playwright/Cypress) emitted by
 * `scaffoldTests`. The judge sees the spec `code`, the scenario it came from
 * (title/targetPath/steps), and the set of routes qulib actually discovered.
 */
export const SCAFFOLD_RUBRIC_V1: Rubric = {
  suite: 'scaffold',
  version: 'scaffold-v1',
  summary: 'Generated E2E spec uses real selectors, makes meaningful assertions, and invents no routes.',
  dimensions: [
    {
      key: 'no-hallucinated-routes',
      title: 'No hallucinated routes',
      guidance:
        'Every path the spec navigates to (cy.visit / page.goto / baseUrl-relative path) MUST be one of the discovered routes or the scenario targetPath. Score 1.0 if all navigations map to a discovered/target path; 0.0 if the spec navigates to a route that was never discovered (a hallucination).',
      weight: 0.4,
      critical: true,
    },
    {
      key: 'meaningful-assertions',
      title: 'Meaningful assertions',
      guidance:
        'The spec must contain at least one real assertion that verifies app behavior (visibility, text, count, URL, status), not just a navigation with no check. Score 1.0 for substantive assertions tied to the scenario intent; 0.5 for a single weak/boilerplate assertion; 0.0 for navigation-only / no assertion.',
      weight: 0.35,
    },
    {
      key: 'real-selectors',
      title: 'Real / robust selectors',
      guidance:
        'Selectors should be role-based, data-testid, or text the page plausibly contains — not brittle invented ids or absolute nth-child chains. Score 1.0 for role/testid/text selectors aligned with the scenario; 0.5 for generic-but-plausible (e.g. a tag selector); 0.0 for clearly invented element ids with no grounding.',
      weight: 0.25,
    },
  ],
  thresholds: { passAt: 0.8, warnAt: 0.6 },
  criticalFloor: 0.2,
};

/**
 * score-automation-v1 — grades the maturity NARRATIVE: the `label`,
 * `topRecommendations`, and per-dimension prose. The judge sees the narrative plus
 * the computed numbers (overallScore, level, per-dimension scores + applicability +
 * evidence) and checks that the prose is faithful to them.
 */
export const SCORE_AUTOMATION_RUBRIC_V1: Rubric = {
  suite: 'score-automation',
  version: 'score-automation-v1',
  summary: 'Maturity narrative is faithful to the computed evidence and invents no numbers or unsupported claims.',
  dimensions: [
    {
      key: 'numeric-faithfulness',
      title: 'Numeric faithfulness',
      guidance:
        'Any score, level, ratio, or count stated in the narrative MUST match the computed evidence. Score 1.0 if every number is consistent with the provided computation; 0.0 if the narrative states a number that contradicts or is absent from the computed evidence (an invented metric).',
      weight: 0.4,
      critical: true,
    },
    {
      key: 'evidence-grounding',
      title: 'Evidence grounding',
      guidance:
        'Claims and recommendations must be grounded in the per-dimension evidence/applicability provided. Score 1.0 if every claim traces to evidence; 0.5 if a claim is plausible but unsupported; 0.0 if a claim contradicts the evidence (e.g. praising CI when ci-integration scored 0).',
      weight: 0.35,
    },
    {
      key: 'applicability-honesty',
      title: 'Applicability honesty',
      guidance:
        'Dimensions marked not_applicable / unknown MUST NOT be reported as a 0 failure or a strength. Score 1.0 if the narrative treats N/A and unknown dimensions honestly (excluded, not penalized); 0.0 if it presents an unknown/N/A dimension as a hard failure or fabricated strength.',
      weight: 0.25,
    },
  ],
  thresholds: { passAt: 0.8, warnAt: 0.6 },
  criticalFloor: 0.2,
};

/**
 * confidence-narrative-v1 — grades the release-confidence NARRATIVE: the
 * `narrative` string emitted by `buildConfidenceNarrative` in run-confidence.ts
 * (or any similar human-facing confidence explanation). The judge sees the
 * narrative plus the computed `ReleaseConfidence` object and checks that the
 * prose is faithful to the deterministic result.
 *
 * Four axes (P4 spec §4):
 *   correctness      (0.30) — narrative matches the computed verdict + evidence
 *   grounding        (0.30) — every claim traces to an evidence/breakdown string
 *   format           (0.15) — verdict stated up-front, abstentions named, concise
 *   no-hallucination (0.25) — zero fabricated facts; veto axis (critical)
 *
 * Composite: 100 * (correctness*0.30 + grounding*0.30 + format*0.15 +
 *                   no_hallucination*0.25) / 5
 *   PASS >= 0.80, WARN >= 0.60, FAIL < 0.60
 * Hard-fail rule: no_hallucination <= criticalFloor (0.2) => FAIL regardless of aggregate.
 */
export const CONFIDENCE_NARRATIVE_RUBRIC_V1: Rubric = {
  suite: 'confidence',
  version: 'confidence-narrative-v1',
  summary:
    'Release-confidence narrative is correct, grounded in evidence, well-formed, and free of invented facts.',
  dimensions: [
    {
      key: 'correctness',
      title: 'Correctness',
      guidance:
        'Does the prose faithfully describe what the computed verdict, confidenceScore, and contributions actually say? ' +
        'Score 1.0 if every claim is consistent with the breakdown, topRisks, verdict, and confidenceScore; no contradiction. ' +
        'Score 0.5 if one minor mismatch (e.g. calls a medium risk "low") that does not change the ship decision. ' +
        'Score 0.2 if a material mismatch (narrative implies SHIP while verdict is HOLD, or misstates the dominant risk). ' +
        'Score 0.0 if the narrative describes a completely different release or evidence set. ' +
        'Deduction rule: any claim about the ship decision that contradicts the verdict caps this dimension at 0.2.',
      weight: 0.30,
    },
    {
      key: 'grounding',
      title: 'Grounding',
      guidance:
        'Is every factual claim anchored to a specific evidence string in the contributions/breakdown? ' +
        'Score 1.0 if every factual claim maps to an evidence string or risk.summary present in the input. ' +
        'Score 0.5 if mostly grounded; one claim is a reasonable summary but not directly traceable. ' +
        'Score 0.2 if multiple claims have no support in the provided evidence. ' +
        'Score 0.0 if the narrative\'s central claim is ungrounded. ' +
        'Anchor test: for each factual sentence ask "which evidence line backs this?" — unbackable sentences are ungrounded.',
      weight: 0.30,
    },
    {
      key: 'format',
      title: 'Format',
      guidance:
        'Is the output well-formed, complete, and right-sized? ' +
        'Score 1.0 if the narrative states the verdict and score/abstention up-front, summarizes the top risks, ' +
        'gives an actionable next step, and is concise (substance over length). When score is null the abstentions are named. ' +
        'Score 0.5 if present but uneven: buries the verdict, omits the abstention list when score is null, or is padded. ' +
        'Score 0.2 if missing a required element (no verdict stated, or no risk summary when risks exist). ' +
        'Score 0.0 if unstructured, unreadable, or clearly the wrong artifact. ' +
        'Verbosity guard: length is NOT rewarded; padding without added substance DEDUCTS here.',
      weight: 0.15,
    },
    {
      key: 'no-hallucination',
      title: 'No hallucination',
      guidance:
        'Are there ZERO fabricated facts — invented metrics, non-existent PRs/endpoints/flags, made-up numbers, ' +
        'or claimed evidence not in the input? ' +
        'Score 1.0 if nothing invented; every number and identifier appears in the input. ' +
        'Score 0.5 if one soft over-statement (e.g. "tests look solid" with no test contribution) — not a fabricated fact. ' +
        'Score 0.2 if one concrete fabricated fact (a metric, an endpoint, an approver, a flag not in evidence). ' +
        'Score 0.0 if multiple fabrications, or a fabricated fact drives the recommendation. ' +
        'HARD RULE: any concrete fabricated fact forces this dimension to <= 0.2, which triggers the criticalFloor gate => FAIL regardless of aggregate.',
      weight: 0.25,
      critical: true,
    },
  ],
  thresholds: { passAt: 0.80, warnAt: 0.60 },
  criticalFloor: 0.20,
};

/** Registry of the CURRENT pinned rubric per suite. Flip these to bump a version. */
export const RUBRICS: Record<EvalSuite, Rubric> = {
  scaffold: SCAFFOLD_RUBRIC_V1,
  'score-automation': SCORE_AUTOMATION_RUBRIC_V1,
  confidence: CONFIDENCE_NARRATIVE_RUBRIC_V1,
};

/** All published rubric versions (for the runner/ledger to enumerate / validate against). */
export const ALL_RUBRICS: Rubric[] = [SCAFFOLD_RUBRIC_V1, SCORE_AUTOMATION_RUBRIC_V1, CONFIDENCE_NARRATIVE_RUBRIC_V1];

/** Look up the pinned rubric for a suite. Throws on an unknown suite (fail-fast). */
export function getRubric(suite: EvalSuite): Rubric {
  const r = RUBRICS[suite];
  if (!r) throw new Error(`No rubric registered for suite: ${String(suite)}`);
  return r;
}

/**
 * Map an aggregate 0..1 score (plus critical-dimension scores) to a typed outcome.
 * Pure + deterministic so it is unit-testable without an LLM.
 */
export function scoreToOutcome(
  rubric: Rubric,
  aggregate: number,
  dimensionScores: ReadonlyArray<{ key: string; score: number }>
): EvalOutcome {
  // A critical dimension at/under the floor forces FAIL (hallucination/grounding gate).
  for (const dim of rubric.dimensions) {
    if (!dim.critical) continue;
    const got = dimensionScores.find((d) => d.key === dim.key);
    if (got && got.score <= rubric.criticalFloor) return 'FAIL';
  }
  if (aggregate >= rubric.thresholds.passAt) return 'PASS';
  if (aggregate >= rubric.thresholds.warnAt) return 'WARN';
  return 'FAIL';
}

/**
 * Validate a rubric's invariants (weights sum to ~1, thresholds ordered). Used by
 * tests and as a guard before grading. Returns an error string, or null if valid.
 */
export function validateRubric(rubric: Rubric): string | null {
  if (rubric.dimensions.length === 0) return `${rubric.version}: no dimensions`;
  const sum = rubric.dimensions.reduce((s, d) => s + d.weight, 0);
  if (Math.abs(sum - 1) > 1e-6) return `${rubric.version}: weights sum to ${sum}, expected 1`;
  for (const d of rubric.dimensions) {
    if (d.weight < 0 || d.weight > 1) return `${rubric.version}: dimension ${d.key} weight ${d.weight} out of [0,1]`;
  }
  const { passAt, warnAt } = rubric.thresholds;
  if (!(passAt > warnAt)) return `${rubric.version}: passAt (${passAt}) must exceed warnAt (${warnAt})`;
  if (passAt > 1 || warnAt < 0) return `${rubric.version}: thresholds out of [0,1]`;
  if (rubric.criticalFloor < 0 || rubric.criticalFloor >= warnAt)
    return `${rubric.version}: criticalFloor (${rubric.criticalFloor}) must be in [0, warnAt)`;
  return null;
}
