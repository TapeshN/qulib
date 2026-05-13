#!/usr/bin/env node
// Naming convention: qulib_{verb}_{noun}. Existing 3 tools predate this convention and retain their names for backwards compatibility.
//
// TODO(@qulib/mcp): When tool count exceeds ~10, evaluate MCP resource types and
// prompt templates as complementary surfaces. Tool explosion is an MCP anti-pattern.
// Prefer composable tools over one-tool-per-capability.
//
// TODO(@qulib/mcp): Evaluate tool-level permission modeling when MCP spec stabilizes.
// Today: all tools are equally trusted. Future: read-only tools (detect_auth, explore_auth)
// vs. write-capable tools (analyze_app with writeArtifacts) should carry different trust levels.

import { createRequire } from 'node:module';
import { isAbsolute, normalize, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const requirePkg = createRequire(import.meta.url);
const pkg = requirePkg('../package.json') as { version: string };
import {
  analyzeApp,
  detectAuth,
  exploreAuth,
  scanRepo,
  computeAutomationMaturity,
} from '@qulib/core';
import type { HarnessConfig, AnalyzeProgressSink, TelemetrySink } from '@qulib/core';
import { z } from 'zod';
import { buildCompactAnalyzePayload } from './compact-analyze-payload.js';
import { log } from './logger.js';

function toolError(code: string, message: string, detail?: unknown): {
  content: [{ type: 'text'; text: string }];
} {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: { code, message, detail: detail ?? null } }, null, 2),
      },
    ],
  };
}

function stderrTelemetrySink(): TelemetrySink {
  return {
    emit(event) {
      process.stderr.write(`${JSON.stringify(event)}\n`);
    },
  };
}

const telemetrySink: TelemetrySink | undefined =
  process.env.QULIB_TELEMETRY_STDERR === '1' ? stderrTelemetrySink() : undefined;

const mcpProgressLog: AnalyzeProgressSink = {
  info: (message: string) => log.info(message),
  warn: (message: string) => log.warn(message),
  error: (message: string) => log.error(message),
  debug: (message: string) => log.debug(message),
};

// NOTE: MCP `auth` shape intentionally flattens the core `AuthConfigSchema` so an LLM
// can populate it without nested objects. We translate it back into core's nested
// `AuthConfig` (with `credentials: { username, password }` and `selectors: { ... }`)
// before passing it to `analyzeApp` below. If core's `AuthConfigSchema` changes, mirror
// the change here. Drift is allowed because the surfaces serve different consumers
// (LLM tool input vs internal harness contract), but the translation must stay 1:1.
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

const ScoreAutomationInputSchema = z.object({
  repoPath: z.string().describe('Absolute path to the automation repository on the MCP host filesystem'),
  includeFullDimensions: z
    .boolean()
    .optional()
    .describe('When true, includes all dimension detail. Default false returns top recommendations only.'),
});

function validateAbsoluteRepoPath(repoPath: string): string {
  const norm = normalize(repoPath.trim());
  if (!norm || norm === '.' || norm.includes('..')) {
    throw new Error('repoPath must be absolute and must not contain path traversal segments');
  }
  if (!isAbsolute(norm)) {
    throw new Error('repoPath must be an absolute path on the MCP host');
  }
  return resolve(norm);
}

const mcpServer = new McpServer(
  {
    name: 'qulib-mcp',
    version: pkg.version,
    description:
      'Qulib QA intelligence platform — gap analysis, auth exploration, and quality scoring for deployed web applications',
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
    try {
      log.info(`explore_auth tool url=${url} timeoutMs=${timeoutMs ?? 20000}`);
      const result = await exploreAuth(url, timeoutMs, mcpProgressLog);
      log.info(`explore_auth tool done authRequired=${result.authRequired} paths=${result.authPaths.length}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`explore_auth failed: ${msg}`);
      return toolError('QULIB_AUTH_EXPLORE_FAILED', msg, err instanceof Error ? err.stack : undefined);
    }
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
    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`detect_auth failed: ${msg}`);
      return toolError('QULIB_AUTH_DETECT_FAILED', msg, err instanceof Error ? err.stack : undefined);
    }
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
    try {
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
        telemetry: telemetrySink,
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`analyze_app failed: ${msg}`);
      return toolError('QULIB_SCAN_FAILED', msg, err instanceof Error ? err.stack : undefined);
    }
  }
);

mcpServer.registerTool(
  'qulib_score_automation',
  {
    description:
      'Score an automation repository for QA maturity across six dimensions: test coverage breadth, framework adoption, test-id hygiene, CI integration, auth test coverage, and component test ratio. Returns an overall score (0–100), maturity level (L1–L5), and prioritized recommendations.',
    inputSchema: ScoreAutomationInputSchema,
  },
  async ({ repoPath, includeFullDimensions }) => {
    try {
      // Security: repoPath is an absolute path on the MCP host. We validate it is absolute
      // and does not contain path traversal sequences. The MCP host is responsible for ensuring
      // the path is within an allowed directory. We do not enforce a sandbox here — that is a
      // host-level concern.
      const abs = validateAbsoluteRepoPath(repoPath);
      log.info(`qulib_score_automation repoPath=${abs}`);
      const repo = await scanRepo(abs);
      const maturity = computeAutomationMaturity(repo);
      const payload =
        includeFullDimensions === true
          ? maturity
          : {
              overallScore: maturity.overallScore,
              level: maturity.level,
              label: maturity.label,
              topRecommendations: maturity.topRecommendations,
              repoPath: maturity.repoPath,
              computedAt: maturity.computedAt,
            };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('repoPath must')) {
        return toolError('QULIB_INPUT_INVALID', msg, undefined);
      }
      log.error(`qulib_score_automation failed: ${msg}`);
      return toolError('QULIB_REPO_SCORE_FAILED', msg, err instanceof Error ? err.stack : undefined);
    }
  }
);

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
