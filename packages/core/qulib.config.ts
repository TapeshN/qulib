import type { HarnessConfig } from './src/schemas/config.schema.js';

const config: HarnessConfig = {
  maxPagesToScan: 20,
  maxDepth: 3,
  minPagesForConfidence: 3,
  timeoutMs: 30000,
  retryCount: 2,
  llmTokenBudget: 4000,
  llmMaxOutputTokensPerCall: 8192,
  // enableLlmScenarios: true, // set to true + add ANTHROPIC_API_KEY to enable LLM scenarios
  // llmModel: 'claude-sonnet-4-5-20250929', // override the provider default — see available models in your Anthropic console
  testGenerationLimit: 10,
  readOnlyMode: true,
  requireHumanReview: true,
  failOnConsoleError: false,
  explorer: 'playwright',
  defaultAdapter: 'playwright',
  adapters: ['playwright', 'cypress-e2e'],
  // Example: scan authenticated pages on notquality.com
  // auth: {
  //   type: 'form-login',
  //   loginUrl: 'https://notquality.com/login',
  //   credentials: {
  //     username: 'legacy.user@notquality.com',
  //     password: 'Test123!',
  //   },
  //   selectors: {
  //     username: '[data-testid="login-email"]',
  //     password: '[data-testid="login-password"]',
  //     submit: '[data-testid="login-submit"]',
  //   },
  //   successIndicator: {
  //     urlContains: '/playgrounds/',
  //   },
  // },
};

export default config;
