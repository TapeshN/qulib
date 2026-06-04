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
  scaffoldTests,
  discoverApiSurfaceWithRepo,
  computeApiCoverage,
  computeReleaseConfidence,
  buildConfidenceInputFromQulib,
} from '@qulib/core';
import type { HarnessConfig, AnalyzeProgressSink, TelemetrySink } from '@qulib/core';
import { RecipeIdSchema } from '@qulib/core';
import { z } from 'zod';
import { buildAnalyzeAppMcpPayload } from './analyze-app-mcp-payload.js';
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
  agentSummary: z
    .boolean()
    .optional()
    .describe(
      'When true, return only the versioned agent-summary JSON ({ schemaVersion: 1, gate, coverageStatus, topRisks, recommendedNextChecks, honestyNotes, costSummary, deterministicFollowUps }). Use this for CI gates and orchestrators that need a single small payload to decide pass/warn/fail. Overrides includeFullReport.'
    ),
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
      'Analyze a deployed web app for quality gaps. Default response is summary-first (top gaps, cost summary, next checks). Set includeFullReport for the full gapAnalysis. Set agentSummary for the compact gate-decision payload (pass/warn/fail with honesty notes) — use this when calling from a CI gate or orchestrator. Optional llmMaxOutputTokensPerCall / llmTokenBudget (legacy), testGenerationLimit, enableLlmScenarios align with @qulib/core HarnessConfig.',
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

      const payload = buildAnalyzeAppMcpPayload(result, {
        includeFullReport: input.includeFullReport,
        agentSummary: input.agentSummary,
      });

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

const ScaffoldTestsInputSchema = z.object({
  url: z.string().url().describe('URL of the deployed web app to scaffold tests for'),
  framework: z
    .enum(['cypress-e2e', 'playwright'])
    .optional()
    .describe('Test framework to generate. Default: cypress-e2e'),
  maxPagesToScan: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Max pages to crawl when running analyze_app internally. Default: 10'),
  recipes: z
    .array(RecipeIdSchema)
    .optional()
    .describe(
      'Optional list of reusable test-pattern recipes to append to the scaffold. ' +
        'Each recipe adds proven NQ-2/CaseLoom-derived scenarios: ' +
        '"auth" = login/logout/protected-route flows; ' +
        '"a11y" = heading/landmark/title accessibility checks; ' +
        '"nav" = deep-link/browser-back/404 handling; ' +
        '"seed" = data-seeding/state-reset helpers. ' +
        'Recipe scenarios are APPENDED to crawl-derived scenarios — they never replace them. ' +
        'Example: ["auth", "a11y"] adds 6 ready-to-run test scenarios.'
    ),
});

mcpServer.registerTool(
  'qulib_scaffold_tests',
  {
    description:
      'Generate a ready-to-run test scaffold for a deployed web app. Crawls the URL, identifies quality gaps and user flows, then produces framework-specific test files (Cypress or Playwright) plus the project config (cypress.config.ts or playwright.config.ts) and package.json deps. Returns generatedTests (array of {filename, code, outputPath}) and projectConfig so an agent can write the files directly to a repo without any manual test-writing. Optionally pass recipes (e.g. ["auth","a11y"]) to append proven NQ-2/CaseLoom-derived test patterns for common flows — auth adds login/logout/protected-route tests, a11y adds heading/landmark/title checks, nav adds deep-link/404 tests, seed adds state-reset helpers.',
    inputSchema: ScaffoldTestsInputSchema,
  },
  async ({ url, framework, maxPagesToScan, recipes }) => {
    try {
      const recipesLog = recipes && recipes.length > 0 ? ` recipes=[${recipes.join(',')}]` : '';
      log.info(`qulib_scaffold_tests url=${url} framework=${framework ?? 'cypress-e2e'} maxPagesToScan=${maxPagesToScan ?? 10}${recipesLog}`);
      const result = await scaffoldTests(url, {
        framework: framework ?? 'cypress-e2e',
        maxPagesToScan: maxPagesToScan ?? 10,
        progressLog: mcpProgressLog,
        telemetry: telemetrySink,
        ...(recipes && recipes.length > 0 && { recipes }),
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                url: result.url,
                framework: result.framework,
                scenarioCount: result.scenarios.length,
                testCount: result.generatedTests.length,
                generatedTests: result.generatedTests,
                projectConfig: result.projectConfig,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`qulib_scaffold_tests failed: ${msg}`);
      return toolError('QULIB_SCAFFOLD_FAILED', msg, err instanceof Error ? err.stack : undefined);
    }
  }
);

const ScoreApiInputSchema = z.object({
  repoPath: z.string().describe('Absolute path to the repository on the MCP host filesystem'),
  enableTier3: z
    .boolean()
    .optional()
    .describe(
      'Enable Tier3 heuristic discovery (currently: tRPC router definitions). Default false. Tier1=OpenAPI specs, Tier2=framework routes (Next.js, Express, Fastify, NestJS), Tier3=heuristic.'
    ),
  includeEndpointDetail: z
    .boolean()
    .optional()
    .describe('When true, includes per-endpoint coverage detail in the response. Default false.'),
});

mcpServer.registerTool(
  'qulib_score_api',
  {
    description:
      'Discover API endpoints in a repository and score their test coverage. Returns an api-test-coverage dimension score (0–100) with per-endpoint contextual evidence — which endpoints are covered by tests and which are not. Discovery is evidence-only: Tier1=OpenAPI/Swagger specs, Tier2=framework routes (Next.js App-Router route.ts exports, Pages API routes, Express, Fastify, Hono, NestJS decorators), Tier3=heuristic opt-in (tRPC). Never fabricates endpoints. Returns "not_applicable" when no API endpoints are found.',
    inputSchema: ScoreApiInputSchema,
  },
  async ({ repoPath, enableTier3, includeEndpointDetail }) => {
    try {
      const abs = validateAbsoluteRepoPath(repoPath);
      log.info(`qulib_score_api repoPath=${abs} enableTier3=${enableTier3 ?? false}`);

      const repo = await scanRepo(abs);
      const apiSurfaceResult = await discoverApiSurfaceWithRepo(abs, repo, {
        enableTier3: enableTier3 ?? false,
      });

      const coverageResult = computeApiCoverage(repo, apiSurfaceResult);

      const payload: Record<string, unknown> = {
        repoPath: abs,
        computedAt: new Date().toISOString(),
        endpointsDiscovered: apiSurfaceResult.endpoints.length,
        openApiSpecsFound: apiSurfaceResult.openApiSpecsFound,
        tier3Enabled: apiSurfaceResult.tier3Enabled,
        dimension: coverageResult.dimension,
        untestedHighSeverityCount: coverageResult.untestedHighSeverityCount,
        untestedMediumSeverityCount: coverageResult.untestedMediumSeverityCount,
      };

      if (includeEndpointDetail === true) {
        payload['endpointCoverage'] = coverageResult.endpointCoverage;
      }

      log.info(
        `qulib_score_api done endpoints=${apiSurfaceResult.endpoints.length} score=${coverageResult.dimension.score} applicability=${coverageResult.dimension.applicability ?? 'applicable'}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('repoPath must')) {
        return toolError('QULIB_INPUT_INVALID', msg, undefined);
      }
      log.error(`qulib_score_api failed: ${msg}`);
      return toolError('QULIB_API_SCORE_FAILED', msg, err instanceof Error ? err.stack : undefined);
    }
  }
);

// ---------------------------------------------------------------------------
// qulib_score_confidence — P3 Release Confidence Aggregator
// Composes existing collectors (analyze_app, qulib_score_automation,
// qulib_score_api) into one fused Release Confidence verdict. Honors the
// tool-explosion guardrail by composing, not fanning out (index.ts lines 4–10).
// ---------------------------------------------------------------------------

const ScoreConfidenceInputSchema = z.object({
  url: z.string().url().optional().describe('URL of the deployed app to analyze (runs analyze_app if provided)'),
  repoPath: z
    .string()
    .optional()
    .describe('Absolute path to the repository (runs qulib_score_automation + qulib_score_api if provided)'),
  includeViews: z
    .object({
      replay: z.boolean().optional().describe('Include the Replay provenance trace in the response'),
    })
    .optional()
    .describe('Optional projection flags — which views to include beyond the Release Confidence view'),
  subject: z
    .object({
      kind: z.enum(['release', 'pr', 'deploy', 'app', 'repo']).optional(),
      ref: z.string().optional(),
      tenantId: z.string().optional(),
    })
    .optional()
    .describe('Subject metadata for the confidence verdict; defaults are inferred from url/repoPath'),
});

mcpServer.registerTool(
  'qulib_score_confidence',
  {
    description:
      'Compute a fused Release Confidence verdict by composing qulib evidence collectors. ' +
      'Given a URL and/or repo path, runs analyze_app / qulib_score_automation / qulib_score_api as applicable, ' +
      'then fuses the signals into one verdict (ship | caution | hold | block) with a 0–100 confidence score, ' +
      'L1–L5 level, per-source contributions, honesty notes for any excluded/unknown source, and recommended next checks. ' +
      'Returns the Release Confidence view. Pass includeViews.replay for the full provenance trace.',
    inputSchema: ScoreConfidenceInputSchema,
  },
  async ({ url, repoPath, includeViews, subject }) => {
    try {
      const subjectRef = subject?.ref ?? url ?? repoPath ?? 'unknown';
      const subjectKind = subject?.kind ?? (url && repoPath ? 'release' : url ? 'app' : 'repo');
      const tenantId = subject?.tenantId ?? 'default';
      const confidenceSubject = { kind: subjectKind, ref: subjectRef, tenantId };

      // Collect evidence from whichever collectors apply.
      let analyzeResult: Awaited<ReturnType<typeof analyzeApp>> | undefined;
      let maturityResult: Awaited<ReturnType<typeof computeAutomationMaturity>> | undefined;
      let apiCoverageResult: Awaited<ReturnType<typeof computeApiCoverage>> | undefined;

      if (url) {
        log.info(`qulib_score_confidence: running analyze_app url=${url}`);
        const harnessConfig: HarnessConfig = {
          maxPagesToScan: 10,
          maxDepth: 3,
          minPagesForConfidence: 3,
          timeoutMs: 30000,
          retryCount: 0,
          llmTokenBudget: 4096,
          testGenerationLimit: 5,
          enableLlmScenarios: false,
          readOnlyMode: true,
          requireHumanReview: false,
          failOnConsoleError: false,
          explorer: 'playwright',
          defaultAdapter: 'playwright',
          adapters: ['playwright'],
        };
        analyzeResult = await analyzeApp({
          url,
          writeArtifacts: false,
          config: harnessConfig,
          progressLog: mcpProgressLog,
          telemetry: telemetrySink,
        });
      }

      if (repoPath) {
        const abs = validateAbsoluteRepoPath(repoPath);
        log.info(`qulib_score_confidence: running qulib_score_automation + qulib_score_api repoPath=${abs}`);
        const repo = await scanRepo(abs);
        maturityResult = computeAutomationMaturity(repo);
        const apiSurface = await discoverApiSurfaceWithRepo(abs, repo, { enableTier3: false });
        apiCoverageResult = computeApiCoverage(repo, apiSurface);
      }

      // Build the evidence bundle from qulib's own collectors.
      const confidenceInput = buildConfidenceInputFromQulib({
        analyze: analyzeResult,
        maturity: maturityResult,
        apiCoverage: apiCoverageResult,
        subject: confidenceSubject,
      });

      // Run the pure scorer.
      const rc = computeReleaseConfidence(confidenceInput);

      // Build the response payload (Release Confidence view is always included).
      const payload: Record<string, unknown> = { releaseConfidence: rc };

      if (includeViews?.replay) {
        const { buildReplay } = await import('@qulib/core');
        payload['replay'] = buildReplay(confidenceInput, rc);
      }

      log.info(
        `qulib_score_confidence done verdict=${rc.verdict} confidenceScore=${rc.confidenceScore ?? 'null'} ` +
        `level=${rc.level} evidenceSources=${confidenceInput.evidence.length}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('repoPath must')) {
        return toolError('QULIB_INPUT_INVALID', msg, undefined);
      }
      log.error(`qulib_score_confidence failed: ${msg}`);
      return toolError('QULIB_CONFIDENCE_FAILED', msg, err instanceof Error ? err.stack : undefined);
    }
  }
);

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
