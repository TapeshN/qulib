#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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

const server = new Server(
  {
    name: 'qulib-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'explore_auth',
      description:
        'Use this BEFORE analyze_app when scanning unfamiliar apps. Returns all detected sign-in paths with per-path requirements describing what credentials or actions the agent must collect from the user before calling analyze_app. Combines built-in OAuth/SSO labels, user-local patterns from ~/.qulib/providers.json, and heuristic unknown buttons.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL of the deployed app or login page' },
          timeoutMs: { type: 'number', description: 'Navigation timeout in milliseconds (default 20000)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'analyze_app',
      description:
        'Analyze a deployed web app for quality gaps. Default response is summary-first (top gaps, cost summary, next checks). Set includeFullReport for the full gapAnalysis. Optional llmMaxOutputTokensPerCall / llmTokenBudget (legacy), testGenerationLimit, enableLlmScenarios align with @qulib/core HarnessConfig.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL of the deployed app' },
          maxPagesToScan: { type: 'number', description: 'Max pages to crawl (default 10)' },
          timeoutMs: { type: 'number', description: 'Per-page timeout in milliseconds (default 30000)' },
          auth: {
            description: 'Optional auth: form-login credentials or path to a storage state JSON from `qulib auth init`',
            oneOf: [
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['form-login'] },
                  loginUrl: { type: 'string' },
                  username: { type: 'string' },
                  password: { type: 'string' },
                  usernameSelector: { type: 'string' },
                  passwordSelector: { type: 'string' },
                  submitSelector: { type: 'string' },
                  successUrlContains: { type: 'string' },
                },
                required: [
                  'type',
                  'loginUrl',
                  'username',
                  'password',
                  'usernameSelector',
                  'passwordSelector',
                  'submitSelector',
                ],
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['storage-state'] },
                  path: { type: 'string', description: 'Absolute path to storage state JSON on the MCP host' },
                },
                required: ['type', 'path'],
              },
            ],
          },
          includeFullReport: {
            type: 'boolean',
            description:
              'When true, returns the full analyzeApp payload including all scenarios. Default false returns a summary-first shape.',
          },
          llmTokenBudget: {
            type: 'number',
            description:
              'Legacy per-completion max output tokens (same as HarnessConfig.llmTokenBudget). Prefer llmMaxOutputTokensPerCall when both are set.',
          },
          llmMaxOutputTokensPerCall: {
            type: 'number',
            description:
              'Optional override for per-completion max output tokens (maps to HarnessConfig.llmMaxOutputTokensPerCall).',
          },
          testGenerationLimit: { type: 'number', description: 'Max gaps fed into scenario generation (default 5).' },
          enableLlmScenarios: {
            type: 'boolean',
            description: 'When false, never calls an LLM for scenarios (default true when omitted).',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'detect_auth',
      description:
        'Detect the authentication pattern used by a deployed web app. Returns the auth type (form-login, oauth, magic-link, none, or unknown) and a recommendation for how to configure qulib to scan past it.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL of the deployed app or login page' },
          timeoutMs: { type: 'number', description: 'Page load timeout in milliseconds (default 15000)' },
        },
        required: ['url'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'explore_auth') {
    const { url, timeoutMs } = z
      .object({
        url: z.string().url(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .parse(request.params.arguments ?? {});

    log.info(`explore_auth tool url=${url} timeoutMs=${timeoutMs ?? 20000}`);
    const result = await exploreAuth(url, timeoutMs, mcpProgressLog);
    log.info(`explore_auth tool done authRequired=${result.authRequired} paths=${result.authPaths.length}`);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  if (request.params.name === 'detect_auth') {
    const { url, timeoutMs } = z
      .object({
        url: z.string().url(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .parse(request.params.arguments ?? {});

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

  if (request.params.name !== 'analyze_app') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const input = AnalyzeInputSchema.parse(request.params.arguments ?? {});

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
await server.connect(transport);
