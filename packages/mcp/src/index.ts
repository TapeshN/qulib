#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { analyzeApp } from '@qulib/core';
import { z } from 'zod';

const AnalyzeInputSchema = z.object({
  url: z.string().url(),
  maxPagesToScan: z.number().int().min(1).max(50).optional(),
  timeoutMs: z.number().int().positive().optional(),
  auth: z
    .object({
      type: z.literal('form-login'),
      loginUrl: z.string().url(),
      username: z.string(),
      password: z.string(),
      usernameSelector: z.string(),
      passwordSelector: z.string(),
      submitSelector: z.string(),
      successUrlContains: z.string().optional(),
    })
    .optional(),
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
        'Analyze a deployed web app for quality gaps. Returns a release confidence score (0-100), accessibility violations, broken links, and prioritized risks. Supports optional form-login authentication.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL of the deployed app' },
          maxPagesToScan: { type: 'number', description: 'Max pages to crawl (default 10)' },
          timeoutMs: { type: 'number', description: 'Per-page timeout in milliseconds (default 30000)' },
          auth: {
            type: 'object',
            description: 'Optional form-login auth',
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
        },
        required: ['url'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'analyze_app') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const input = AnalyzeInputSchema.parse(request.params.arguments ?? {});

  const successIndicator =
    input.auth?.successUrlContains !== undefined && input.auth.successUrlContains !== ''
      ? { urlContains: input.auth.successUrlContains }
      : {};

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
      ...(input.auth && {
        auth: {
          type: 'form-login' as const,
          loginUrl: input.auth.loginUrl,
          credentials: { username: input.auth.username, password: input.auth.password },
          selectors: {
            username: input.auth.usernameSelector,
            password: input.auth.passwordSelector,
            submit: input.auth.submitSelector,
          },
          successIndicator,
        },
      }),
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
