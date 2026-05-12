#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { analyzeApp, detectAuth } from '@qulib/core';
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
      name: 'analyze_app',
      description:
        'Analyze a deployed web app for quality gaps. Returns a release confidence score (0-100), accessibility violations, broken links, and prioritized risks. Supports optional form-login or storage-state (Playwright) authentication.',
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

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
