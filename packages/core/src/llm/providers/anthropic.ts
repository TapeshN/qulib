import type { LlmCallResult, LlmProvider } from '../provider.interface.js';
import type { TelemetrySink } from '../../telemetry/telemetry.interface.js';
import { emitTelemetry } from '../../telemetry/emit.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

export type AnthropicProviderOptions = {
  model?: string;
  telemetry?: TelemetrySink;
  sessionId?: string;
};

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly telemetry?: TelemetrySink;
  private readonly sessionId: string;

  constructor(options?: AnthropicProviderOptions) {
    this.model = options?.model ?? DEFAULT_MODEL;
    this.telemetry = options?.telemetry;
    this.sessionId = options?.sessionId ?? 'anonymous';
  }

  async call(prompt: string, maxOutputTokens: number): Promise<LlmCallResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

    const started = Date.now();
    emitTelemetry(this.telemetry, 'llm.call.started', this.sessionId, {
      model: this.model,
      promptLength: prompt.length,
      provider: this.name,
    });

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxOutputTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        emitTelemetry(this.telemetry, 'llm.call.failed', this.sessionId, {
          model: this.model,
          error: `${response.status} ${errBody.slice(0, 500)}`,
          provider: this.name,
        });
        throw new Error(`LLM call failed: ${response.status} ${errBody}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      };
      const text = data.content.find((b) => b.type === 'text')?.text ?? '';
      const inTok = data.usage?.input_tokens;
      const outTok = data.usage?.output_tokens;
      const durationMs = Date.now() - started;

      let result: LlmCallResult;
      if (typeof inTok === 'number' && typeof outTok === 'number') {
        result = {
          text,
          usage: {
            provider: this.name,
            model: data.model ?? this.model,
            inputTokens: inTok,
            outputTokens: outTok,
            dataQuality: 'actual',
          },
        };
      } else {
        const inputTokens = estimateTokensFromChars(prompt.length);
        const outputTokens = estimateTokensFromChars(text.length);
        result = {
          text,
          usage: {
            provider: this.name,
            model: data.model ?? this.model,
            inputTokens,
            outputTokens,
            dataQuality: 'estimated',
          },
        };
      }

      const u = result.usage;
      emitTelemetry(this.telemetry, 'llm.call.completed', this.sessionId, {
        model: this.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        durationMs,
        provider: this.name,
      });
      return result;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('LLM call failed:')) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      emitTelemetry(this.telemetry, 'llm.call.failed', this.sessionId, {
        model: this.model,
        error: msg.slice(0, 500),
        provider: this.name,
      });
      throw err;
    }
  }
}
