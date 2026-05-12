import type { AnalyzeResult } from '@qulib/core';

const severityOrder = { high: 0, medium: 1, low: 2 } as const;

function topGapsBySeverity(gaps: AnalyzeResult['gapAnalysis']['gaps'], limit: number) {
  return [...gaps].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]).slice(0, limit);
}

function nextDeterministicChecks(gaps: AnalyzeResult['gapAnalysis']['gaps'], conversion: string[]): string[] {
  const out: string[] = [];
  const byCat = new Map<string, number>();
  for (const g of gaps) {
    byCat.set(g.category, (byCat.get(g.category) ?? 0) + 1);
  }
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    out.push(`Add or tighten deterministic coverage for **${cat}** (${n} gap(s) in this scan).`);
  }
  out.push(...conversion.slice(0, 2));
  return out.slice(0, 5);
}

export function buildCompactAnalyzePayload(result: AnalyzeResult, includeFullReport: boolean) {
  if (includeFullReport) {
    return result;
  }
  const g = result.gapAnalysis;
  const ci = g.costIntelligence;
  const top = topGapsBySeverity(g.gaps, 5);
  const costSummary = ci
    ? {
        maxOutputTokensPerLlmCall: ci.maxOutputTokensPerLlmCall,
        usageDataQuality: ci.usageSummary.dataQuality,
        totalInputTokens: ci.usageSummary.totalInputTokens,
        totalOutputTokens: ci.usageSummary.totalOutputTokens,
        budgetWarningCount: ci.budgetWarnings.length,
        maturityLevel: ci.deterministicMaturity.level,
        maturityLabel: ci.deterministicMaturity.label,
      }
    : null;

  return {
    summary: {
      releaseConfidence: g.releaseConfidence,
      mode: g.mode,
      coveragePagesScanned: g.coveragePagesScanned,
      coverageBudgetExceeded: g.coverageBudgetExceeded,
      coverageWarning: g.coverageWarning ?? null,
      gapCount: g.gaps.length,
      scenarioCount: g.scenarios.length,
      generatedTestCount: g.generatedTests.length,
    },
    topGaps: top.map((x) => ({
      path: x.path,
      category: x.category,
      severity: x.severity,
      reason: x.reason,
    })),
    costIntelligenceSummary: costSummary,
    costIntelligence: ci ?? null,
    nextDeterministicChecks: ci
      ? nextDeterministicChecks(g.gaps, ci.conversionRecommendations)
      : nextDeterministicChecks(g.gaps, []),
    gapAnalysisPreview: {
      analyzedAt: g.analyzedAt,
      gapsSample: g.gaps.slice(0, 8),
      scenariosOmitted: g.scenarios.length,
      generatedTestsOmitted: g.generatedTests.length,
    },
    routeInventorySummary: {
      scannedAt: result.routeInventory.scannedAt,
      baseUrl: result.routeInventory.baseUrl,
      routeCount: result.routeInventory.routes.length,
      pagesSkipped: result.routeInventory.pagesSkipped,
      budgetExceeded: result.routeInventory.budgetExceeded,
    },
    repoInventory: result.repoInventory,
    decisionLogPreview: result.decisionLog.slice(-8),
    ...(result.detectedAuth !== undefined && { detectedAuth: result.detectedAuth }),
    includeFullReport: false,
    note: 'Summary-first payload. Pass includeFullReport: true for full gapAnalysis (all scenarios and generatedTests).',
  };
}
