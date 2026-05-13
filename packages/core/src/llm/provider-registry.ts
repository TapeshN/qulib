import type { HarnessConfig } from '../schemas/config.schema.js';
import type { LlmProvider } from './provider.interface.js';
import type { TelemetrySink } from '../telemetry/telemetry.interface.js';
import { AnthropicProvider } from './providers/anthropic.js';

export type CreateProviderInput = Pick<HarnessConfig, 'llmProvider' | 'llmModel'> & {
  telemetry?: TelemetrySink;
  telemetrySessionId?: string;
};

// TODO(@qulib/cost-intelligence): When OpenAI or Vertex provider types are added,
// LlmUsageRecord.estimatedCostUsd must be populated from provider-specific pricing tables.
// The cost-intelligence schema already supports this field — it is currently unused.

export function createProvider(config: CreateProviderInput = {}): LlmProvider {
  const provider = config.llmProvider ?? 'anthropic';
  if (provider === 'anthropic') {
    return new AnthropicProvider({
      model: config.llmModel,
      telemetry: config.telemetry,
      sessionId: config.telemetrySessionId,
    });
  }
  throw new Error(`Unsupported llmProvider: ${String(provider)}`);
}
