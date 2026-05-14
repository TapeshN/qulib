import type { AnalyzeResult } from '@qulib/core';

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;

function topGapsBySeverity(gaps: AnalyzeResult['gaps'], limit: number) {
  return [...gaps].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]).slice(0, limit);
}

function nextDeterministicChecks(gaps: AnalyzeResult['gaps'], conversion: string[]): string[] {
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

export function summarizeAnalyzeResult(result: AnalyzeResult, includeFullReport: boolean) {
  if (includeFullReport) {
    return result;
  }
  const g = result.gapAnalysis;
  const ci = g.costIntelligence;
  const top = topGapsBySeverity(result.gaps, 5);
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

  const ps = result.publicSurface;

  const repo = result.repoInventory;
  const repoInventorySummary = repo
    ? {
        repoPath: repo.repoPath,
        scannedAt: repo.scannedAt,
        routeCount: repo.routes.length,
        testFileCount: repo.testFiles.length,
        missingTestIdCount: repo.missingTestIds.length,
        interactiveTsxFilesScanned: repo.interactiveTsxFilesScanned ?? null,
        cypressDetected: repo.cypressStructure.detected,
        ...(repo.framework && {
          framework: {
            primary: repo.framework.primary,
            confidence: repo.framework.confidence,
            testFrameworks: repo.framework.testFrameworks,
            evidenceCount: repo.framework.evidence.length,
          },
        }),
      }
    : null;

  return {
    summary: {
      status: result.status,
      coverageScore: result.coverageScore,
      releaseConfidence: g.releaseConfidence,
      mode: g.mode,
      coveragePagesScanned: g.coveragePagesScanned,
      coverageBudgetExceeded: g.coverageBudgetExceeded,
      coverageWarning: g.coverageWarning ?? null,
      gapCount: g.gaps.length,
      scenarioCount: g.scenarios.length,
      generatedTestCount: g.generatedTests.length,
      publicSurface:
        ps === null
          ? null
          : {
              pageCount: ps.pages.length,
              gapCount: ps.gaps.length,
              accessibilityViolationCount: ps.accessibilityViolations.length,
              brokenLinkCount: ps.brokenLinks.length,
            },
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
      ? nextDeterministicChecks(result.gaps, ci.conversionRecommendations)
      : nextDeterministicChecks(result.gaps, []),
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
    ...(repo?.automationMaturity && {
      automationMaturitySummary: {
        overallScore: repo.automationMaturity.overallScore,
        level: repo.automationMaturity.level,
        label: repo.automationMaturity.label,
        topRecommendations: repo.automationMaturity.topRecommendations,
        dimensions: repo.automationMaturity.dimensions.map((d) => ({
          dimension: d.dimension,
          score: d.score,
          applicability: d.applicability ?? 'applicable',
          ...(d.guidance !== undefined && { guidance: d.guidance }),
        })),
      },
    }),
    repoInventorySummary,
    decisionLogPreview: result.decisionLog.slice(-8),
    ...(result.detectedAuth !== undefined && { detectedAuth: result.detectedAuth }),
    includeFullReport: false,
    note: 'Summary-first payload. Pass includeFullReport: true for the full gapAnalysis (all scenarios, generated tests) and the full repoInventory (test files, missing test IDs).',
  };
}
