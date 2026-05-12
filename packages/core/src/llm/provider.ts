import { randomUUID } from 'node:crypto';
import { NeutralScenarioSchema, type Gap, type NeutralScenario } from '../schemas/gap-analysis.schema.js';

export interface LlmCallResult {
  text: string;
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    dataQuality: 'actual' | 'estimated';
  } | null;
}

function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

export async function callLLM(prompt: string, tokenBudget: number): Promise<LlmCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const model = 'claude-sonnet-4-20250514';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: tokenBudget,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM call failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  const text = data.content.find((b) => b.type === 'text')?.text ?? '';
  const inTok = data.usage?.input_tokens;
  const outTok = data.usage?.output_tokens;
  if (typeof inTok === 'number' && typeof outTok === 'number') {
    return {
      text,
      usage: {
        provider: 'anthropic',
        model: data.model ?? model,
        inputTokens: inTok,
        outputTokens: outTok,
        dataQuality: 'actual',
      },
    };
  }

  return {
    text,
    usage: {
      provider: 'anthropic',
      model: data.model ?? model,
      inputTokens: estimateTokensFromChars(prompt.length),
      outputTokens: estimateTokensFromChars(text.length),
      dataQuality: 'estimated',
    },
  };
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
    }

    const adapter = gap.category === 'a11y' ? 'accessibility' : 'playwright';

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
