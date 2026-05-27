import type { AnalyzeResult } from './analyze.js';
import type { Gap } from './schemas/gap-analysis.schema.js';
import type { CostIntelligence } from './schemas/cost-intelligence.schema.js';

/**
 * Agent-readable summary of an AnalyzeResult. Intended for orchestrators
 * (CI gates, external agent loops) that need a small, stable JSON shape.
 *
 * QLIB-001 spec: see docs/agent-summary-output.md.
 * C02 helper; exposed via CLI (`--agent-summary`) and MCP (`agentSummary: true`).
 * Field names below are the v1 contract for `toAgentSummary`.
 */

export type AgentGate = 'pass' | 'warn' | 'fail';

export type CoverageStatus =
  | 'ok'
  | 'thin'
  | 'blocked-by-auth'
  | 'budget-exceeded'
  | 'navigation-failures'
  | 'unknown';

export interface AgentSummaryCostSummary {
  maxOutputTokensPerLlmCall: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  budgetWarningCount: number;
  dataQuality: CostIntelligence['usageSummary']['dataQuality'];
  maturityLevel: number;
  maturityLabel: string;
}

export interface AgentSummary {
  schemaVersion: 1;
  gate: AgentGate;
  releaseConfidence: number | null;
  coverageStatus: CoverageStatus;
  topRisks: string[];
  recommendedNextChecks: string[];
  honestyNotes: string[];
  costSummary: AgentSummaryCostSummary | null;
  deterministicFollowUps: string[];
}

export interface AgentSummaryPolicy {
  /** Confidence at or above this number is required for `pass`. Default 80. */
  passConfidenceThreshold?: number;
  /** Confidence below this triggers `fail` (when no harder failure already applies). Default 30. */
  failConfidenceThreshold?: number;
  /** Max risks/checks/notes to include in each list. Default 5. */
  maxListLength?: number;
  /**
   * Treat `mode === 'auth-required'` as `fail` (default) or `warn`.
   * Honest default: a deployment that was never exercised past auth cannot pass.
   */
  authRequiredGate?: 'fail' | 'warn';
}

interface ResolvedPolicy {
  passConfidenceThreshold: number;
  failConfidenceThreshold: number;
  maxListLength: number;
  authRequiredGate: 'fail' | 'warn';
}

const DEFAULT_POLICY: ResolvedPolicy = {
  passConfidenceThreshold: 80,
  failConfidenceThreshold: 30,
  maxListLength: 5,
  authRequiredGate: 'fail',
};

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;

function resolvePolicy(p: AgentSummaryPolicy | undefined): ResolvedPolicy {
  return {
    passConfidenceThreshold: p?.passConfidenceThreshold ?? DEFAULT_POLICY.passConfidenceThreshold,
    failConfidenceThreshold: p?.failConfidenceThreshold ?? DEFAULT_POLICY.failConfidenceThreshold,
    maxListLength: p?.maxListLength ?? DEFAULT_POLICY.maxListLength,
    authRequiredGate: p?.authRequiredGate ?? DEFAULT_POLICY.authRequiredGate,
  };
}

function countBySeverity(gaps: Gap[]): Record<Gap['severity'], number> {
  const counts: Record<Gap['severity'], number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const g of gaps) counts[g.severity]++;
  return counts;
}

function deriveCoverageStatus(result: AnalyzeResult): CoverageStatus {
  const g = result.gapAnalysis;
  if (g.mode === 'auth-required' || g.coverageWarning === 'auth-required') {
    return 'blocked-by-auth';
  }
  if (g.coverageWarning === 'budget-exceeded' || g.coverageBudgetExceeded) {
    return 'budget-exceeded';
  }
  if (g.coverageWarning === 'navigation-failures') {
    return 'navigation-failures';
  }
  if (g.coverageWarning === 'low-coverage') {
    return 'thin';
  }
  if (g.coveragePagesScanned === 0) {
    return 'unknown';
  }
  return 'ok';
}

function buildTopRisks(result: AnalyzeResult, limit: number): string[] {
  const risks: string[] = [];
  const status = deriveCoverageStatus(result);
  if (status === 'blocked-by-auth') {
    risks.push('Auth blocked the scan; protected routes were not exercised.');
  } else if (status === 'thin') {
    risks.push('Crawl coverage was below the confidence floor.');
  } else if (status === 'budget-exceeded') {
    risks.push('Crawl budget exceeded; coverage is partial.');
  } else if (status === 'navigation-failures') {
    risks.push('Navigation errors limited what could be scanned.');
  }

  const sorted = [...result.gaps].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );
  for (const g of sorted) {
    if (risks.length >= limit) break;
    risks.push(`[${g.severity}] ${g.category} — ${g.path}`);
  }
  return risks.slice(0, limit);
}

function buildRecommendedNextChecks(result: AnalyzeResult, limit: number): string[] {
  const out: string[] = [];
  const status = deriveCoverageStatus(result);
  if (status === 'blocked-by-auth') {
    out.push('Provide auth (form login or storage state) and re-run, or use explore_auth.');
  }
  if (status === 'thin') {
    out.push('Increase crawl budget or supply deeper entry URLs to raise coverage above the floor.');
  }
  if (status === 'budget-exceeded') {
    out.push('Increase maxPagesToScan or narrow scope to bring the crawl under budget.');
  }

  const byCat = new Map<string, number>();
  for (const g of result.gaps) byCat.set(g.category, (byCat.get(g.category) ?? 0) + 1);
  const topCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [cat, n] of topCats) {
    if (out.length >= limit) break;
    out.push(`Add or tighten deterministic coverage for ${cat} (${n} gap(s) this scan).`);
  }
  return out.slice(0, limit);
}

function buildHonestyNotes(result: AnalyzeResult): string[] {
  const notes: string[] = ['This scan does not guarantee production readiness.'];
  const g = result.gapAnalysis;
  if (g.mode === 'auth-required' || g.coverageWarning === 'auth-required') {
    notes.push('Authenticated surface was not exercised: confidence does not reflect protected routes.');
  }
  if (g.coverageWarning === 'low-coverage') {
    notes.push('Coverage was below the confidence threshold; treat the score as a ceiling.');
  }
  if (g.coverageBudgetExceeded || g.coverageWarning === 'budget-exceeded') {
    notes.push('Crawl budget was exceeded; some routes were not scanned.');
  }
  if (g.coverageWarning === 'navigation-failures') {
    notes.push('Navigation failures reduced effective coverage.');
  }
  if (result.status === 'partial') {
    notes.push('Scan completed only partially; signals are derived from a subset of intended work.');
  }
  if (result.status === 'blocked') {
    notes.push('Scan was blocked before producing a meaningful evaluation.');
  }
  return notes;
}

function buildCostSummary(ci: CostIntelligence | undefined): AgentSummaryCostSummary | null {
  if (!ci) return null;
  return {
    maxOutputTokensPerLlmCall: ci.maxOutputTokensPerLlmCall,
    totalInputTokens: ci.usageSummary.totalInputTokens,
    totalOutputTokens: ci.usageSummary.totalOutputTokens,
    budgetWarningCount: ci.budgetWarnings.length,
    dataQuality: ci.usageSummary.dataQuality,
    maturityLevel: ci.deterministicMaturity.level,
    maturityLabel: ci.deterministicMaturity.label,
  };
}

function buildDeterministicFollowUps(ci: CostIntelligence | undefined, limit: number): string[] {
  if (!ci) return [];
  return ci.conversionRecommendations.slice(0, limit);
}

/**
 * Default gate policy:
 *   - fail when: any critical gap, status === 'blocked', releaseConfidence is null,
 *                releaseConfidence < failConfidenceThreshold, or mode === 'auth-required'
 *                under the default authRequiredGate.
 *   - warn when: any high-severity gap, status === 'partial', coverage is thin /
 *                budget-exceeded / navigation-failures, or confidence is below
 *                passConfidenceThreshold (but at or above failConfidenceThreshold).
 *   - pass when: confidence >= passConfidenceThreshold AND no blocking conditions.
 *
 * Honesty rule: an `auth-required` scan never silently `pass`es under defaults.
 */
function deriveGate(result: AnalyzeResult, policy: ResolvedPolicy): AgentGate {
  const g = result.gapAnalysis;
  const counts = countBySeverity(result.gaps);

  if (counts.critical > 0) return 'fail';
  if (result.status === 'blocked') return 'fail';
  if (g.mode === 'auth-required' || g.coverageWarning === 'auth-required') {
    return policy.authRequiredGate;
  }
  if (result.releaseConfidence === null) return 'fail';
  if (result.releaseConfidence < policy.failConfidenceThreshold) return 'fail';

  const hasCoverageIssue =
    g.coverageWarning === 'low-coverage' ||
    g.coverageWarning === 'budget-exceeded' ||
    g.coverageWarning === 'navigation-failures' ||
    g.coverageBudgetExceeded;

  if (counts.high > 0) return 'warn';
  if (result.status === 'partial') return 'warn';
  if (hasCoverageIssue) return 'warn';
  if (result.releaseConfidence < policy.passConfidenceThreshold) return 'warn';

  return 'pass';
}

/**
 * Convert an `AnalyzeResult` into a small agent-facing summary.
 *
 * Pure function. No I/O. CLI / MCP wiring belongs to QLIB-001-C03 and -C04.
 */
export function toAgentSummary(
  result: AnalyzeResult,
  policy?: AgentSummaryPolicy
): AgentSummary {
  const resolved = resolvePolicy(policy);
  const limit = resolved.maxListLength;
  return {
    schemaVersion: 1,
    gate: deriveGate(result, resolved),
    releaseConfidence: result.releaseConfidence,
    coverageStatus: deriveCoverageStatus(result),
    topRisks: buildTopRisks(result, limit),
    recommendedNextChecks: buildRecommendedNextChecks(result, limit),
    honestyNotes: buildHonestyNotes(result),
    costSummary: buildCostSummary(result.gapAnalysis.costIntelligence),
    deterministicFollowUps: buildDeterministicFollowUps(
      result.gapAnalysis.costIntelligence,
      limit
    ),
  };
}
