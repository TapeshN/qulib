import { resolveMaxOutputTokensPerLlmCall, type HarnessConfig } from '../schemas/config.schema.js';
import { GapAnalysisSchema, NeutralScenarioSchema, type GapAnalysis, type NeutralScenario } from '../schemas/gap-analysis.schema.js';
import type { LlmUsageRecord } from '../schemas/cost-intelligence.schema.js';
import { StateManager } from '../harness/state-manager.js';
import { logDecision } from '../harness/decision-logger.js';
import { callLLM, generateScenariosFromTemplate } from '../llm/provider.js';
import { buildGapPrompt } from '../llm/context-builder.js';
import { assembleCostIntelligence } from '../llm/cost-intelligence.js';
import { hashForCostIntelligence } from '../llm/content-hash.js';
import type { RunArtifactsOptions } from '../harness/run-options.js';

export type GapAnalysisDraft = Omit<GapAnalysis, 'scenarios' | 'generatedTests' | 'costIntelligence'>;

export async function finalizeGapAnalysisFromDraft(
  draft: GapAnalysisDraft,
  config: HarnessConfig,
  artifacts: RunArtifactsOptions = { writeArtifacts: true },
  costContext?: Pick<GapAnalysis, 'mode' | 'coveragePagesScanned' | 'releaseConfidence' | 'gaps'>
): Promise<GapAnalysis> {
  const stateManager = new StateManager(config.outputDir);
  const logOpts = {
    persist: artifacts.writeArtifacts,
    memory: artifacts.decisionMemory,
    outputDir: config.outputDir,
  };
  const partialAnalysis = GapAnalysisSchema.parse({
    ...draft,
    scenarios: [],
    generatedTests: [],
  });

  let scenarioSource: 'llm' | 'template' = 'template';
  let generatedScenarios: NeutralScenario[] = [];
  const llmRecords: LlmUsageRecord[] = [];
  const maxOut = resolveMaxOutputTokensPerLlmCall(config);

  if (!config.enableLlmScenarios) {
    await logDecision(
      {
        timestamp: new Date().toISOString(),
        phase: 'think',
        decision: 'llm-scenarios-disabled',
        reason: 'enableLlmScenarios is false; using template scenarios only',
      },
      logOpts
    );
    generatedScenarios = generateScenariosFromTemplate(partialAnalysis.gaps);
    llmRecords.push({
      provider: 'none',
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      operationType: 'scenario-generation',
      timestamp: new Date().toISOString(),
      dataQuality: 'none',
      notes: 'No LLM call: enableLlmScenarios is false in harness config.',
    });
  } else if (!process.env.ANTHROPIC_API_KEY) {
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
    llmRecords.push({
      provider: 'none',
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      operationType: 'scenario-generation',
      timestamp: new Date().toISOString(),
      dataQuality: 'none',
      notes: 'No LLM call: ANTHROPIC_API_KEY not set; template scenarios only.',
    });
  } else {
    const prompt = buildGapPrompt(partialAnalysis.gaps, config.testGenerationLimit);
    const promptHash = hashForCostIntelligence(prompt);
    try {
      const llmResult = await callLLM(prompt, maxOut, {
        llmProvider: config.llmProvider,
        llmModel: config.llmModel,
        telemetry: artifacts.telemetry,
        telemetrySessionId: artifacts.telemetrySessionId,
      });
      const resultHash = hashForCostIntelligence(llmResult.text);
      const usage = llmResult.usage;
      llmRecords.push({
        provider: usage?.provider ?? 'unknown',
        model: usage?.model ?? 'unknown',
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        operationType: 'scenario-generation',
        timestamp: new Date().toISOString(),
        promptHash,
        resultHash,
        dataQuality: usage?.dataQuality ?? 'estimated',
        notes:
          usage?.dataQuality === 'estimated'
            ? 'Token counts estimated (API usage block missing).'
            : undefined,
      });
      try {
        // Claude 4 models wrap JSON in markdown fences despite instructions.
        // Strip ```json ... ``` or ``` ... ``` before parsing.
        const rawText = llmResult.text.trim();
        const stripped = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        // Also handle models that embed the array mid-prose — grab first [...] block
        const jsonText = stripped.startsWith('[') ? stripped : (stripped.match(/\[[\s\S]*\]/)?.[0] ?? stripped);
        const parsed = JSON.parse(jsonText) as unknown;
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
          const last = llmRecords[llmRecords.length - 1];
          if (last) {
            last.notes = [last.notes, 'Model returned no valid scenarios; template scenarios used.']
              .filter(Boolean)
              .join(' ');
          }
        } else {
          scenarioSource = 'llm';
        }
      } catch {
        generatedScenarios = generateScenariosFromTemplate(partialAnalysis.gaps);
        scenarioSource = 'template';
        const last = llmRecords[llmRecords.length - 1];
        if (last) {
          last.notes = [last.notes, 'Response was not valid JSON; template scenarios used.']
            .filter(Boolean)
            .join(' ');
        }
      }
    } catch (err) {
      generatedScenarios = generateScenariosFromTemplate(partialAnalysis.gaps);
      scenarioSource = 'template';
      const msg = err instanceof Error ? err.message : String(err);
      llmRecords.push({
        provider: 'unavailable',
        model: 'unknown',
        inputTokens: Math.max(0, Math.ceil(prompt.length / 4)),
        outputTokens: 0,
        operationType: 'scenario-generation',
        timestamp: new Date().toISOString(),
        promptHash,
        dataQuality: 'estimated',
        notes: `LLM call failed; template scenarios used. ${msg.slice(0, 240)}`,
      });
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

  const costPartial = costContext ?? partialAnalysis;
  const costIntelligence = assembleCostIntelligence({
    maxOutputTokensPerLlmCall: maxOut,
    records: llmRecords,
    partial: {
      mode: costPartial.mode,
      coveragePagesScanned: costPartial.coveragePagesScanned,
      releaseConfidence: costPartial.releaseConfidence ?? 0,
      gaps: costPartial.gaps,
    },
    scenarioSource,
    requireHumanReview: config.requireHumanReview,
  });

  const completeAnalysis = GapAnalysisSchema.parse({
    ...partialAnalysis,
    scenarios: generatedScenarios,
    generatedTests: [],
    costIntelligence,
  });
  if (artifacts.writeArtifacts) {
    await stateManager.writeState('gap-analysis.json', completeAnalysis, GapAnalysisSchema);
  }

  return completeAnalysis;
}
