import type { HarnessConfig } from '../schemas/config.schema.js';
import { GapAnalysisSchema, type GapAnalysis } from '../schemas/gap-analysis.schema.js';
import type { ObserveResult } from './observe.js';
import { analyzeGaps } from '../tools/scoring/gap-engine.js';
import { logDecision } from '../harness/decision-logger.js';
import type { RunArtifactsOptions } from '../harness/run-options.js';
import { finalizeGapAnalysisFromDraft } from './think-finalize.js';
import { emitTelemetry } from '../telemetry/emit.js';

export async function think(
  observed: ObserveResult,
  config: HarnessConfig,
  artifacts: RunArtifactsOptions = { writeArtifacts: true }
): Promise<GapAnalysis> {
  const sessionId = artifacts.telemetrySessionId ?? 'none';
  const mode = observed.repo ? 'url-repo' : 'url-only';
  const logOpts = {
    persist: artifacts.writeArtifacts,
    memory: artifacts.decisionMemory,
    outputDir: config.outputDir,
  };

  emitTelemetry(artifacts.telemetry, 'phase.think.started', sessionId, { mode });

  const gapBlock = analyzeGaps(observed.routes, observed.repo, mode, config);
  const draft = {
    analyzedAt: gapBlock.analyzedAt,
    mode: gapBlock.mode,
    releaseConfidence: gapBlock.releaseConfidence,
    coveragePagesScanned: gapBlock.coveragePagesScanned,
    coverageBudgetExceeded: gapBlock.coverageBudgetExceeded,
    coverageWarning: gapBlock.coverageWarning,
    gaps: gapBlock.gaps,
  };

  const partialAnalysis = GapAnalysisSchema.parse({
    ...draft,
    scenarios: [],
    generatedTests: [],
  });

  await logDecision(
    {
      timestamp: new Date().toISOString(),
      phase: 'think',
      decision: 'gap-analysis-complete',
      reason: `Computed ${partialAnalysis.gaps.length} gaps with release confidence ${String(partialAnalysis.releaseConfidence)}`,
      metadata: {
        mode,
        gapCount: partialAnalysis.gaps.length,
        releaseConfidence: partialAnalysis.releaseConfidence,
      },
    },
    logOpts
  );

  const finalized = await finalizeGapAnalysisFromDraft(draft, config, artifacts);

  emitTelemetry(artifacts.telemetry, 'phase.think.completed', sessionId, {
    gapCount: finalized.gaps.length,
    mode: finalized.mode,
  });

  return finalized;
}

export { finalizeGapAnalysisFromDraft } from './think-finalize.js';
export type { GapAnalysisDraft } from './think-finalize.js';
