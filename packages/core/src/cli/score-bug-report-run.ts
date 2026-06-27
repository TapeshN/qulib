/**
 * `qulib score-bug-report` — score a learner bug report against a planted-bug target.
 *
 * Reuses the existing `scoreBugReport()` core function (packages/core/src/tools/scoring/bug-report-score.ts).
 * That function is the single source of scoring logic; this file is only the CLI surface.
 *
 * Options:
 *   --input <file.json>   (required) JSON file with shape { "report": {...}, "target": {...} }
 *   --json                Emit the full BugReportScoreResult as JSON to stdout
 *
 * On bad input (wrong shape, missing fields, etc.): prints a friendly one-line error to stderr
 * and exits non-zero. No raw ZodError stack is ever printed.
 *
 * Mirrors the idiom established by confidence-run.ts: one file owns the command end-to-end
 * and is registered from cli/index.ts via registerScoreBugReportCommand(program).
 */
import { resolve } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { scoreBugReport } from '../tools/scoring/bug-report-score.js';
import type { BugReportScoreResult } from '../schemas/bug-report-score.schema.js';

/** Maximum file size accepted for the --input JSON (1 MiB). */
const MAX_INPUT_FILE_BYTES = 1 * 1024 * 1024;

/** Render the human-friendly report. */
export function formatBugReportReport(result: BugReportScoreResult): string {
  const lines: string[] = [];
  lines.push(`[qulib] score-bug-report`);
  lines.push(`  matched:         ${result.matched}`);
  lines.push(`  matchConfidence: ${result.matchConfidence}`);
  lines.push(`  scoringPath:     ${result.scoringPath}`);
  lines.push('  rubric:');
  lines.push(`    coverage: ${result.rubric.coverage}/25`);
  lines.push(`    severity: ${result.rubric.severity}/25`);
  lines.push(`    repro:    ${result.rubric.repro}/25`);
  lines.push(`    evidence: ${result.rubric.evidence}/25`);
  lines.push(`    total:    ${result.rubric.coverage + result.rubric.severity + result.rubric.repro + result.rubric.evidence}/100`);
  lines.push(`  feedback: ${result.feedback}`);
  return lines.join('\n');
}

export function registerScoreBugReportCommand(program: Command): void {
  program
    .command('score-bug-report')
    .description(
      'Score a learner bug report against a planted-bug target. ' +
      'Reads a JSON file with { "report": {...}, "target": {...} } and emits a ' +
      'matched verdict, matchConfidence, 4-part rubric (coverage/severity/repro/evidence), and feedback. ' +
      'Falls back to deterministic scoring when ANTHROPIC_API_KEY is not set.'
    )
    .requiredOption(
      '--input <file.json>',
      'Path to a JSON file with shape { "report": { title, description, steps, severity }, "target": { description, type, severity, expectedBehavior } }'
    )
    .option('--json', 'Emit the full BugReportScoreResult object as JSON to stdout', false)
    .action(
      async (options: { input: string; json?: boolean }) => {
        const inputPath = resolve(options.input);

        // Validate: must be a regular file of sane size
        let fileStat: Awaited<ReturnType<typeof stat>>;
        try {
          fileStat = await stat(inputPath);
        } catch {
          console.error(`[qulib] score-bug-report: cannot access input file: ${inputPath}`);
          process.exitCode = 1;
          return;
        }

        if (!fileStat.isFile()) {
          console.error(`[qulib] score-bug-report: --input must be a regular file: ${inputPath}`);
          process.exitCode = 1;
          return;
        }

        if (fileStat.size > MAX_INPUT_FILE_BYTES) {
          console.error(
            `[qulib] score-bug-report: input file exceeds maximum size ` +
            `(${MAX_INPUT_FILE_BYTES} bytes): ${inputPath}`
          );
          process.exitCode = 1;
          return;
        }

        // Read and parse JSON
        let raw: string;
        try {
          raw = await readFile(inputPath, 'utf8');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[qulib] score-bug-report: failed to read input file: ${msg}`);
          process.exitCode = 1;
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          console.error(
            `[qulib] score-bug-report: input file is not valid JSON. ` +
            'Expected { "report": {...}, "target": {...} }'
          );
          process.exitCode = 1;
          return;
        }

        // Call core function — let schema validation inside it throw on bad shape,
        // but catch and print a friendly one-line error (no raw ZodError stack).
        let result: BugReportScoreResult;
        try {
          result = await scoreBugReport(parsed as Parameters<typeof scoreBugReport>[0]);
        } catch (err) {
          // Extract the human-readable message from ZodError or any other error.
          let msg: string;
          if (err instanceof Error) {
            // ZodError.message is a long multi-line string; collapse it to one line.
            msg = err.message.split('\n')[0];
          } else {
            msg = String(err);
          }
          console.error(
            `[qulib] score-bug-report: invalid input — ${msg}. ` +
            'Expected { "report": { title, description, steps, severity }, ' +
            '"target": { description, type, severity, expectedBehavior } }'
          );
          process.exitCode = 1;
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatBugReportReport(result));
        }
      }
    );
}
