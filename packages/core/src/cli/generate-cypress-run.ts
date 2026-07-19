/**
 * `qulib generate-cypress` — turn a directory of Recorder journey JSON files
 * into a deterministic Cypress suite (one `.cy.ts` per journey).
 *
 * Wraps `generateCypressSuiteFromDir` (tools/journeys/generate-cypress-suite.ts).
 * Registered from cli/index.ts via `registerGenerateCypressCommand(program)`.
 *
 * Options:
 *   --journeys <dir>   Input directory of `*.json` Recorder flows (required)
 *   --out <dir>        Output directory for generated `.cy.ts` specs (required)
 *   --json             Emit a summary JSON object on stdout instead of the human report
 */
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { Command } from 'commander';
import {
  generateCypressSuiteFromDir,
  type GenerateCypressSuiteResult,
} from '../tools/journeys/generate-cypress-suite.js';

export interface GenerateCypressOptions {
  journeys: string;
  out: string;
  json?: boolean;
}

function resolveDir(option: string, flag: string, cwd: string = process.cwd()): string {
  if (!option || !option.trim()) {
    throw new Error(`generate-cypress requires ${flag} <dir>`);
  }
  const abs = resolve(cwd, option.trim());
  if (!existsSync(abs)) {
    throw new Error(`${flag} path does not exist: ${abs}`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new Error(`${flag} path is not a directory: ${abs}`);
  }
  return abs;
}

/** Resolve --out even when the directory does not exist yet (it will be created). */
function resolveOutDir(option: string, cwd: string = process.cwd()): string {
  if (!option || !option.trim()) {
    throw new Error('generate-cypress requires --out <dir>');
  }
  const abs = resolve(cwd, option.trim());
  if (existsSync(abs) && !statSync(abs).isDirectory()) {
    throw new Error(`--out path exists and is not a directory: ${abs}`);
  }
  return abs;
}

export function formatGenerateCypressReport(
  result: GenerateCypressSuiteResult,
  outDir: string
): string {
  const lines: string[] = [];
  lines.push(`[qulib] generate-cypress → ${outDir}`);
  lines.push(`  specs written: ${result.specs.length}`);
  for (const spec of result.specs) {
    lines.push(`    • ${spec.filename} (${spec.journeyId})`);
  }
  if (result.skipped.length > 0) {
    lines.push(`  skipped: ${result.skipped.length}`);
    for (const s of result.skipped) {
      lines.push(`    • ${s.source}: ${s.reason}`);
    }
  }
  return lines.join('\n');
}

export async function runGenerateCypress(
  options: GenerateCypressOptions,
  out: (line: string) => void = (line) => console.log(line)
): Promise<GenerateCypressSuiteResult> {
  const journeysDir = resolveDir(options.journeys, '--journeys');
  const outDir = resolveOutDir(options.out);
  const result = await generateCypressSuiteFromDir(journeysDir, outDir);

  if (options.json) {
    out(
      JSON.stringify(
        {
          out: outDir,
          specs: result.specs.map((s) => ({
            journeyId: s.journeyId,
            filename: s.filename,
            relativePath: s.relativePath,
            warnings: s.warnings,
          })),
          skipped: result.skipped,
        },
        null,
        2
      )
    );
  } else {
    out(formatGenerateCypressReport(result, outDir));
  }
  return result;
}

export function registerGenerateCypressCommand(program: Command): void {
  program
    .command('generate-cypress')
    .description(
      'Generate a deterministic Cypress suite from a directory of Chrome DevTools Recorder journey JSON files ' +
        '(one .cy.ts per journey; describe titles annotated with @smoke/@regression from journey tags)'
    )
    .requiredOption('--journeys <dir>', 'Directory containing Recorder journey *.json files')
    .requiredOption('--out <dir>', 'Output directory for generated .cy.ts specs')
    .option('--json', 'Emit a machine-readable summary JSON on stdout', false)
    .action(async (options: { journeys: string; out: string; json?: boolean }) => {
      await runGenerateCypress({
        journeys: options.journeys,
        out: options.out,
        json: Boolean(options.json),
      });
    });
}
