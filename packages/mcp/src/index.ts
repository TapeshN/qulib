#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { analyzeApp, detectAuth, exploreAuth } from '@qulib/core';
import type { AnalyzeResult } from '@qulib/core';
import { z } from 'zod';

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
});

function compactAnalyzeAppResponse(result: AnalyzeResult, includeFullReport: boolean) {
  if (includeFullReport) {
    return result;
  }
  const g = result.gapAnalysis;
  return {
    summary: {
      releaseConfidence: g.releaseConfidence,
      mode: g.mode,
      coveragePagesScanned: g.coveragePagesScanned,
      coverageBudgetExceeded: g.coverageBudgetExceeded,
      coverageWarning: g.coverageWarning ?? null,
      gapCount: g.gaps.length,
      scenarioCount: g.scenarios.length,
      generatedTestCount: g.generatedTests.length,
    },
    gapAnalysisPreview: {
      analyzedAt: g.analyzedAt,
      releaseConfidence: g.releaseConfidence,
      gapsSample: g.gaps.slice(0, 8),
      scenariosOmitted: g.scenarios.length,
      generatedTestsOmitted: g.generatedTests.length,
      costIntelligence: g.costIntelligence ?? null,
    },
    routeInventorySummary: {
      scannedAt: result.routeInventory.scannedAt,
      baseUrl: result.routeInventory.baseUrl,
      routeCount: result.routeInventory.routes.length,
      pagesSkipped: result.routeInventory.pagesSkipped,
      budgetExceeded: result.routeInventory.budgetExceeded,
    },
    repoInventory: result.repoInventory,
    decisionLogPreview: result.decisionLog.slice(-8),
    ...(result.detectedAuth !== undefined && { detectedAuth: result.detectedAuth }),
    includeFullReport: false,
    note: 'Default payload omits gapAnalysis.scenarios and gapAnalysis.generatedTests. Pass includeFullReport: true for the complete analyzeApp result.',
  };
}

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
        'Analyze a deployed web app for quality gaps. Returns a release confidence score (0-100), accessibility violations, broken links, and prioritized risks. Supports optional form-login or storage-state (Playwright) authentication. By default the response is summary-first (truncated gaps list, scenarios omitted); set includeFullReport to true for the full gapAnalysis payload.',
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
              'When true, returns the full analyzeApp payload including all scenarios. Default false returns a summary-first shape to keep MCP responses compact.',
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

    const result = await exploreAuth(url, timeoutMs);
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

    const result = await detectAuth(url, timeoutMs);
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

  const result = await analyzeApp({
    url: input.url,
    writeArtifacts: false,
    config: {
      maxPagesToScan: input.maxPagesToScan ?? 10,
      maxDepth: 3,
      minPagesForConfidence: 3,
      timeoutMs: input.timeoutMs ?? 30000,
      retryCount: 0,
      llmTokenBudget: 1,
      testGenerationLimit: 1,
      readOnlyMode: true,
      requireHumanReview: false,
      failOnConsoleError: false,
      explorer: 'playwright',
      defaultAdapter: 'playwright',
      adapters: ['playwright'],
      ...(authConfig && { auth: authConfig }),
    },
  });

  const payload = compactAnalyzeAppResponse(result, input.includeFullReport === true);

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
