/**
 * `qulib score-automation` — score a local repo's test-automation maturity.
 *
 * Wraps `computeAutomationMaturity(repo)` (../tools/scoring/automation-maturity.js)
 * as a first-class CLI surface. Until now the maturity score was only produced as a
 * side-effect of `analyze --repo`; this exposes it standalone so an agent or CI can
 * score a repo's automation directly, without a deployed URL to crawl.
 *
 * How a RepoAnalysis is obtained (smallest honest path, no duplicated logic):
 *   `scanRepo(repoPath)` (../tools/repo/scan.js) is a pure static scan — it infers
 *   routes, test files, test-id hygiene, CI presence and Cypress structure straight
 *   from the repo layout, with no browser/URL dependency. We reuse it (root CLAUDE.md:
 *   shared logic lives in core, never duplicate) and then call computeAutomationMaturity
 *   on its result so the printed report reflects a freshly-computed maturity object.
 *
 * Output honesty (root design principle — no false confidence):
 *   Per-dimension applicability (`applicable | not_applicable | unknown`) is surfaced
 *   verbatim. A `not_applicable` or `unknown` dimension reads as honest uncertainty
 *   with its reason/guidance — it is NEVER rendered as a "0/100" that looks like a
 *   real failing score. The overall score is normalized over applicable dimensions
 *   only (see computeAutomationMaturity), so absent capabilities don't drag it down.
 *
 * This file owns the `score-automation` subcommand end-to-end and is registered from
 * cli/index.ts via `registerScoreAutomationCommand(program)`, so this command's build
 * never edits index.ts (avoids collision with the parallel scaffold command).
 */
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { Command } from 'commander';
import type {
  AutomationMaturity,
  AutomationMaturityDimension,
} from '../schemas/automation-maturity.schema.js';
import { scanRepo } from '../tools/repo/scan.js';
import { computeAutomationMaturity } from '../tools/scoring/automation-maturity.js';

export interface ScoreAutomationOptions {
  /** Path to the local repo to score (required). */
  repo: string;
  /** Emit the full AutomationMaturity object as JSON to stdout instead of the human report. */
  json?: boolean;
}

/**
 * Resolve `--repo` to an absolute path and assert it is an existing directory.
 * Fails fast with a clear, actionable message rather than letting glob silently
 * scan nothing and report a falsely-confident "everything is uncovered" score.
 */
export function resolveRepoPath(repoOption: string | undefined, cwd: string = process.cwd()): string {
  if (!repoOption || !repoOption.trim()) {
    throw new Error('score-automation requires --repo <path> pointing at a local repository to score.');
  }
  const abs = resolve(cwd, repoOption.trim());
  if (!existsSync(abs)) {
    throw new Error(`--repo path does not exist: ${abs}`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new Error(`--repo path is not a directory: ${abs}`);
  }
  return abs;
}

/** Single-letter glyph + word for a dimension's applicability, for the human report. */
function applicabilityTag(dim: AutomationMaturityDimension): string {
  const applicability = dim.applicability ?? 'applicable';
  switch (applicability) {
    case 'not_applicable':
      return 'n/a';
    case 'unknown':
      return 'unknown';
    default:
      return 'applicable';
  }
}

/**
 * Render one dimension line. For applicable dimensions we show the score; for
 * not_applicable / unknown we show the word and the reason — NOT a misleading "0".
 */
function formatDimensionLine(dim: AutomationMaturityDimension): string {
  const applicability = dim.applicability ?? 'applicable';
  const weightPct = `${Math.round(dim.weight * 100)}%`;
  const head = `  - ${dim.dimension} [w=${weightPct}]`;
  if (applicability === 'applicable') {
    return `${head}: ${dim.score}/100`;
  }
  // Honest-uncertainty rendering: surface the label + reason, never a bare 0.
  const reason = dim.reason ? ` — ${dim.reason}` : '';
  return `${head}: ${applicabilityTag(dim)} (excluded from overall)${reason}`;
}

/** Build the human-readable report as a single string (kept pure so tests can assert on it). */
export function formatHumanReport(maturity: AutomationMaturity): string {
  const lines: string[] = [];
  lines.push(`[qulib] Automation maturity for ${maturity.repoPath}`);
  lines.push(`  overall: ${maturity.overallScore}/100  —  ${maturity.label} (level ${maturity.level})`);
  lines.push('  dimensions:');
  for (const dim of maturity.dimensions) {
    lines.push(formatDimensionLine(dim));
  }
  if (maturity.topRecommendations.length > 0) {
    lines.push('  top recommendations:');
    for (const rec of maturity.topRecommendations) {
      lines.push(`    • ${rec}`);
    }
  } else {
    lines.push('  top recommendations: none — applicable dimensions are at/above target.');
  }
  return lines.join('\n');
}

/**
 * Core of the command, factored out of the action handler so node:test can drive it
 * directly against a fixture repo without spawning a process.
 *
 * Reuses scanRepo (static repo intelligence) then computes maturity explicitly.
 */
export async function runScoreAutomation(
  options: ScoreAutomationOptions,
  out: (line: string) => void = (line) => console.log(line)
): Promise<AutomationMaturity> {
  const repoPath = resolveRepoPath(options.repo);
  const repo = await scanRepo(repoPath);
  const maturity = computeAutomationMaturity(repo);

  if (options.json) {
    out(JSON.stringify(maturity, null, 2));
  } else {
    out(formatHumanReport(maturity));
  }
  return maturity;
}

export function registerScoreAutomationCommand(program: Command): void {
  // Canonical name kept for backwards compatibility. Alias: automation-score
  // (confidence-family naming — shorter and consistent with the qulib_ MCP convention).
  program
    .command('score-automation')
    .alias('automation-score')
    .description(
      "Score a local repo's test-automation maturity (overall + per-dimension, with honest applicability). " +
      '(Alias: automation-score)'
    )
    .requiredOption('--repo <path>', 'Path to the local repository to score')
    .option('--json', 'Emit the full AutomationMaturity object as JSON to stdout', false)
    .action(async (options: { repo: string; json?: boolean }) => {
      await runScoreAutomation({ repo: options.repo, json: Boolean(options.json) });
    });
}
