import type { HarnessConfig, DetectedAuth } from './schemas/config.schema.js';
import { GapAnalysisSchema, type GapAnalysis } from './schemas/gap-analysis.schema.js';
import type { RouteInventory } from './schemas/route-inventory.schema.js';
import type { RepoAnalysis } from './schemas/repo-analysis.schema.js';
import type { DecisionLogEntry } from './schemas/decision-log.schema.js';
import { observe } from './phases/observe.js';
import { think } from './phases/think.js';
import { act } from './phases/act.js';
import { detectAuth } from './tools/auth-detector.js';

export interface AnalyzeOptions {
  url: string;
  repoPath?: string;
  config: HarnessConfig;
  writeArtifacts?: boolean;
  skipAuthDetection?: boolean;
}

export interface AnalyzeResult {
  releaseConfidence: number;
  gapAnalysis: GapAnalysis;
  routeInventory: RouteInventory;
  repoInventory: RepoAnalysis | null;
  decisionLog: DecisionLogEntry[];
  detectedAuth?: DetectedAuth;
}

export async function analyzeApp(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const writeArtifacts = options.writeArtifacts ?? false;
  const decisionLog: DecisionLogEntry[] = [];
  const artifacts = {
    writeArtifacts,
    decisionMemory: decisionLog,
  };

  if (!options.config.auth && !options.skipAuthDetection) {
    const detection = await detectAuth(options.url, options.config.timeoutMs);
    if (detection.hasAuth) {
      const gapAnalysis = GapAnalysisSchema.parse({
        analyzedAt: new Date().toISOString(),
        mode: 'auth-required' as const,
        releaseConfidence: 0,
        coveragePagesScanned: 0,
        coverageBudgetExceeded: false,
        coverageWarning: 'auth-required' as const,
        gaps: [],
        scenarios: [],
        generatedTests: [],
      });
      return {
        releaseConfidence: 0,
        gapAnalysis,
        routeInventory: {
          scannedAt: new Date().toISOString(),
          baseUrl: options.url,
          routes: [],
          pagesSkipped: 0,
          budgetExceeded: false,
        },
        repoInventory: null,
        decisionLog: [
          {
            timestamp: new Date().toISOString(),
            phase: 'observe' as const,
            decision: 'auth-required',
            reason: detection.recommendation,
            metadata: { detection },
          },
        ],
        detectedAuth: detection,
      };
    }
  }

  const observed = await observe(options.url, options.repoPath, options.config, artifacts);
  const analysis = await think(observed, options.config, artifacts);
  await act(analysis, options.config, artifacts);

  return {
    releaseConfidence: analysis.releaseConfidence,
    gapAnalysis: analysis,
    routeInventory: observed.routes,
    repoInventory: observed.repo,
    decisionLog,
  };
}
