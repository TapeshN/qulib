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

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  call(prompt: string, maxOutputTokens: number): Promise<LlmCallResult>;
}
