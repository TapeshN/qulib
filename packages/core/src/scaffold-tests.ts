import { analyzeApp } from './analyze.js';
import { createAdapter } from './adapters/adapter-factory.js';
import type { NeutralScenario, GeneratedTest } from './schemas/gap-analysis.schema.js';
import type { AdapterType } from './schemas/config.schema.js';
import type { AnalyzeProgressSink } from './harness/progress-log.js';
import type { TelemetrySink } from './telemetry/telemetry.interface.js';

export interface ScaffoldOptions {
  framework?: Extract<AdapterType, 'cypress-e2e' | 'playwright'>;
  maxPagesToScan?: number;
  scenarios?: NeutralScenario[];
  progressLog?: AnalyzeProgressSink;
  telemetry?: TelemetrySink;
}

export interface ProjectConfig {
  configFile: { filename: string; code: string };
  packageJson: { devDependencies: Record<string, string>; scripts: Record<string, string> };
  supportFiles: Array<{ filename: string; code: string }>;
}

export interface ScaffoldResult {
  url: string;
  framework: Extract<AdapterType, 'cypress-e2e' | 'playwright'>;
  generatedTests: GeneratedTest[];
  scenarios: NeutralScenario[];
  projectConfig: ProjectConfig;
}

function buildCypressProjectConfig(url: string): ProjectConfig {
  return {
    configFile: {
      filename: 'cypress.config.ts',
      code: [
        `import { defineConfig } from 'cypress';`,
        ``,
        `export default defineConfig({`,
        `  e2e: {`,
        `    baseUrl: ${JSON.stringify(url)},`,
        `    viewportWidth: 1280,`,
        `    viewportHeight: 720,`,
        `    defaultCommandTimeout: 10000,`,
        `    pageLoadTimeout: 30000,`,
        `    video: false,`,
        `    screenshotOnRunFailure: true,`,
        `    screenshotsFolder: 'results/screenshots',`,
        `    specPattern: 'cypress/e2e/**/*.cy.ts',`,
        `    supportFile: 'cypress/support/e2e.ts',`,
        `  },`,
        `});`,
        ``,
      ].join('\n'),
    },
    packageJson: {
      devDependencies: {
        cypress: '^13.0.0',
        typescript: '^5.4.0',
      },
      scripts: {
        test: 'cypress run',
        'test:headed': 'cypress open',
        'test:ci': 'cypress run --reporter json --reporter-options output=results/cypress-results.json',
      },
    },
    supportFiles: [
      {
        filename: 'cypress/support/e2e.ts',
        code: [
          `Cypress.on('uncaught:exception', () => false);`,
          ``,
        ].join('\n'),
      },
    ],
  };
}

function buildPlaywrightProjectConfig(url: string): ProjectConfig {
  return {
    configFile: {
      filename: 'playwright.config.ts',
      code: [
        `import { defineConfig, devices } from '@playwright/test';`,
        ``,
        `export default defineConfig({`,
        `  use: { baseURL: ${JSON.stringify(url)} },`,
        `  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],`,
        `});`,
        ``,
      ].join('\n'),
    },
    packageJson: {
      devDependencies: {
        '@playwright/test': '^1.44.0',
        typescript: '^5.4.0',
      },
      scripts: {
        test: 'playwright test',
        'test:headed': 'playwright test --headed',
        'test:ci': 'playwright test --reporter=json',
      },
    },
    supportFiles: [],
  };
}

export async function scaffoldTests(
  url: string,
  options: ScaffoldOptions = {}
): Promise<ScaffoldResult> {
  const framework = options.framework ?? 'cypress-e2e';

  let scenarios: NeutralScenario[];

  if (options.scenarios && options.scenarios.length > 0) {
    scenarios = options.scenarios;
  } else {
    const result = await analyzeApp({
      url,
      config: {
        maxPagesToScan: options.maxPagesToScan ?? 10,
        maxDepth: 3,
        minPagesForConfidence: 3,
        timeoutMs: 30000,
        retryCount: 0,
        llmTokenBudget: 4096,
        testGenerationLimit: 10,
        enableLlmScenarios: true,
        readOnlyMode: true,
        requireHumanReview: false,
        failOnConsoleError: false,
        explorer: 'playwright',
        defaultAdapter: framework,
        adapters: [framework],
      },
      progressLog: options.progressLog,
      telemetry: options.telemetry,
    });
    scenarios = result.gapAnalysis.scenarios;
  }

  const adapter = createAdapter(framework);
  const generatedTests = adapter.renderAll(scenarios);

  const projectConfig =
    framework === 'cypress-e2e'
      ? buildCypressProjectConfig(url)
      : buildPlaywrightProjectConfig(url);

  return { url, framework, generatedTests, scenarios, projectConfig };
}
