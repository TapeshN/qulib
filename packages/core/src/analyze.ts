import type { HarnessConfig } from './schemas/config.schema.js';
import type { GapAnalysis } from './schemas/gap-analysis.schema.js';
import type { RouteInventory } from './schemas/route-inventory.schema.js';
import type { RepoAnalysis } from './schemas/repo-analysis.schema.js';
import type { DecisionLogEntry } from './schemas/decision-log.schema.js';
import { observe } from './phases/observe.js';
import { think } from './phases/think.js';
import { act } from './phases/act.js';

export interface AnalyzeOptions {
  url: string;
  repoPath?: string;
  config: HarnessConfig;
  writeArtifacts?: boolean;
}

export interface AnalyzeResult {
  releaseConfidence: number;
  gapAnalysis: GapAnalysis;
  routeInventory: RouteInventory;
  repoInventory: RepoAnalysis | null;
  decisionLog: DecisionLogEntry[];
}

export async function analyzeApp(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const writeArtifacts = options.writeArtifacts ?? false;
  const decisionLog: DecisionLogEntry[] = [];
  const artifacts = {
    writeArtifacts,
    decisionMemory: decisionLog,
  };

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
