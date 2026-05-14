#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const requirePkg = createRequire(import.meta.url);
const pkg = requirePkg('../../package.json') as { version: string };
import { HarnessConfigSchema, type HarnessConfig } from '../schemas/config.schema.js';
import { analyzeApp } from '../analyze.js';
import { detectAuth } from '../tools/auth/detect.js';
import { exploreAuth } from '../tools/auth/explore.js';
import {
  assertExactlyOneCredentialSource,
  parseCredentialsJsonString,
  resolveAuthLoginConfig,
} from './auth-login-resolve.js';
import { runAutomatedAuthLogin } from './auth-login-run.js';

const program = new Command();
const AnalyzeUrlSchema = z.string().url();
type AnalyzeMode = 'url-only' | 'url-repo';

const FormLoginCliSchema = z.object({
  loginUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string(),
  usernameSelector: z.string().min(1),
  passwordSelector: z.string().min(1),
  submitSelector: z.string().min(1),
});

async function loadConfigFile(relativePath: string): Promise<HarnessConfig> {
  const configPath = resolve(process.cwd(), relativePath);
  const configModule = await import(pathToFileURL(configPath).href);
  return HarnessConfigSchema.parse(configModule.default);
}

function redactConfigForLog(config: HarnessConfig): Record<string, unknown> {
  const base = { ...config } as Record<string, unknown>;
  if (config.auth?.type === 'form-login') {
    base.auth = {
      ...config.auth,
      credentials: {
        username: '***',
        password: '***',
      },
    };
  }
  if (config.auth?.type === 'storage-state') {
    base.auth = { type: 'storage-state', path: '<provided>' };
  }
  return base;
}

function mergeAuthFromCli(
  config: HarnessConfig,
  options: {
    authStorageState?: string;
    authFormLogin?: boolean;
    loginUrl?: string;
    username?: string;
    password?: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
  }
): HarnessConfig {
  if (options.authStorageState && options.authFormLogin) {
    throw new Error('Use either --auth-storage-state or --auth-form-login, not both.');
  }
  if (options.authStorageState) {
    return {
      ...config,
      auth: { type: 'storage-state', path: options.authStorageState },
    };
  }
  if (options.authFormLogin) {
    const parsed = FormLoginCliSchema.parse({
      loginUrl: options.loginUrl,
      username: options.username,
      password: options.password,
      usernameSelector: options.usernameSelector,
      passwordSelector: options.passwordSelector,
      submitSelector: options.submitSelector,
    });
    return {
      ...config,
      auth: {
        type: 'form-login',
        loginUrl: parsed.loginUrl,
        credentials: { username: parsed.username, password: parsed.password },
        selectors: {
          username: parsed.usernameSelector,
          password: parsed.passwordSelector,
          submit: parsed.submitSelector,
        },
        successIndicator: {},
      },
    };
  }
  return config;
}

async function runAnalyze(options: {
  url: string;
  repo?: string;
  configFile?: string;
  ephemeral?: boolean;
  skipAuthDetection?: boolean;
  authStorageState?: string;
  authFormLogin?: boolean;
  loginUrl?: string;
  username?: string;
  password?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}): Promise<void> {
  const validatedUrl = AnalyzeUrlSchema.parse(options.url);
  const mode: AnalyzeMode = options.repo ? 'url-repo' : 'url-only';
  const baseConfig = await loadConfigFile(options.configFile ?? 'qulib.config.ts');
  const config = mergeAuthFromCli(baseConfig, options);
  const ephemeral = options.ephemeral ?? false;
  const writeArtifacts = !ephemeral;

  if (ephemeral) {
    console.error('[qulib] Ephemeral mode: no disk writes; full result JSON on stdout');
  } else {
    console.log('[qulib] Detected mode:', mode);
    console.log('[qulib] Active config:', redactConfigForLog(config));
  }

  const result = await analyzeApp({
    url: validatedUrl,
    repoPath: options.repo,
    config,
    writeArtifacts,
    skipAuthDetection: options.skipAuthDetection,
  });

  if (ephemeral) {
    console.log(
      JSON.stringify(
        {
          status: result.status,
          coverageScore: result.coverageScore,
          releaseConfidence: result.releaseConfidence,
          gaps: result.gaps,
          gapAnalysis: result.gapAnalysis,
          discoveredRoutes: result.routeInventory,
          publicSurface: result.publicSurface,
          repoInventory: result.repoInventory,
          decisionLog: result.decisionLog,
          ...(result.detectedAuth !== undefined && { detectedAuth: result.detectedAuth }),
        },
        null,
        2
      )
    );
  }
}

program
  .name('qulib')
  .description('Qulib — QA harness')
  .version(pkg.version);

program
  .command('clean')
  .description('Remove all generated reports and scan state')
  .action(async () => {
    const fs = await import('node:fs/promises');
    const targets = ['output', '.scan-state'];
    for (const target of targets) {
      try {
        await fs.rm(target, { recursive: true, force: true });
        console.log(`[qulib] removed ${target}/`);
      } catch (err) {
        console.error(`[qulib] failed to remove ${target}/: ${String(err)}`);
      }
    }
    await fs.mkdir('output', { recursive: true });
    await fs.writeFile(
      'output/.gitkeep',
      'This folder is generated by `qulib analyze`. It contains report.json, report.md,\nand a `generated/` subfolder with test scaffolds. Run `qulib clean` to reset.\n',
      'utf8'
    );
    await fs.mkdir('.scan-state', { recursive: true });
    await fs.writeFile('.scan-state/.gitkeep', '', 'utf8');
    console.log('[qulib] clean complete');
  });

const costCmd = program.command('cost').description('Cost intelligence helpers');
costCmd
  .command('doctor')
  .description('Print Cost Intelligence from output/report.json (run analyze without --ephemeral first)')
  .option('--report <file>', 'Path to report.json relative to cwd', 'output/report.json')
  .action(async (opts: { report: string }) => {
    const { runCostDoctor } = await import('./cost-doctor.js');
    await runCostDoctor(opts.report);
  });

program
  .command('analyze')
  .description('Analyze an app for quality gaps')
  .requiredOption('--url <url>', 'Base URL of the app to analyze')
  .option('--repo <path>', 'Path to the app repo')
  .option('--prd <path>', 'Path to a PRD markdown file')
  .option('--config <file>', 'Path to config file (relative to cwd)', 'qulib.config.ts')
  .option(
    '--adapter <type>',
    'Override default test adapter (playwright, cypress-e2e, cypress-component, api)',
    'playwright'
  )
  .option('--ephemeral', 'Do not write to disk — return full report as JSON on stdout (use for MCP/CI)', false)
  .option('--skip-auth-detection', 'Crawl the public surface even if auth is detected (useful for sites with sign-in CTAs on public pages)', false)
  .option(
    '--auth-storage-state <path>',
    'Path to a storage state JSON file (use after `qulib auth init`)'
  )
  .option('--auth-form-login', 'Use form-login; requires --login-url, credentials, and selectors', false)
  .option('--login-url <url>', 'Form login page URL (required with --auth-form-login)')
  .option('--username <user>', 'Form login username')
  .option('--password <secret>', 'Form login password')
  .option('--username-selector <sel>', 'Selector for username field')
  .option('--password-selector <sel>', 'Selector for password field')
  .option('--submit-selector <sel>', 'Selector for submit control')
  .action(async (options) => {
    const authFormLogin = Boolean(options.authFormLogin);
    const loginUrl = options.loginUrl as string | undefined;
    if (!authFormLogin && loginUrl !== undefined) {
      throw new Error('--login-url is only valid with --auth-form-login');
    }
    if (authFormLogin && loginUrl === undefined) {
      throw new Error('--auth-form-login requires --login-url');
    }
    await runAnalyze({
      url: options.url,
      repo: options.repo,
      configFile: options.config,
      ephemeral: options.ephemeral,
      skipAuthDetection: Boolean(options.skipAuthDetection),
      authStorageState: options.authStorageState,
      authFormLogin,
      loginUrl,
      username: options.username,
      password: options.password,
      usernameSelector: options.usernameSelector,
      passwordSelector: options.passwordSelector,
      submitSelector: options.submitSelector,
    });
  });

program
  .command('explore-auth')
  .description('Explore all sign-in paths (OAuth, forms, magic link) for agent-driven setup before analyze')
  .requiredOption('--url <url>', 'URL of the app or login page')
  .option('--timeout <ms>', 'Navigation timeout in ms', '20000')
  .action(async (options) => {
    const result = await exploreAuth(options.url, parseInt(options.timeout, 10));
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('detect-auth')
  .description('Detect the authentication pattern used by a deployed web app')
  .requiredOption('--url <url>', 'URL of the app or login page')
  .option('--timeout <ms>', 'Page load timeout in ms', '15000')
  .action(async (options) => {
    const result = await detectAuth(options.url, parseInt(options.timeout, 10));
    console.log(JSON.stringify(result, null, 2));
  });

const authCmd = program.command('auth').description('Authentication helpers for scans');
const providersCmd = authCmd
  .command('providers')
  .description('User-local OAuth/SSO button patterns (~/.qulib/providers.json)');
providersCmd
  .command('list')
  .description('List user-local providers registered on this machine')
  .action(async () => {
    const { listUserProviders } = await import('../tools/auth/custom-providers.js');
    const providers = listUserProviders();
    console.log(JSON.stringify(providers, null, 2));
  });
providersCmd
  .command('add')
  .description('Register a custom provider pattern (case-insensitive regex source)')
  .requiredOption('--id <id>', 'Stable id (kebab-case), e.g. nq-login')
  .requiredOption('--label <label>', 'Human-readable label')
  .requiredOption('--pattern <regex>', 'Regex source, e.g. nq login')
  .action(async (opts: { id: string; label: string; pattern: string }) => {
    try {
      new RegExp(opts.pattern, 'i');
    } catch {
      throw new Error(`Invalid regex pattern: ${opts.pattern}`);
    }
    const { addUserProvider } = await import('../tools/auth/custom-providers.js');
    addUserProvider({ id: opts.id, label: opts.label, pattern: opts.pattern });
    console.log(`[qulib] Added provider "${opts.label}" (id: ${opts.id}) to ~/.qulib/providers.json`);
  });
providersCmd
  .command('remove')
  .description('Remove a user-local provider by id')
  .requiredOption('--id <id>', 'Provider id to remove')
  .action(async (opts: { id: string }) => {
    const { removeUserProvider } = await import('../tools/auth/custom-providers.js');
    const removed = removeUserProvider(opts.id);
    console.log(removed ? `[qulib] Removed "${opts.id}"` : `[qulib] No provider with id "${opts.id}" found`);
  });

authCmd
  .command('init')
  .description('Open a browser, let the user log in manually, save the storage state to a file for reuse')
  .requiredOption('--base-url <url>', 'The base URL of the app to log into')
  .option('--out <path>', 'Output file path for the storage state JSON', './qulib-storage-state.json')
  .option('--timeout <ms>', 'Maximum time to wait for the user to finish logging in (default 5 min)', '300000')
  .action(async (options) => {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    const timeoutMs = parseInt(options.timeout, 10);
    console.log(`\n[qulib] Opening ${options.baseUrl}`);
    console.log('[qulib] Log in normally in the browser window that just opened.');
    console.log('[qulib] After you reach a logged-in state, return to this terminal and press ENTER.');
    console.log(`[qulib] You have ${timeoutMs / 1000}s before timeout.\n`);

    await page.goto(options.baseUrl);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for user')),
        timeoutMs
      );
      process.stdin.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      process.stdin.resume();
    });

    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const outPath = pathMod.resolve(options.out);
    await fs.mkdir(pathMod.dirname(outPath), { recursive: true });
    await context.storageState({ path: outPath });

    console.log(`\n[qulib] Saved storage state to ${outPath}`);
    console.log('[qulib] To use it, pass to qulib like:');
    console.log(`        qulib analyze --url ${options.baseUrl} --auth-storage-state ${outPath}`);
    console.log(`[qulib] Or in MCP, pass auth: { type: 'storage-state', path: '${outPath}' }`);

    await browser.close();
    process.exit(0);
  });

authCmd
  .command('login')
  .description(
    'Detect form-login on the URL, fill credentials, and save the storage state automatically (uses selectors from detect-auth)'
  )
  .requiredOption('--base-url <url>', 'The base URL of the app to log into')
  .option('--auth-path <id>', 'Specific authOption id to use (e.g. "nq-login") when multiple form-login paths exist')
  .option(
    '--credentials <json>',
    'JSON object mapping field name → value, e.g. \'{"username":"a","password":"b","hidden.datasource":"NYC"}\''
  )
  .option('--credentials-file <path>', 'Path to a JSON file with the credentials object (keeps secrets out of shell history)')
  .option('--out <path>', 'Output file path for the storage state JSON', './qulib-storage-state.json')
  .option(
    '--success-url-contains <substring>',
    'Substring that must appear in the URL after login (stronger success detection). If omitted, success is inferred from navigation or hidden password fields.'
  )
  .option('--timeout <ms>', 'Max time in ms to wait for navigation / success heuristics', '30000')
  .option('--headed', 'Run Chromium headed for debugging', false)
  .action(
    async (options: {
      baseUrl: string;
      authPath?: string;
      credentials?: string;
      credentialsFile?: string;
      out: string;
      successUrlContains?: string;
      timeout: string;
      headed?: boolean;
    }) => {
      assertExactlyOneCredentialSource(options.credentials, options.credentialsFile);
      const fs = await import('node:fs/promises');
      let credentials: Record<string, string>;
      if (options.credentialsFile && options.credentialsFile.trim()) {
        const p = resolve(options.credentialsFile.trim());
        const raw = await fs.readFile(p, 'utf8');
        credentials = parseCredentialsJsonString(raw);
      } else {
        credentials = parseCredentialsJsonString(options.credentials!.trim());
      }

      const timeoutMs = parseInt(options.timeout, 10);
      const detection = await detectAuth(options.baseUrl, timeoutMs);
      const { path } = resolveAuthLoginConfig({
        baseUrl: options.baseUrl,
        authOptions: detection.authOptions,
        credentials,
        authPathId: options.authPath,
      });

      const loginUrl = detection.loginUrl ?? options.baseUrl;
      await runAutomatedAuthLogin({
        loginUrl,
        path,
        credentials,
        outPath: options.out,
        headed: Boolean(options.headed),
        timeoutMs,
        successUrlContains: options.successUrlContains,
        baseUrlHint: options.baseUrl,
      });
      process.exit(0);
    }
  );

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[qulib] Failed:', message);
  process.exit(1);
});
