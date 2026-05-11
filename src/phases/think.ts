import type { HarnessConfig } from '../schemas/config.schema.js';
import { GapAnalysisSchema, NeutralScenarioSchema, type GapAnalysis, type NeutralScenario } from '../schemas/gap-analysis.schema.js';
import type { ObserveResult } from './observe.js';
import { analyzeGaps } from '../tools/gap-engine.js';
import { StateManager } from '../harness/state-manager.js';
import { logDecision } from '../harness/decision-logger.js';
import { callLLM, generateScenariosFromTemplate } from '../llm/provider.js';
import { buildGapPrompt } from '../llm/context-builder.js';
import type { RunArtifactsOptions } from '../harness/run-options.js';

export async function think(
  observed: ObserveResult,
  config: HarnessConfig,
  artifacts: RunArtifactsOptions = { writeArtifacts: true }
): Promise<GapAnalysis> {
  const mode = observed.repo ? 'url-repo' : 'url-only';
  const stateManager = new StateManager();
  const logOpts = { persist: artifacts.writeArtifacts, memory: artifacts.decisionMemory };

  const partialAnalysis = GapAnalysisSchema.parse({
    ...analyzeGaps(observed.routes, observed.repo, mode, config),
    scenarios: [],
    generatedTests: [],
  });
  if (artifacts.writeArtifacts) {
    await stateManager.writeState('gap-analysis.json', partialAnalysis, GapAnalysisSchema);
  }

  await logDecision(
    {
      timestamp: new Date().toISOString(),
      phase: 'think',
      decision: 'gap-analysis-complete',
      reason: `Computed ${partialAnalysis.gaps.length} gaps with release confidence ${partialAnalysis.releaseConfidence}`,
      metadata: {
        mode,
        gapCount: partialAnalysis.gaps.length,
        releaseConfidence: partialAnalysis.releaseConfidence,
      },
    },
    logOpts
  );

  let scenarioSource: 'llm' | 'template' = 'template';
  let generatedScenarios: NeutralScenario[] = [];

  if (!process.env.ANTHROPIC_API_KEY) {
    await logDecision(
      {
        timestamp: new Date().toISOString(),
        phase: 'think',
        decision: 'llm-scenarios-skipped',
        reason: 'Skipped LLM scenario generation because ANTHROPIC_API_KEY is not set',
      },
      logOpts
    );
    generatedScenarios = generateScenariosFromTemplate(partialAnalysis.gaps);
  } else {
    try {
      const prompt = buildGapPrompt(partialAnalysis.gaps, config.testGenerationLimit);
      const response = await callLLM(prompt, config.llmTokenBudget);
      const parsed = JSON.parse(response) as unknown;
      const candidates = Array.isArray(parsed) ? parsed : [];

      for (const item of candidates) {
        const validated = NeutralScenarioSchema.safeParse(item);
        if (validated.success) {
          generatedScenarios.push(validated.data);
        }
      }

      if (generatedScenarios.length === 0) {
        generatedScenarios = generateScenariosFromTemplate(partialAnalysis.gaps);
        scenarioSource = 'template';
      } else {
        scenarioSource = 'llm';
      }
    } catch {
      generatedScenarios = generateScenariosFromTemplate(partialAnalysis.gaps);
      scenarioSource = 'template';
    }
  }

  await logDecision(
    {
      timestamp: new Date().toISOString(),
      phase: 'think',
      decision: 'scenario-generation-complete',
      reason: `Generated ${generatedScenarios.length} scenarios via ${scenarioSource}`,
      metadata: {
        source: scenarioSource,
        scenarioCount: generatedScenarios.length,
      },
    },
    logOpts
  );

  const completeAnalysis = GapAnalysisSchema.parse({
    ...partialAnalysis,
    scenarios: generatedScenarios,
    generatedTests: [],
  });
  if (artifacts.writeArtifacts) {
    await stateManager.writeState('gap-analysis.json', completeAnalysis, GapAnalysisSchema);
  }

  return completeAnalysis;
}
