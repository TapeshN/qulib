export interface LlmCallResult {
  text: string;
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    dataQuality: 'actual' | 'estimated';
  };
}

export interface LlmCallOptions {
  temperature?: number;
  /**
   * Fixed system-role instructions (e.g. a judge rubric). Architecturally
   * separated from the user turn so untrusted user content cannot override it —
   * the standard prompt-injection defense-in-depth for LLM-as-judge tools.
   */
  system?: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  call(prompt: string, maxOutputTokens: number, options?: LlmCallOptions): Promise<LlmCallResult>;
}
