import { randomUUID } from 'node:crypto';
import { GapSchema, type GapAnalysis, type Gap } from '../schemas/gap-analysis.schema.js';
import type { RouteInventory } from '../schemas/route-inventory.schema.js';
import type { RepoAnalysis } from '../schemas/repo-analysis.schema.js';
import type { HarnessConfig } from '../schemas/config.schema.js';

export function analyzeGaps(
  routes: RouteInventory,
  repo: RepoAnalysis | null,
  mode: 'url-only' | 'url-repo',
  config: HarnessConfig
): Omit<GapAnalysis, 'scenarios' | 'generatedTests'> {
  const coveredPaths = new Set<string>();
  if (repo) {
    for (const testFile of repo.testFiles) {
      for (const path of testFile.coveredPaths) {
        coveredPaths.add(path);
      }
    }
  }

  const gaps: Gap[] = [];
  const addGap = (gap: Gap): void => {
    const validated = GapSchema.parse(gap);
    gaps.push(validated);
  };

  let hasNavigationFailures = false;

  for (const route of routes.routes) {
    if (repo && !coveredPaths.has(route.path)) {
      const highRisk = /checkout|payment|auth|login|order/i.test(route.path);
      addGap({
        id: randomUUID(),
        path: route.path,
        severity: highRisk ? 'high' : 'medium',
        reason: `Route is not covered by existing tests: ${route.path}`,
        category: 'untested-route',
      });
    }

    const navErrors = route.consoleErrors.filter((e) => e.startsWith('Navigation error:'));
    if (navErrors.length > 0) {
      hasNavigationFailures = true;
      addGap({
        id: randomUUID(),
        path: route.path,
        severity: 'high',
        reason: `Navigation failed: ${navErrors.join('; ')}`,
        category: 'console-error',
      });
    } else if (route.consoleErrors.length > 0) {
      addGap({
        id: randomUUID(),
        path: route.path,
        severity: 'high',
        reason: `Console errors detected (${route.consoleErrors.length})`,
        category: 'console-error',
      });
    }

    if (route.brokenLinks.length > 0) {
      addGap({
        id: randomUUID(),
        path: route.path,
        severity: 'medium',
        reason: `Broken or invalid links detected (${route.brokenLinks.length})`,
        category: 'broken-link',
      });
    }

    for (const violation of route.a11yViolations) {
      const impact = violation.impact.toLowerCase();
      const severity: Gap['severity'] =
        impact === 'critical' || impact === 'serious'
          ? 'high'
          : impact === 'moderate'
            ? 'medium'
            : 'low';
      addGap({
        id: randomUUID(),
        path: route.path,
        severity,
        reason: `A11y violation ${violation.id} (${violation.impact}): ${violation.helpUrl}`,
        category: 'a11y',
      });
    }
  }

  const highCount = gaps.filter((g) => g.severity === 'high').length;
  const mediumCount = gaps.filter((g) => g.severity === 'medium').length;
  const lowCount = gaps.filter((g) => g.severity === 'low').length;
  let releaseConfidence = Math.max(0, 100 - highCount * 20 - mediumCount * 8 - lowCount * 3);

  const pagesScanned = routes.routes.length;
  if (pagesScanned < config.minPagesForConfidence) {
    releaseConfidence = Math.min(releaseConfidence, 40);
  }

  let coverageWarning: GapAnalysis['coverageWarning'];
  if (routes.budgetExceeded) {
    coverageWarning = 'budget-exceeded';
  } else if (hasNavigationFailures) {
    coverageWarning = 'navigation-failures';
  } else if (pagesScanned < config.minPagesForConfidence) {
    coverageWarning = 'low-coverage';
  }

  return {
    analyzedAt: new Date().toISOString(),
    mode,
    releaseConfidence,
    coveragePagesScanned: pagesScanned,
    coverageBudgetExceeded: routes.budgetExceeded,
    coverageWarning,
    gaps,
  };
}
