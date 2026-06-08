/**
 * `qulib scaffold` — Q2 (scaffold-cli subtask).
 *
 * Wraps `scaffoldTests(url, options)` from ../scaffold-tests.js as a first-class
 * CLI surface (scaffold was previously only reachable programmatically / via MCP).
 *
 * This file owns the `scaffold` subcommand end-to-end and is registered from
 * cli/index.ts via `registerScaffoldCommand(program)` so this build agent never
 * edits index.ts itself (avoids collision with score-automation). It mirrors the
 * dynamic-import command style used by `cost` and the output-mode conventions of
 * `analyze` (write-to-disk by default, `--json` for a stdout-only run).
 *
 * Output modes (one stdout shape, mutually exclusive with disk writes):
 *   default            → write projectConfig + generated specs under --out (./qulib-scaffold)
 *   --json             → no disk writes; print the full ScaffoldResult-shaped JSON on stdout
 *
 * Honesty rules (root design principle: never emit false confidence):
 *   - If analyze produced ZERO scenarios, we do NOT write an empty-but-confident
 *     scaffold. Write mode exits non-zero with a clear message; --json emits an
 *     explicit `{ empty: true, ... }` payload so a caller/agent can branch on it.
 *   - `--framework playwright` currently maps to a not-implemented adapter
 *     (PlaywrightAdapter.renderAll throws). Rather than surfacing a raw stack, we
 *     translate it into an actionable error pointing at the supported framework.
 */
import type { Command } from 'commander';
import { z } from 'zod';
import { scaffoldTests, type ScaffoldResult } from '../scaffold-tests.js';
import type { SpecValidationReport } from '../adapters/validate-specs.js';
import { RecipeIdSchema, type RecipeId } from '../schemas/recipe.schema.js';

const ScaffoldUrlSchema = z.string().url();

/** Frameworks `scaffoldTests` accepts. Mirrors its `ScaffoldOptions['framework']`. */
const FRAMEWORKS = ['cypress-e2e', 'playwright'] as const;
type ScaffoldFramework = (typeof FRAMEWORKS)[number];
const FrameworkSchema = z.enum(FRAMEWORKS);

const DEFAULT_OUT_DIR = 'qulib-scaffold';

/** A single file the scaffold wants on disk, with its repo-relative path. */
interface ScaffoldFile {
  /** Path relative to the --out root. */
  relativePath: string;
  contents: string;
}

interface ScaffoldRunOptions {
  url: string;
  framework: ScaffoldFramework;
  maxPages?: number;
  out: string;
  json: boolean;
  recipes?: RecipeId[];
  /**
   * When true, fail the command (non-zero exit) if any generated spec does not
   * parse/compile. The dry-run validation always runs; this flag controls
   * whether a validation failure is fatal vs merely reported.
   */
  validateSpecs?: boolean;
}

/**
 * Raised when `--validate-specs` is set and at least one generated spec fails
 * the dry-run. Carries a non-zero `exitCode` so the CLI surfaces a hard failure
 * instead of writing a known-broken scaffold and exiting green.
 */
export class SpecValidationError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = 'SpecValidationError';
  }
}

/**
 * Flatten a ScaffoldResult into the concrete files a scaffold project needs:
 * the framework config file, any support files, and one spec per generated test
 * (each at its own `outputPath`, which the adapter already namespaces e.g.
 * `cypress/e2e/<slug>.cy.ts`). Pure + side-effect-free so tests can assert on it.
 */
export function collectScaffoldFiles(result: ScaffoldResult): ScaffoldFile[] {
  const files: ScaffoldFile[] = [];
  const { projectConfig, generatedTests } = result;

  files.push({
    relativePath: projectConfig.configFile.filename,
    contents: projectConfig.configFile.code,
  });
  for (const support of projectConfig.supportFiles) {
    files.push({ relativePath: support.filename, contents: support.code });
  }
  for (const spec of generatedTests) {
    files.push({ relativePath: spec.outputPath, contents: spec.code });
  }
  // A package.json fragment is informational (devDeps + scripts) — surface it as
  // a file so the scaffold is runnable without the caller re-deriving it.
  files.push({
    relativePath: 'package.json',
    contents:
      JSON.stringify(
        {
          name: 'qulib-scaffolded-suite',
          private: true,
          scripts: projectConfig.packageJson.scripts,
          devDependencies: projectConfig.packageJson.devDependencies,
        },
        null,
        2
      ) + '\n',
  });

  return files;
}

/** True when scaffold produced nothing actionable (no scenarios → no specs). */
function isEmptyScaffold(result: ScaffoldResult): boolean {
  return result.scenarios.length === 0 || result.generatedTests.length === 0;
}

/**
 * Apply the dry-run validation gate.
 *
 * Pure + side-effect-free (returns the warning text instead of logging) so it
 * is unit-testable in isolation: feed it an `ok: false` report and assert it
 * throws; feed it an `ok: true` report and assert it returns null. This is the
 * discrimination witness for the fatal path — `runScaffold` cannot produce a
 * broken spec on demand (the adapters always render valid code), so the gate's
 * reject-vs-pass behavior is proven here directly against a report.
 *
 * @returns a non-null warning string when validation failed but `validateSpecs`
 *   was not set (caller should log it); null when all specs parsed.
 * @throws SpecValidationError when validation failed AND `validateSpecs` is set.
 */
export function enforceSpecValidation(
  validation: SpecValidationReport,
  validateSpecs: boolean
): string | null {
  if (validation.ok) return null;

  const failed = validation.results.filter((r) => !r.valid);
  const detail = failed
    .map((r) => `  ✗ ${r.outputPath}\n      ${r.errors.join('\n      ')}`)
    .join('\n');
  const summary =
    `${validation.invalidCount} of ${validation.total} generated spec(s) failed dry-run validation ` +
    `(they do not parse/compile):\n${detail}`;

  if (validateSpecs) {
    throw new SpecValidationError(summary);
  }
  return summary;
}

/**
 * Translate the known not-implemented-adapter failure into an actionable message.
 * Re-throws anything else unchanged so real failures stay loud.
 */
function rethrowScaffoldError(error: unknown, framework: ScaffoldFramework): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/not implemented/i.test(message)) {
    throw new Error(
      `The "${framework}" test adapter is not implemented yet, so qulib cannot render specs for it. ` +
        `Re-run with --framework cypress-e2e (the supported scaffolder) until the ${framework} adapter ships.`
    );
  }
  throw error instanceof Error ? error : new Error(message);
}

async function writeScaffoldToDisk(files: ScaffoldFile[], outDir: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const outRoot = path.resolve(process.cwd(), outDir);
  const written: string[] = [];
  for (const file of files) {
    const dest = path.join(outRoot, file.relativePath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file.contents, 'utf8');
    written.push(dest);
  }
  return written;
}

export async function runScaffold(options: ScaffoldRunOptions): Promise<void> {
  const url = ScaffoldUrlSchema.parse(options.url);
  const framework = FrameworkSchema.parse(options.framework);

  if (options.json) {
    console.error('[qulib] Scaffold JSON mode: no disk writes; full result JSON on stdout');
  } else {
    console.error(`[qulib] Scaffolding ${framework} tests for ${url}`);
    console.error('[qulib] Analyzing the deployed surface to derive scenarios — this may take a moment...');
  }

  let result: ScaffoldResult;
  try {
    result = await scaffoldTests(url, {
      framework,
      ...(options.maxPages !== undefined && { maxPagesToScan: options.maxPages }),
      ...(options.recipes && options.recipes.length > 0 && { recipes: options.recipes }),
    });
  } catch (error) {
    rethrowScaffoldError(error, framework);
  }

  // Honest empty handling — no false-confidence scaffolds.
  if (isEmptyScaffold(result)) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            url: result.url,
            framework: result.framework,
            empty: true,
            scenarioCount: 0,
            generatedTestCount: 0,
            note:
              'Analysis surfaced no scenarios for this URL, so no tests were generated. ' +
              'This is honest output, not a failure: there was nothing concrete to scaffold. ' +
              'Try a different URL, raise --max-pages, or provide authenticated access if the app is behind a login.',
          },
          null,
          2
        )
      );
      return;
    }
    throw new Error(
      'No scenarios were derived for this URL, so qulib generated no tests. ' +
        'Refusing to write an empty scaffold (no false confidence). ' +
        'Try a different URL, raise --max-pages, or supply auth if the app is behind a login.'
    );
  }

  // Dry-run gate: the scaffold already validated every generated spec through
  // the TS compiler. Surface a failure here so a broken generator output never
  // silently lands on disk. With --validate-specs this is fatal (non-zero exit
  // via SpecValidationError); without it we still warn so the signal is never
  // hidden. The gate logic lives in enforceSpecValidation (unit-tested).
  const validation = result.specValidation;
  const warning = enforceSpecValidation(validation, Boolean(options.validateSpecs));
  if (warning) {
    console.error(`[qulib] WARNING — ${warning}`);
    console.error('[qulib] Re-run with --validate-specs to make this a hard (non-zero) failure.');
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          url: result.url,
          framework: result.framework,
          empty: false,
          scenarioCount: result.scenarios.length,
          generatedTestCount: result.generatedTests.length,
          scenarios: result.scenarios,
          generatedTests: result.generatedTests,
          projectConfig: result.projectConfig,
          specValidation: result.specValidation,
        },
        null,
        2
      )
    );
    return;
  }

  const files = collectScaffoldFiles(result);
  const written = await writeScaffoldToDisk(files, options.out);
  const path = await import('node:path');
  const outRoot = path.resolve(process.cwd(), options.out);

  console.error(`\n[qulib] Scaffold complete — ${framework}`);
  console.error(`  Scenarios derived:   ${result.scenarios.length}`);
  console.error(`  Specs generated:     ${result.generatedTests.length}`);
  console.error(`  Specs validated:     ${validation.total - validation.invalidCount}/${validation.total} parse cleanly`);
  console.error(`  Files written:       ${written.length}`);
  console.error(`  Output directory:    ${outRoot}`);
  console.error(`  Config:              ${result.projectConfig.configFile.filename}`);
  console.error('\n[qulib] Next: cd into the output dir, `npm install`, then run the test script.');
}

export function registerScaffoldCommand(program: Command): void {
  program
    .command('scaffold')
    .description('Generate a runnable test suite (config + specs) for a deployed app by analyzing its surface')
    .requiredOption('--url <url>', 'Base URL of the app to scaffold tests for')
    .option('--framework <framework>', `Test framework: ${FRAMEWORKS.join(' | ')}`, 'cypress-e2e')
    .option('--max-pages <n>', 'Maximum number of pages to scan while deriving scenarios')
    .option('--out <dir>', 'Directory to write the scaffolded project into', DEFAULT_OUT_DIR)
    .option('--json', 'Do not write to disk — print the full scaffold result as JSON on stdout (use for MCP/CI)', false)
    .option(
      '--recipes <ids>',
      'Comma-separated recipe ids to append proven test patterns: auth,a11y,nav,seed (e.g. --recipes auth,a11y)'
    )
    .option(
      '--validate-specs',
      'Fail (non-zero exit) if any generated spec does not parse/compile. Validation always runs; this makes a failure fatal.',
      false
    )
    .action(
      async (options: {
        url: string;
        framework: string;
        maxPages?: string;
        out: string;
        json?: boolean;
        recipes?: string;
        validateSpecs?: boolean;
      }) => {
        const parsedFramework = FrameworkSchema.safeParse(options.framework);
        if (!parsedFramework.success) {
          throw new Error(
            `Invalid --framework "${options.framework}". Supported: ${FRAMEWORKS.join(', ')}.`
          );
        }

        let maxPages: number | undefined;
        if (options.maxPages !== undefined) {
          const n = Number(options.maxPages);
          if (!Number.isInteger(n) || n <= 0) {
            throw new Error(`--max-pages must be a positive integer, got "${options.maxPages}".`);
          }
          maxPages = n;
        }

        let recipes: RecipeId[] | undefined;
        if (options.recipes) {
          const ids = options.recipes.split(',').map((s) => s.trim()).filter(Boolean);
          const parsed = ids.map((id) => RecipeIdSchema.safeParse(id));
          const invalid = parsed.map((p, i) => (!p.success ? ids[i] : null)).filter(Boolean);
          if (invalid.length > 0) {
            throw new Error(`Invalid --recipes value(s): ${invalid.join(', ')}. Supported: auth, a11y, nav, seed.`);
          }
          recipes = parsed.map((p) => (p.success ? p.data : null)).filter(Boolean) as RecipeId[];
        }

        await runScaffold({
          url: options.url,
          framework: parsedFramework.data,
          maxPages,
          out: options.out,
          json: Boolean(options.json),
          recipes,
          validateSpecs: Boolean(options.validateSpecs),
        });
      }
    );
}
