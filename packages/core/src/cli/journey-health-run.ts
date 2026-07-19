/**
 * `qulib journey-health` — parse a Cypress run results JSON fixture into a
 * journey health-score artifact `{ score, perJourney }`.
 *
 * Wraps `computeJourneyHealthScore` (tools/scoring/journey-health-score.ts).
 * No live browser run, no network, no DB — fixture file in, JSON artifact out.
 *
 * Options:
 *   --results <file.json>   Cypress mocha-json (or nested suites) results file
 *   --out <file.json>       Optional path to write the artifact (also printed)
 *   --json                  Always true for the artifact; kept for CLI consistency
 */
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import { computeJourneyHealthScore } from '../tools/scoring/journey-health-score.js';
import type { JourneyHealthScore } from '../schemas/journey-health.schema.js';

/** Maximum Cypress results fixture size (10 MiB) — trust-boundary size cap. */
const MAX_RESULTS_FILE_BYTES = 10 * 1024 * 1024;

export interface JourneyHealthOptions {
  results: string;
  out?: string;
}

function resolveResultsFile(option: string, cwd: string = process.cwd()): string {
  if (!option || !option.trim()) {
    throw new Error('journey-health requires --results <file.json>');
  }
  const abs = resolve(cwd, option.trim());
  if (!existsSync(abs)) {
    throw new Error(`--results path does not exist: ${abs}`);
  }
  const st = statSync(abs);
  if (!st.isFile()) {
    throw new Error(`--results path is not a file: ${abs}`);
  }
  if (st.size > MAX_RESULTS_FILE_BYTES) {
    throw new Error(
      `--results file exceeds maximum size (${MAX_RESULTS_FILE_BYTES} bytes): ${abs}`
    );
  }
  return abs;
}

export async function runJourneyHealth(
  options: JourneyHealthOptions,
  out: (line: string) => void = (line) => console.log(line)
): Promise<JourneyHealthScore> {
  const resultsPath = resolveResultsFile(options.results);
  let text: string;
  try {
    text = await readFile(resultsPath, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read --results file: ${msg}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`--results file is not valid JSON: ${msg}`);
  }

  const artifact = computeJourneyHealthScore(raw);
  const serialized = JSON.stringify(artifact, null, 2) + '\n';

  if (options.out && options.out.trim()) {
    const outPath = resolve(process.cwd(), options.out.trim());
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, serialized, 'utf8');
  }

  out(serialized.trimEnd());
  return artifact;
}

export function registerJourneyHealthCommand(program: Command): void {
  program
    .command('journey-health')
    .description(
      'Parse a Cypress run results JSON file into a journey health-score artifact ' +
        '{ score: 0-100, perJourney: [{ id, passed, failed }] }. Fixture-driven — no live browser run.'
    )
    .requiredOption('--results <file.json>', 'Path to a Cypress mocha-json (or nested) results fixture')
    .option('--out <file.json>', 'Optional path to write the health-score artifact JSON')
    .action(async (options: { results: string; out?: string }) => {
      await runJourneyHealth({ results: options.results, out: options.out });
    });
}
