import { randomUUID } from 'node:crypto';
import { NeutralScenarioSchema, type Gap, type NeutralScenario } from '../schemas/gap-analysis.schema.js';
import type { HarnessConfig } from '../schemas/config.schema.js';
import type { LlmCallResult } from './provider.interface.js';
import { createProvider } from './provider-registry.js';

export type { LlmCallResult } from './provider.interface.js';
export type { LlmProvider } from './provider.interface.js';

export type CallLlmConfigSlice = Pick<HarnessConfig, 'llmProvider' | 'llmModel'> & {
  telemetry?: import('../telemetry/telemetry.interface.js').TelemetrySink;
  telemetrySessionId?: string;
};

export async function callLLM(
  prompt: string,
  tokenBudget: number,
  harness?: CallLlmConfigSlice
): Promise<LlmCallResult> {
  return createProvider({
    llmProvider: harness?.llmProvider,
    llmModel: harness?.llmModel,
    telemetry: harness?.telemetry,
    telemetrySessionId: harness?.telemetrySessionId,
  }).call(prompt, tokenBudget);
}

export function generateScenariosFromTemplate(gaps: Gap[]): NeutralScenario[] {
  return gaps.map((gap) => {
    const steps = [];
    steps.push({ action: 'navigate' as const, target: gap.path, description: `Navigate to ${gap.path}` });

    if (gap.category === 'untested-route') {
      steps.push({ action: 'assert-visible' as const, description: 'Assert page loaded successfully' });
    } else if (gap.category === 'console-error') {
      steps.push({ action: 'assert-hidden' as const, description: 'Assert no console errors are present' });
    } else if (gap.category === 'a11y') {
      steps.push({ action: 'assert-visible' as const, description: 'Run accessibility scan on page' });
    } else if (gap.category === 'broken-link') {
      steps.push({ action: 'assert-visible' as const, description: 'Assert all links resolve correctly' });
    } else if (gap.category === 'auth-surface') {
      steps.push({
        action: 'assert-visible' as const,
        description: 'Verify sign-in surface accessibility and SSO affordances',
      });
    } else if (gap.category === 'coverage') {
      steps.push({
        action: 'assert-visible' as const,
        description: 'Resolve authentication and re-run full deployment scan',
      });
    }

    const adapter =
      gap.category === 'a11y' || gap.category === 'auth-surface' ? 'accessibility' : 'playwright';

    return NeutralScenarioSchema.parse({
      id: randomUUID(),
      title: `[${gap.severity.toUpperCase()}] ${gap.category} — ${gap.path}`,
      description: gap.reason,
      targetPath: gap.path,
      steps,
      tags: [gap.category, gap.severity],
      recommendations: [{ adapter, reason: 'Generated from template', confidence: 'low' }],
      sourceGapIds: [gap.id],
    });
  });
}
