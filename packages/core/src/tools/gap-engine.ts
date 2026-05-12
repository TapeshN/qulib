import { randomUUID } from 'node:crypto';
import { GapSchema, type GapAnalysis, type Gap } from '../schemas/gap-analysis.schema.js';
import type { RouteInventory } from '../schemas/route-inventory.schema.js';
import type { RepoAnalysis } from '../schemas/repo-analysis.schema.js';
import type { HarnessConfig } from '../schemas/config.schema.js';

export function computeQualityScoreFromGaps(gaps: Gap[]): number {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const g of gaps) {
    if (g.severity === 'critical') critical++;
    else if (g.severity === 'high') high++;
    else if (g.severity === 'medium') medium++;
    else low++;
  }
  return Math.max(0, 100 - critical * 25 - high * 20 - medium * 8 - low * 3);
}

export function computeCoverageScore(routes: RouteInventory): number | null {
  const scanned = routes.routes.length;
  const skipped = routes.pagesSkipped;
  const denom = scanned + skipped;
  // TODO: return null here once the explorer exposes an explicit "discovered-but-unknown" signal
  //       (i.e. routes were found but the full set couldn't be confirmed — a low score is misleading)
  if (denom === 0) {
    if (routes.budgetExceeded) {
      return 0;
    }
    return scanned === 0 ? 0 : 100;
  }
  return Math.round((100 * scanned) / denom);
}

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
        impact === 'critical'
          ? 'critical'
          : impact === 'serious'
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

  const releaseConfidence = computeQualityScoreFromGaps(gaps);

  const pagesScanned = routes.routes.length;
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
