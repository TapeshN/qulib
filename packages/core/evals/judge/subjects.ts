/**
 * Suite-specific judge subjects + grounding builders (Q2c — eval-judge).
 *
 * Turns real qulib output shapes into a `JudgeSubject` (candidate text + the
 * factual grounding the rubric grades against). Kept separate from judge.ts so the
 * grounding shape is unit-testable and the judge core stays suite-agnostic.
 *
 * Types are sourced from qulib's own schemas so the grounding stays faithful to
 * what the CLIs actually emit:
 *   - scaffold         → `GeneratedTest` + `NeutralScenario` (gap-analysis.schema)
 *   - score-automation → `AutomationMaturity` (automation-maturity.schema)
 */

import type { GeneratedTest, NeutralScenario } from '../../src/schemas/gap-analysis.schema.js';
import type { AutomationMaturity } from '../../src/schemas/automation-maturity.schema.js';
import type { ReleaseConfidence } from '../../src/schemas/confidence.schema.js';
import type { JudgeSubject } from './prompt.js';

/** Input for grading a single generated scaffold spec. */
export interface ScaffoldSpecSubject {
  /** The generated test whose `code` is graded. */
  test: GeneratedTest;
  /** The scenario the test was rendered from (intent + steps + target path). */
  scenario: NeutralScenario;
  /**
   * Every route qulib actually discovered for the app, e.g. ["/", "/login", "/pricing"].
   * The "no-hallucinated-routes" dimension grades navigations against this set.
   */
  discoveredRoutes: string[];
  /** Model that produced the spec (for the self-grade guard). */
  subjectModel?: string;
}

/** Input for grading a maturity narrative. */
export interface MaturityNarrativeSubject {
  /** The human-facing narrative text (label + recommendations + prose) under judgment. */
  narrative: string;
  /** The computed maturity object — the truth set the narrative must be faithful to. */
  maturity: AutomationMaturity;
  /** Model that produced the narrative (for the self-grade guard). */
  subjectModel?: string;
}

/**
 * Build the scaffold judge subject. Grounding includes the discovered routes (the
 * allowed navigation targets), the scenario target path + intent, and the ordered
 * step actions — enough for the judge to check selectors/assertions/route fidelity.
 */
export function buildScaffoldSubject(input: ScaffoldSpecSubject): JudgeSubject {
  const { test, scenario, discoveredRoutes } = input;
  // Allowed nav targets = discovered routes ∪ the scenario's own target path.
  const allowedRoutes = Array.from(new Set([...discoveredRoutes, scenario.targetPath].filter(Boolean)));
  return {
    candidate: test.code,
    grounding: {
      framework: test.adapter,
      source: test.source,
      scenario: {
        title: scenario.title,
        intent: scenario.description,
        targetPath: scenario.targetPath,
        targetComponent: scenario.targetComponent ?? null,
        steps: scenario.steps.map((s) => ({
          action: s.action,
          target: s.target ?? null,
          description: s.description,
        })),
      },
      allowedNavigationTargets: allowedRoutes,
      note: 'A navigation to any path NOT in allowedNavigationTargets is a hallucinated route.',
    },
    subjectModel: input.subjectModel,
  };
}

/** Input for grading a release-confidence narrative (P4 — confidence-narrative rubric). */
export interface ConfidenceNarrativeSubject {
  /** The human-facing narrative text under judgment (from buildConfidenceNarrative or similar). */
  narrative: string;
  /** The computed ReleaseConfidence result — the truth set the narrative must be faithful to. */
  releaseConfidence: ReleaseConfidence;
  /** Model that produced the narrative (for the self-grade guard). */
  subjectModel?: string;
}

/**
 * Build the confidence-narrative judge subject. Grounding exposes the computed
 * verdict, score, level, per-source contributions (with scores + applicability +
 * effectiveWeight), top risks, honesty notes, and blockers — the full truth set
 * the narrative must faithfully describe. The judge can then catch invented numbers,
 * verdict contradictions, ungrounded claims, and mishandled abstentions.
 */
export function buildConfidenceSubject(input: ConfidenceNarrativeSubject): JudgeSubject {
  const rc = input.releaseConfidence;
  return {
    candidate: input.narrative,
    grounding: {
      verdict: rc.verdict,
      confidenceScore: rc.confidenceScore,
      level: rc.level,
      label: rc.label,
      scoreFormula: rc.scoreFormula,
      contributions: rc.contributions.map((c) => ({
        source: c.source,
        applicability: c.applicability,
        score: c.score,
        effectiveWeight: c.effectiveWeight,
        blocking: c.blocking,
      })),
      topRisks: rc.topRisks,
      recommendedNextChecks: rc.recommendedNextChecks,
      honestyNotes: rc.honestyNotes,
      blockers: rc.blockers,
      note:
        'not_applicable and unknown contributions have effectiveWeight=0 and must NOT be reported as failures. ' +
        'A null confidenceScore means INSUFFICIENT_EVIDENCE. ' +
        'Any fact not present in this grounding object that appears in the narrative is a hallucination.',
    },
    subjectModel: input.subjectModel,
  };
}

/**
 * Build the maturity-narrative judge subject. Grounding includes the overall score,
 * level/label, and every dimension's score + weight + applicability + evidence — so
 * the judge can catch invented numbers, ungrounded claims, and mishandled N/A dims.
 */
export function buildMaturitySubject(input: MaturityNarrativeSubject): JudgeSubject {
  const { maturity } = input;
  return {
    candidate: input.narrative,
    grounding: {
      overallScore: maturity.overallScore,
      level: maturity.level,
      label: maturity.label,
      scoreFormula: maturity.scoreFormula,
      dimensions: maturity.dimensions.map((d) => ({
        dimension: d.dimension,
        score: d.score,
        weight: d.weight,
        applicability: d.applicability ?? 'applicable',
        evidence: d.evidence,
      })),
      computedRecommendations: maturity.topRecommendations,
      note: 'not_applicable / unknown dimensions are excluded from the overall score and must NOT be reported as failures.',
    },
    subjectModel: input.subjectModel,
  };
}
