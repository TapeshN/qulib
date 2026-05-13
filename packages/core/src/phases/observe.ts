import type { HarnessConfig } from '../schemas/config.schema.js';
import { RouteInventorySchema, type RouteInventory } from '../schemas/route-inventory.schema.js';
import { RepoAnalysisSchema, type RepoAnalysis } from '../schemas/repo-analysis.schema.js';
import { createExplorer } from '../tools/explorer-factory.js';
import { scanRepo } from '../tools/repo-scanner.js';
import { StateManager } from '../harness/state-manager.js';
import { logDecision } from '../harness/decision-logger.js';
import type { RunArtifactsOptions } from '../harness/run-options.js';
import { emitTelemetry, redactUrlForTelemetry } from '../telemetry/emit.js';

export interface ObserveResult {
  routes: RouteInventory;
  repo: RepoAnalysis | null;
}

export async function observe(
  baseUrl: string,
  repoPath: string | undefined,
  config: HarnessConfig,
  artifacts: RunArtifactsOptions = { writeArtifacts: true }
): Promise<ObserveResult> {
  const sessionId = artifacts.telemetrySessionId ?? 'none';
  const explorer = createExplorer(config.explorer);
  const stateManager = new StateManager(config.outputDir);
  const logOpts = {
    persist: artifacts.writeArtifacts,
    memory: artifacts.decisionMemory,
    outputDir: config.outputDir,
  };

  emitTelemetry(artifacts.telemetry, 'phase.observe.started', sessionId, {
    baseUrl: redactUrlForTelemetry(baseUrl),
    hasRepoPath: Boolean(repoPath),
  });

  const rawRoutes = await explorer.explore(baseUrl, config, artifacts);
  const routes = RouteInventorySchema.parse(rawRoutes);
  if (artifacts.writeArtifacts) {
    await stateManager.writeState('discovered-routes.json', routes, RouteInventorySchema);
  }

  await logDecision(
    {
      timestamp: new Date().toISOString(),
      phase: 'observe',
      decision: 'exploration-complete',
      reason: `Discovered ${routes.routes.length} routes; budgetExceeded=${routes.budgetExceeded}`,
      metadata: {
        baseUrl: redactUrlForTelemetry(baseUrl),
        scannedRoutes: routes.routes.length,
        budgetExceeded: routes.budgetExceeded,
        pagesSkipped: routes.pagesSkipped,
      },
    },
    logOpts
  );

  let repo: RepoAnalysis | null = null;
  if (repoPath) {
    const rawRepo = await scanRepo(repoPath);
    repo = RepoAnalysisSchema.parse(rawRepo);
    emitTelemetry(artifacts.telemetry, 'repo.scanned', sessionId, {
      routeCount: repo.routes.length,
      testFileCount: repo.testFiles.length,
    });
    if (artifacts.writeArtifacts) {
      await stateManager.writeState('repo-inventory.json', repo, RepoAnalysisSchema);
    }

    await logDecision(
      {
        timestamp: new Date().toISOString(),
        phase: 'observe',
        decision: 'repo-scan-complete',
        reason: `Scanned repo inventory: ${repo.routes.length} routes, ${repo.testFiles.length} test files`,
        metadata: {
          repoPath,
          routeCount: repo.routes.length,
          testFileCount: repo.testFiles.length,
        },
      },
      logOpts
    );
  }

  emitTelemetry(artifacts.telemetry, 'phase.observe.completed', sessionId, {
    routeCount: routes.routes.length,
    repoScanned: Boolean(repo),
  });

  return { routes, repo };
}
