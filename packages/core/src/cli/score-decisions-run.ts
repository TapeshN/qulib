/**
 * `qulib score-decisions` — score pivotal-decision forks from a JSONL file.
 *
 * Reuses the existing `scoreDecisions()` core function (packages/core/src/tools/scoring/score-decisions.ts).
 * That function is the single source of scoring logic; this file is only the CLI surface.
 *
 * Options:
 *   --forks <file.jsonl>   (required) JSONL file, one DecisionFork per line
 *   --json                 Emit the full DecisionScoreResult as JSON to stdout
 *   --enable-llm-judge     Enable LLM refinement (requires ANTHROPIC_API_KEY)
 *   --min-quality <n>      CI gate: exit non-zero when aggregate.meanDecisionQuality < n (0..1)
 *
 * Gate line format: `[qulib] GATE: PASS|FAIL — <reason>` (stderr in --json mode).
 *
 * Mirrors the idiom established by confidence-run.ts: one file owns the command end-to-end
 * and is registered from cli/index.ts via registerScoreDecisionsCommand(program).
 */
import { resolve, dirname } from 'node:path';
import type { Command } from 'commander';
import { scoreDecisions } from '../tools/scoring/score-decisions.js';
import type { DecisionScoreResult } from '../schemas/decision-score.schema.js';

export interface ScoreDecisionsOptions {
  forks: string;
  json?: boolean;
  enableLlmJudge?: boolean;
  minQuality?: number;
}

export interface ScoreDecisionsGateResult {
  requested: boolean;
  passed: boolean;
  reason: string;
}

/**
 * Evaluate the --min-quality CI gate. Pure + side-effect-free.
 */
export function evaluateDecisionsGate(
  result: DecisionScoreResult,
  minQuality?: number
): ScoreDecisionsGateResult {
  const hasGate = typeof minQuality === 'number' && !Number.isNaN(minQuality);
  if (!hasGate) {
    return { requested: false, passed: true, reason: 'no gate requested' };
  }

  const mean = result.aggregate.meanDecisionQuality;
  const passed = mean >= minQuality!;
  return {
    requested: true,
    passed,
    reason: passed
      ? `meanDecisionQuality ${mean} meets --min-quality ${minQuality}`
      : `meanDecisionQuality ${mean} is below --min-quality ${minQuality}`,
  };
}

/** Render the human-friendly report. */
export function formatDecisionsReport(result: DecisionScoreResult): string {
  const lines: string[] = [];
  const { aggregate, scored } = result;

  lines.push(`[qulib] score-decisions — ${aggregate.count} fork(s)`);
  lines.push(`  meanDecisionQuality: ${aggregate.meanDecisionQuality}`);
  lines.push('  byKind:');
  for (const [kind, mean] of Object.entries(aggregate.byKind)) {
    lines.push(`    ${kind}: ${mean}`);
  }

  lines.push('');
  lines.push('  per-fork:');
  for (const f of scored) {
    const senior = f.seniorCorrect ? 'senior-correct' : 'mis-decision';
    lines.push(`    [${f.fork_id}] ${f.fork_kind} — choice="${f.choice}" quality=${f.decisionQuality} ${senior} path=${f.scoringPath}`);
    lines.push(`      ${f.rationale}`);
  }

  return lines.join('\n');
}

export function registerScoreDecisionsCommand(program: Command): void {
  program
    .command('score-decisions')
    .description(
      'Score pivotal-decision forks from a JSONL file. ' +
      'Rates whether an autonomous agent made the senior-correct call at each fork ' +
      '(gate_block_vs_pass, stop_vs_continue, escalate_vs_proceed). ' +
      'Deterministic by default; set --enable-llm-judge to enable LLM refinement (requires ANTHROPIC_API_KEY). ' +
      'Use --min-quality for a CI gate on the aggregate mean decision quality.'
    )
    .requiredOption('--forks <file.jsonl>', 'Path to the JSONL forks file (one DecisionFork per line)')
    .option('--json', 'Emit the full DecisionScoreResult object as JSON to stdout', false)
    .option('--enable-llm-judge', 'Enable LLM refinement of scores (requires ANTHROPIC_API_KEY)', false)
    .option(
      '--min-quality <n>',
      'CI gate: exit non-zero when aggregate meanDecisionQuality is below this threshold (0..1)',
      parseFloat
    )
    .action(
      async (options: {
        forks: string;
        json?: boolean;
        enableLlmJudge?: boolean;
        minQuality?: number;
      }) => {
        // Validate --min-quality range
        if (options.minQuality !== undefined) {
          const n = options.minQuality;
          if (Number.isNaN(n) || n < 0 || n > 1) {
            console.error(
              `[qulib] --min-quality must be a number in [0, 1] (got "${n}"). ` +
              'Example: --min-quality 0.7'
            );
            process.exitCode = 1;
            return;
          }
        }

        const forksPath = resolve(options.forks);
        const enableLlmJudge = Boolean(options.enableLlmJudge);

        let result: DecisionScoreResult;
        try {
          // On the CLI the user owns the path they pass, so root the traversal
          // check at the file's own directory rather than the default (cwd) —
          // otherwise `qulib score-decisions --forks /abs/elsewhere.jsonl` from
          // any other directory is wrongly rejected. The realpath/symlink-escape
          // guard inside validateForksPath still applies to that directory.
          result = await scoreDecisions({ forksPath, enableLlmJudge }, { allowedRoot: dirname(forksPath) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[qulib] score-decisions failed: ${msg}`);
          process.exitCode = 1;
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatDecisionsReport(result));
        }

        const gate = evaluateDecisionsGate(result, options.minQuality);
        if (gate.requested) {
          const line = `[qulib] GATE: ${gate.passed ? 'PASS' : 'FAIL'} — ${gate.reason}`;
          // Keep stdout pure JSON in --json mode; the gate line goes to stderr there.
          if (options.json) console.error(line);
          else console.log(line);
          if (!gate.passed) process.exitCode = 1;
        }
      }
    );
}
