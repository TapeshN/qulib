/**
 * `qulib baseline` — capture and compare quality-gap baselines over time.
 *
 * Surfaces the previously dead-ended baseline module (../baseline/baseline.js) as a
 * first-class CLI. Until now save/load/list/compare existed only as a programmatic API
 * with no consumer; this exposes them so an agent or CI can snapshot a release's gaps
 * and detect drift (new / resolved / severity-changed gaps + confidence delta) between
 * runs.
 *
 * Subcommands:
 *   baseline save     — snapshot a GapAnalysis for a URL. Source the analysis either by
 *                       crawling live (--url alone) or, deterministically, from an
 *                       existing report.json written by `qulib analyze` (--from-report).
 *   baseline list     — list saved baselines for a URL, newest-first.
 *   baseline compare  — diff two baselines (explicit ids, or the two most-recent for a URL).
 *
 * Storage honesty (root design principle — no false confidence):
 *   Baselines persist under <cwd>/.qulib-baselines/<url-slug>/ unless --dir overrides.
 *   `compare` with fewer than two baselines fails with a clear, actionable message
 *   rather than fabricating a delta against nothing.
 *
 * This file owns the `baseline` command group end-to-end and is registered from
 * cli/index.ts via `registerBaselineCommand(program)`, so this command's build never
 * edits the body of index.ts beyond a single additive registration line (mirrors the
 * score-automation / scaffold / confidence convention).
 */
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { z } from 'zod';
import {
  saveBaseline,
  listBaselines,
  loadBaseline,
  compareBaselines,
} from '../baseline/baseline.js';
import type { BaselineSnapshot, BaselineDelta } from '../baseline/baseline.schema.js';
import { GapAnalysisSchema, type GapAnalysis } from '../schemas/gap-analysis.schema.js';
import { analyzeApp } from '../analyze.js';
import type { HarnessConfig } from '../schemas/config.schema.js';

const UrlSchema = z.string().url();

/** Harness config used when `save --url` crawls live (no repo, read-only, no LLM). */
function liveCrawlConfig(): HarnessConfig {
  return {
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
}

/**
 * Read and validate a GapAnalysis from a report.json written by `qulib analyze`.
 * report.json is exactly a serialized GapAnalysis (see reporters/json-reporter.ts),
 * so we parse it through GapAnalysisSchema — fail loudly on a malformed/foreign file
 * rather than baselining garbage.
 */
export async function loadGapAnalysisFromReport(
  reportPath: string,
  cwd: string = process.cwd()
): Promise<GapAnalysis> {
  const abs = resolve(cwd, reportPath);
  let raw: string;
  try {
    raw = await readFile(abs, 'utf8');
  } catch {
    throw new Error(`--from-report path could not be read: ${abs}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`--from-report file is not valid JSON: ${abs}`);
  }
  const result = GapAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `--from-report file is not a valid qulib report.json (GapAnalysis): ${abs}\n` +
        result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n')
    );
  }
  return result.data;
}

export interface BaselineSaveOptions {
  url: string;
  fromReport?: string;
  label?: string;
  dir?: string;
  json?: boolean;
}

/** Render a saved snapshot as a short human line. */
export function formatSavedSnapshot(snap: BaselineSnapshot): string {
  const labelTag = snap.label ? ` "${snap.label}"` : '';
  return (
    `[qulib] Saved baseline ${snap.id}${labelTag}\n` +
    `  url: ${snap.url}\n` +
    `  releaseConfidence: ${snap.releaseConfidence}/100\n` +
    `  gaps: ${snap.gapCount}`
  );
}

/**
 * Core of `baseline save`, factored out so node:test can drive it without a process.
 * Either --from-report (deterministic, reads a real on-disk report.json) or a live
 * crawl of --url. --from-report is preferred for CI/agents that already ran analyze.
 */
export async function runBaselineSave(
  options: BaselineSaveOptions,
  out: (line: string) => void = (line) => console.log(line)
): Promise<BaselineSnapshot> {
  const url = UrlSchema.parse(options.url);

  let analysis: GapAnalysis;
  if (options.fromReport && options.fromReport.trim()) {
    analysis = await loadGapAnalysisFromReport(options.fromReport.trim());
  } else {
    if (!options.json) {
      out(`[qulib] Crawling ${url} to capture a fresh baseline (analyze_app)…`);
    }
    const result = await analyzeApp({
      url,
      writeArtifacts: false,
      config: liveCrawlConfig(),
    });
    analysis = result.gapAnalysis;
  }

  const snapshot = await saveBaseline(analysis, url, {
    ...(options.dir ? { baseDir: resolve(process.cwd(), options.dir) } : {}),
    ...(options.label !== undefined ? { label: options.label } : {}),
  });

  if (options.json) {
    out(JSON.stringify(snapshot, null, 2));
  } else {
    out(formatSavedSnapshot(snapshot));
  }
  return snapshot;
}

export interface BaselineListOptions {
  url: string;
  dir?: string;
  json?: boolean;
}

/** Render a list of snapshots as a human table. */
export function formatBaselineList(url: string, snaps: BaselineSnapshot[]): string {
  if (snaps.length === 0) {
    return `[qulib] No baselines saved for ${url} yet. Run: qulib baseline save --url ${url} --from-report output/report.json`;
  }
  const lines: string[] = [`[qulib] ${snaps.length} baseline(s) for ${url} (newest first):`];
  for (const s of snaps) {
    const labelTag = s.label ? `  "${s.label}"` : '';
    lines.push(`  ${s.id}  —  confidence ${s.releaseConfidence}/100, ${s.gapCount} gap(s)${labelTag}`);
  }
  return lines.join('\n');
}

/** Core of `baseline list`, factored out for direct testing. */
export async function runBaselineList(
  options: BaselineListOptions,
  out: (line: string) => void = (line) => console.log(line)
): Promise<BaselineSnapshot[]> {
  const url = UrlSchema.parse(options.url);
  const snaps = await listBaselines(url, {
    ...(options.dir ? { baseDir: resolve(process.cwd(), options.dir) } : {}),
  });
  if (options.json) {
    out(JSON.stringify(snaps, null, 2));
  } else {
    out(formatBaselineList(url, snaps));
  }
  return snaps;
}

export interface BaselineCompareOptions {
  /** Compare two explicit baseline ids. Takes precedence over --url. */
  from?: string;
  to?: string;
  /** Or: compare the two most-recent baselines for this URL. */
  url?: string;
  dir?: string;
  json?: boolean;
}

/** Render a delta as a human report. */
export function formatBaselineDelta(delta: BaselineDelta): string {
  const lines: string[] = [];
  lines.push(`[qulib] Baseline comparison`);
  lines.push(`  from: ${delta.fromId} (${delta.fromReleaseConfidence}/100)`);
  lines.push(`  to:   ${delta.toId} (${delta.toReleaseConfidence}/100)`);
  lines.push(`  ${delta.summary}`);
  const section = (title: string, items: BaselineDelta['newGaps']): void => {
    if (items.length === 0) return;
    lines.push(`  ${title}:`);
    for (const g of items) {
      lines.push(`    • [${g.severity}] ${g.path} (${g.category}) — ${g.reason}`);
    }
  };
  section('new gaps', delta.newGaps);
  section('resolved gaps', delta.resolvedGaps);
  section('severity changes', delta.severityChanges);
  return lines.join('\n');
}

/**
 * Core of `baseline compare`, factored out for direct testing.
 * Resolution order:
 *   1. --from and --to explicit ids → load both, compare.
 *   2. --url → take the two most-recent baselines (prior = older, current = newest).
 * Fails clearly when fewer than two baselines are available — never invents a delta.
 */
export async function runBaselineCompare(
  options: BaselineCompareOptions,
  out: (line: string) => void = (line) => console.log(line)
): Promise<BaselineDelta> {
  const baseDirOpt = options.dir ? { baseDir: resolve(process.cwd(), options.dir) } : {};

  let prior: BaselineSnapshot;
  let current: BaselineSnapshot;

  if (options.from || options.to) {
    if (!options.from || !options.to) {
      throw new Error('baseline compare with explicit ids requires BOTH --from and --to.');
    }
    prior = await loadBaseline(options.from, baseDirOpt);
    current = await loadBaseline(options.to, baseDirOpt);
  } else if (options.url) {
    const url = UrlSchema.parse(options.url);
    const snaps = await listBaselines(url, baseDirOpt);
    if (snaps.length < 2) {
      throw new Error(
        `baseline compare needs at least two saved baselines for ${url}; found ${snaps.length}. ` +
          `Save another with: qulib baseline save --url ${url} --from-report output/report.json`
      );
    }
    // listBaselines is newest-first: snaps[0] is current, snaps[1] is the prior.
    current = snaps[0];
    prior = snaps[1];
  } else {
    throw new Error('baseline compare requires either --from + --to, or --url.');
  }

  const delta = compareBaselines(prior, current);
  if (options.json) {
    out(JSON.stringify(delta, null, 2));
  } else {
    out(formatBaselineDelta(delta));
  }
  return delta;
}

export function registerBaselineCommand(program: Command): void {
  const baseline = program
    .command('baseline')
    .description(
      'Capture and compare quality-gap baselines over time. Snapshot a release\'s gaps, ' +
        'then diff later runs to surface new / resolved / severity-changed gaps and confidence drift.'
    );

  baseline
    .command('save')
    .description('Save a baseline snapshot for a URL (from a report.json or a fresh live crawl)')
    .requiredOption('--url <url>', 'URL the baseline is keyed to')
    .option(
      '--from-report <path>',
      'Path to a report.json from `qulib analyze` (deterministic, no network). If omitted, the URL is crawled live.'
    )
    .option('--label <label>', 'Optional human label for this snapshot, e.g. before-refactor')
    .option('--dir <path>', 'Baseline storage root (default: <cwd>/.qulib-baselines)')
    .option('--json', 'Emit the saved BaselineSnapshot as JSON to stdout', false)
    .action(async (options: { url: string; fromReport?: string; label?: string; dir?: string; json?: boolean }) => {
      await runBaselineSave({
        url: options.url,
        fromReport: options.fromReport,
        label: options.label,
        dir: options.dir,
        json: Boolean(options.json),
      });
    });

  baseline
    .command('list')
    .description('List saved baselines for a URL, newest first')
    .requiredOption('--url <url>', 'URL whose baselines to list')
    .option('--dir <path>', 'Baseline storage root (default: <cwd>/.qulib-baselines)')
    .option('--json', 'Emit the BaselineSnapshot[] as JSON to stdout', false)
    .action(async (options: { url: string; dir?: string; json?: boolean }) => {
      await runBaselineList({ url: options.url, dir: options.dir, json: Boolean(options.json) });
    });

  baseline
    .command('compare')
    .description('Compare two baselines — pass --from and --to ids, or --url for the two most-recent')
    .option('--from <id>', 'Prior baseline id')
    .option('--to <id>', 'Current baseline id')
    .option('--url <url>', 'Compare the two most-recent baselines for this URL')
    .option('--dir <path>', 'Baseline storage root (default: <cwd>/.qulib-baselines)')
    .option('--json', 'Emit the full BaselineDelta as JSON to stdout', false)
    .action(async (options: { from?: string; to?: string; url?: string; dir?: string; json?: boolean }) => {
      await runBaselineCompare({
        from: options.from,
        to: options.to,
        url: options.url,
        dir: options.dir,
        json: Boolean(options.json),
      });
    });
}
