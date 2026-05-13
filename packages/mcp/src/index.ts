#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { analyzeApp, detectAuth, exploreAuth } from '@qulib/core';
import type { HarnessConfig, AnalyzeProgressSink } from '@qulib/core';
import { z } from 'zod';
import { buildCompactAnalyzePayload } from './compact-analyze-payload.js';
import { log } from './logger.js';

const mcpProgressLog: AnalyzeProgressSink = {
  info: (message: string) => log.info(message),
  warn: (message: string) => log.warn(message),
  error: (message: string) => log.error(message),
  debug: (message: string) => log.debug(message),
};

const FormLoginMcpAuthSchema = z.object({
  type: z.literal('form-login'),
  loginUrl: z.string().url(),
  username: z.string(),
  password: z.string(),
  usernameSelector: z.string(),
  passwordSelector: z.string(),
  submitSelector: z.string(),
  successUrlContains: z.string().optional(),
});

const StorageStateMcpAuthSchema = z.object({
  type: z.literal('storage-state'),
  path: z.string().min(1),
});

const AnalyzeInputSchema = z.object({
  url: z.string().url(),
  maxPagesToScan: z.number().int().min(1).max(50).optional(),
  timeoutMs: z.number().int().positive().optional(),
  auth: z.discriminatedUnion('type', [FormLoginMcpAuthSchema, StorageStateMcpAuthSchema]).optional(),
  includeFullReport: z.boolean().optional(),
  llmTokenBudget: z.number().int().positive().optional(),
  llmMaxOutputTokensPerCall: z.number().int().positive().optional(),
  testGenerationLimit: z.number().int().positive().max(50).optional(),
  enableLlmScenarios: z.boolean().optional(),
});

const mcpServer = new McpServer(
  {
    name: 'qulib-mcp',
    version: '0.3.1',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

if (!process.env.ANTHROPIC_API_KEY) {
  process.stderr.write(
    '[qulib] WARN  ANTHROPIC_API_KEY is not set.\n' +
      '              LLM scenario generation will be skipped — only template scenarios will run.\n' +
      '              Add your key to the env block in your MCP host config.\n' +
      '              See: https://github.com/TapeshN/qulib#setup\n'
  );
}

const ExploreAuthToolInputSchema = z.object({
  url: z.string().url().describe('Full URL of the deployed app or login page'),
  timeoutMs: z.number().int().positive().optional().describe('Navigation timeout in milliseconds (default 20000)'),
});

const DetectAuthToolInputSchema = z.object({
  url: z.string().url().describe('Full URL of the deployed app or login page'),
  timeoutMs: z.number().int().positive().optional().describe('Page load timeout in milliseconds (default 15000)'),
});

mcpServer.registerTool(
  'explore_auth',
  {
    description:
      'Use this BEFORE analyze_app when scanning unfamiliar apps. Returns all detected sign-in paths with per-path requirements describing what credentials or actions the agent must collect from the user before calling analyze_app. Combines built-in OAuth/SSO labels, user-local patterns from ~/.qulib/providers.json, and heuristic unknown buttons.',
    inputSchema: ExploreAuthToolInputSchema,
  },
  async ({ url, timeoutMs }) => {
    log.info(`explore_auth tool url=${url} timeoutMs=${timeoutMs ?? 20000}`);
    const result = await exploreAuth(url, timeoutMs, mcpProgressLog);
    log.info(`explore_auth tool done authRequired=${result.authRequired} paths=${result.authPaths.length}`);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

mcpServer.registerTool(
  'detect_auth',
  {
    description:
      'Detect the authentication pattern used by a deployed web app. Returns the auth type (form-login, oauth, magic-link, none, or unknown) and a recommendation for how to configure qulib to scan past it.',
    inputSchema: DetectAuthToolInputSchema,
  },
  async ({ url, timeoutMs }) => {
    log.info(`detect_auth tool url=${url} timeoutMs=${timeoutMs ?? 15000}`);
    const result = await detectAuth(url, timeoutMs, mcpProgressLog);
    const providerSummary =
      result.oauthButtons.length > 0
        ? result.oauthButtons.map((b) => b.provider).join(', ')
        : result.provider ?? 'none';
    log.info(
      `detect_auth tool done type=${result.type} providers=${providerSummary} automatable=${result.type === 'form-login'}`
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

mcpServer.registerTool(
  'analyze_app',
  {
    description:
      'Analyze a deployed web app for quality gaps. Default response is summary-first (top gaps, cost summary, next checks). Set includeFullReport for the full gapAnalysis. Optional llmMaxOutputTokensPerCall / llmTokenBudget (legacy), testGenerationLimit, enableLlmScenarios align with @qulib/core HarnessConfig.',
    inputSchema: AnalyzeInputSchema,
  },
  async (input) => {
    const successIndicator =
      input.auth?.type === 'form-login' &&
      input.auth.successUrlContains !== undefined &&
      input.auth.successUrlContains !== ''
        ? { urlContains: input.auth.successUrlContains }
        : {};

    const authConfig =
      input.auth?.type === 'form-login'
        ? {
            type: 'form-login' as const,
            loginUrl: input.auth.loginUrl,
            credentials: { username: input.auth.username, password: input.auth.password },
            selectors: {
              username: input.auth.usernameSelector,
              password: input.auth.passwordSelector,
              submit: input.auth.submitSelector,
            },
            successIndicator,
          }
        : input.auth?.type === 'storage-state'
          ? { type: 'storage-state' as const, path: input.auth.path }
          : undefined;

    const harnessConfig: HarnessConfig = {
      maxPagesToScan: input.maxPagesToScan ?? 10,
      maxDepth: 3,
      minPagesForConfidence: 3,
      timeoutMs: input.timeoutMs ?? 30000,
      retryCount: 0,
      llmTokenBudget: input.llmTokenBudget ?? input.llmMaxOutputTokensPerCall ?? 4096,
      llmMaxOutputTokensPerCall: input.llmMaxOutputTokensPerCall,
      testGenerationLimit: input.testGenerationLimit ?? 5,
      enableLlmScenarios: input.enableLlmScenarios !== false,
      readOnlyMode: true,
      requireHumanReview: false,
      failOnConsoleError: false,
      explorer: 'playwright',
      defaultAdapter: 'playwright',
      adapters: ['playwright'],
      ...(authConfig && { auth: authConfig }),
    };

    const result = await analyzeApp({
      url: input.url,
      writeArtifacts: false,
      config: harnessConfig,
      progressLog: mcpProgressLog,
    });

    const payload = buildCompactAnalyzePayload(result, input.includeFullReport === true);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  });

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
