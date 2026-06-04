/**
 * qulib-native adapter — maps qulib collector outputs to EvidenceItem[].
 *
 * P3 — qulib Confidence Layer v1.
 *
 * This is the THIN WIRING layer, not the pure scorer. It translates:
 *   AnalyzeResult   → live-app-quality + accessibility + crawl-coverage EvidenceItems
 *   AutomationMaturity → test-automation EvidenceItem
 *   ApiCoverageResult  → api-coverage EvidenceItem
 *
 * Honesty rules (mirrors agent-summary.ts and the spec §2.5):
 * - auth-required scan → applicability='unknown' (never silent pass)
 * - blocked scan       → blocking=true (hard blocker)
 * - low-coverage       → crawl-coverage applicability='unknown'
 * - 0-endpoint API     → api-coverage carries its own not_applicable (passed through verbatim)
 *
 * Pure function: no I/O.
 */

import type { AnalyzeResult } from '../../analyze.js';
import type { AutomationMaturity } from '../../schemas/automation-maturity.schema.js';
import type { ApiCoverageResult } from './api-coverage.js';
import type {
  EvidenceItem,
  ConfidenceInput,
  ConfidenceSubject,
} from '../../schemas/confidence.schema.js';

// Default weights for the qulib-native sources (match confidence.ts DEFAULT_WEIGHTS).
const W_LIVE_APP = 0.30;
const W_TEST_AUTOMATION = 0.22;
const W_API_COVERAGE = 0.15;
const W_ACCESSIBILITY = 0.13;
const W_CRAWL_COVERAGE = 0.10;

/**
 * Build a ConfidenceInput from qulib's own collector outputs.
 * Pass whichever collectors you have; omitted collectors produce no evidence item.
 */
export function buildConfidenceInputFromQulib(args: {
  analyze?: AnalyzeResult;
  maturity?: AutomationMaturity;
  apiCoverage?: ApiCoverageResult;
  subject: ConfidenceSubject;
  policy?: ConfidenceInput['policy'];
}): ConfidenceInput {
  const items: EvidenceItem[] = [];
  const now = new Date().toISOString();

  // ------------------------------------------------------------------
  // AnalyzeResult → live-app-quality + accessibility + crawl-coverage
  // ------------------------------------------------------------------
  if (args.analyze) {
    const r = args.analyze;
    const g = r.gapAnalysis;

    // Determine if auth-required (honest: never silently pass).
    const authRequired = g.mode === 'auth-required' || g.coverageWarning === 'auth-required';
    const isBlocked = r.status === 'blocked';

    // --- live-app-quality ---
    const appRecs: string[] = [];
    if (authRequired) {
      appRecs.push('Provide auth credentials (form login or storage state) and re-run to evaluate the protected surface.');
    }
    const criticalGaps = r.gaps.filter((gap) => gap.severity === 'critical');
    const highGaps = r.gaps.filter((gap) => gap.severity === 'high');
    if (criticalGaps.length > 0) {
      appRecs.push(`Fix ${criticalGaps.length} critical gap(s) before shipping.`);
    } else if (highGaps.length > 0) {
      appRecs.push(`Address ${highGaps.length} high-severity gap(s).`);
    }

    const appEvidence: string[] = [];
    if (isBlocked) {
      appEvidence.push('Scan was blocked before producing a meaningful evaluation.');
    } else if (authRequired) {
      appEvidence.push('Auth wall prevented scanning the protected surface.');
    } else {
      appEvidence.push(
        `releaseConfidence=${r.releaseConfidence ?? 'null'}, status=${r.status}, gaps=${r.gaps.length}`
      );
      if (criticalGaps.length > 0) {
        appEvidence.push(`Critical gaps: ${criticalGaps.map((g2) => g2.path).join(', ')}`);
      }
    }

    const liveAppItem: EvidenceItem = {
      source: 'live-app-quality',
      score: isBlocked ? null : (authRequired ? null : (r.releaseConfidence ?? null)),
      weight: W_LIVE_APP,
      applicability: authRequired ? 'unknown' : 'applicable',
      blocking: isBlocked || criticalGaps.length > 0,
      evidence: appEvidence,
      recommendations: appRecs,
      reason: authRequired
        ? 'Auth wall prevented scanning — confidence score would be dishonest without the protected surface.'
        : isBlocked
        ? 'Scan was blocked; no evaluable surface.'
        : undefined,
      collectedAt: g.analyzedAt,
      collector: {
        tool: 'analyze_app',
        inputRef: undefined,
      },
    };
    items.push(liveAppItem);

    // --- accessibility ---
    const a11yGaps = r.gaps.filter((gap) => gap.category === 'a11y');
    const a11yPenalty = a11yGaps.reduce((acc, gap) => {
      const penalties: Record<string, number> = { critical: 30, high: 20, medium: 10, low: 5 };
      return acc + (penalties[gap.severity] ?? 5);
    }, 0);
    const a11yScore = !isBlocked && !authRequired
      ? Math.max(0, 100 - a11yPenalty)
      : null;

    const a11yItem: EvidenceItem = {
      source: 'accessibility',
      score: a11yScore,
      weight: W_ACCESSIBILITY,
      applicability: authRequired ? 'unknown' : 'applicable',
      blocking: false,
      evidence:
        isBlocked || authRequired
          ? ['Accessibility could not be evaluated (scan blocked or auth-required).']
          : a11yGaps.length === 0
          ? ['No a11y gaps detected.']
          : [`${a11yGaps.length} a11y gap(s) — penalty ${a11yPenalty} pts.`],
      recommendations:
        a11yGaps.length > 0
          ? ['Fix a11y violations flagged by the qulib scan (see gaps[].category=\'a11y\').']
          : [],
      reason: authRequired
        ? 'Auth wall prevented a11y evaluation.'
        : isBlocked
        ? 'Scan blocked; no a11y signal.'
        : undefined,
      collectedAt: g.analyzedAt,
      collector: {
        tool: 'analyze_app',
        inputRef: undefined,
      },
    };
    items.push(a11yItem);

    // --- crawl-coverage ---
    const lowCoverage = g.coverageWarning === 'low-coverage';
    const crawlScore = !isBlocked && !authRequired
      ? (r.coverageScore ?? null)
      : null;

    const crawlItem: EvidenceItem = {
      source: 'crawl-coverage',
      score: crawlScore,
      weight: W_CRAWL_COVERAGE,
      applicability: authRequired || lowCoverage ? 'unknown' : 'applicable',
      blocking: false,
      evidence: [
        `coverageScore=${r.coverageScore ?? 'null'}, pagesScanned=${g.coveragePagesScanned}`,
        ...(g.coverageWarning ? [`coverageWarning: ${g.coverageWarning}`] : []),
      ],
      recommendations:
        lowCoverage
          ? ['Increase crawl budget or supply deeper entry URLs to raise coverage above the floor.']
          : [],
      reason: authRequired
        ? 'Auth-required scan; coverage limited to pre-auth pages.'
        : lowCoverage
        ? 'Coverage was below the confidence floor; treating as unknown signal.'
        : undefined,
      collectedAt: g.analyzedAt,
      collector: {
        tool: 'analyze_app',
        inputRef: undefined,
      },
    };
    items.push(crawlItem);
  }

  // ------------------------------------------------------------------
  // AutomationMaturity → test-automation
  // ------------------------------------------------------------------
  if (args.maturity) {
    const m = args.maturity;
    const maturityItem: EvidenceItem = {
      source: 'test-automation',
      score: m.overallScore,
      weight: W_TEST_AUTOMATION,
      applicability: 'applicable',
      blocking: false,
      evidence: [`Automation maturity: ${m.label} (score ${m.overallScore})`],
      recommendations: m.topRecommendations.slice(0, 3),
      collectedAt: m.computedAt,
      collector: {
        tool: 'qulib_score_automation',
        inputRef: m.repoPath,
      },
    };
    items.push(maturityItem);
  }

  // ------------------------------------------------------------------
  // ApiCoverageResult → api-coverage
  // ------------------------------------------------------------------
  if (args.apiCoverage) {
    const d = args.apiCoverage.dimension;
    const apiApplicability = d.applicability === 'not_applicable'
      ? 'not_applicable' as const
      : d.applicability === 'unknown'
      ? 'unknown' as const
      : 'applicable' as const;

    const apiItem: EvidenceItem = {
      source: 'api-coverage',
      score: d.score,
      weight: W_API_COVERAGE,
      applicability: apiApplicability,
      blocking: false,
      evidence: d.evidence,
      recommendations: d.recommendations,
      reason: d.reason,
      collectedAt: new Date().toISOString(),
      collector: {
        tool: 'qulib_score_api',
        inputRef: undefined,
      },
    };
    items.push(apiItem);
  }

  return {
    subject: args.subject,
    evidence: items,
    policy: args.policy,
  };
}
