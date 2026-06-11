/**
 * `qulib analyze diff` — structured diff between two analyze_app outputs.
 *
 * Produces a structured report (JSON + Markdown) that compares two GapAnalysis
 * objects (the serialized output of `qulib analyze`): added findings, removed
 * findings, severity changes, and a confidence score delta.
 *
 * The diff is a PURE function of two GapAnalysis objects — no disk state, no
 * network, no LLM. Callers supply paths to report.json files; this module reads
 * them, validates them, and produces the diff.
 *
 * Subcommand:
 *   qulib analyze diff --from <path> --to <path>
 *
 * Flags:
 *   --from <path>   Path to the baseline report.json (the "before" state).
 *   --to <path>     Path to the current report.json (the "after" state).
 *   --json          Emit the AnalyzeDiffResult as JSON to stdout (default: Markdown).
 *   --label-from    Optional human label for the baseline report.
 *   --label-to      Optional human label for the current report.
 *
 * Design rationale:
 *   - Reuses the existing `BaselineDelta` shape and `compareBaselines` logic by
 *     converting GapAnalysis objects to transient BaselineSnapshot objects.
 *     No second format is introduced; the schema is the same.
 *   - The result type `AnalyzeDiffResult` wraps `BaselineDelta` with the source
 *     report metadata (analyzedAt, path labels) for full provenance.
 *   - `analyzeRunDiff` is factored out as a pure function so it is testable and
 *     importable without the CLI layer (follows the baseline-run.ts convention).
 *
 * Registered from cli/index.ts via `registerAnalyzeDiffCommand(program)` so this
 * command never edits index.ts beyond a single additive registration line.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import type { GapAnalysis } from '../schemas/gap-analysis.schema.js';
import { GapAnalysisSchema } from '../schemas/gap-analysis.schema.js';
import { compareBaselines } from '../baseline/baseline.js';
import type { BaselineDelta, BaselineDeltaItem } from '../baseline/baseline.schema.js';
import type { BaselineSnapshot } from '../baseline/baseline.schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The structured result of diffing two analyze_app outputs.
 * Wraps `BaselineDelta` with source provenance (file labels, timestamps).
 */
export interface AnalyzeDiffResult {
  /** Human label for the "before" report (path by default). */
  fromLabel: string;
  /** Human label for the "after" report (path by default). */
  toLabel: string;
  /** ISO timestamp from the "before" report's analyzedAt field. */
  fromAnalyzedAt: string;
  /** ISO timestamp from the "after" report's analyzedAt field. */
  toAnalyzedAt: string;
  /** Release confidence from the "before" report (0–100, or null). */
  fromReleaseConfidence: number | null;
  /** Release confidence from the "after" report (0–100, or null). */
  toReleaseConfidence: number | null;
  /** Numeric delta: toReleaseConfidence − fromReleaseConfidence. Null if either is null. */
  confidenceDelta: number | null;
  /** Direction of the confidence delta. */
  direction: 'improved' | 'regressed' | 'unchanged' | 'unknown';
  /** Findings present in "to" that were absent in "from" (new regressions). */
  added: BaselineDeltaItem[];
  /** Findings present in "from" that are absent in "to" (resolved issues). */
  removed: BaselineDeltaItem[];
  /** Same finding (path + category) with a changed severity between the two reports. */
  changed: BaselineDeltaItem[];
  /** One-line human summary. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Pure diff function
// ---------------------------------------------------------------------------

/**
 * Stable key used to match gaps between two reports.
 * Same key as compareBaselines: path + category identifies the same problem.
 */
function gapKey(path: string, category: string): string {
  return `${path}|||${category}`;
}

/**
 * Convert a GapAnalysis to a minimal BaselineSnapshot shape for reuse with
 * compareBaselines. The `id` and `savedAt` fields are synthetic — we use
 * `analyzedAt` for temporal ordering. `url` is left as an empty string since
 * this path does not require URL-keyed baseline storage.
 */
function toTransientSnapshot(analysis: GapAnalysis, id: string): BaselineSnapshot {
  const confidence = analysis.releaseConfidence ?? 0;
  return {
    id,
    url: '',
    savedAt: analysis.analyzedAt,
    releaseConfidence: confidence,
    gapCount: analysis.gaps.length,
    gaps: analysis.gaps.map((g) => ({
      path: g.path,
      severity: g.severity,
      category: g.category,
      reason: g.reason,
    })),
  };
}

/**
 * Pure function: diff two GapAnalysis objects.
 *
 * Does NOT read files, make network requests, or touch disk. Both inputs must
 * already be validated GapAnalysis objects.
 *
 * @param from  The "before" (baseline) analysis.
 * @param to    The "after" (current) analysis.
 * @param opts  Optional labels for provenance metadata.
 */
export function analyzeRunDiff(
  from: GapAnalysis,
  to: GapAnalysis,
  opts: { fromLabel?: string; toLabel?: string } = {}
): AnalyzeDiffResult {
  const fromLabel = opts.fromLabel ?? 'from';
  const toLabel = opts.toLabel ?? 'to';

  const priorSnap = toTransientSnapshot(from, 'from');
  const currentSnap = toTransientSnapshot(to, 'to');

  const delta: BaselineDelta = compareBaselines(priorSnap, currentSnap);

  const fromConf = from.releaseConfidence;
  const toConf = to.releaseConfidence;
  const confidenceDelta =
    fromConf !== null && toConf !== null ? toConf - fromConf : null;

  let direction: AnalyzeDiffResult['direction'] = 'unknown';
  if (confidenceDelta !== null) {
    direction = confidenceDelta > 0 ? 'improved' : confidenceDelta < 0 ? 'regressed' : 'unchanged';
  }

  // Build a richer summary that covers the null-confidence case.
  const confLine =
    fromConf !== null && toConf !== null
      ? `Confidence ${direction} (${fromConf} → ${toConf})`
      : 'Confidence unavailable in one or both reports';
  const summaryParts = [
    confLine,
    delta.newGaps.length > 0 ? `${delta.newGaps.length} added finding(s)` : '',
    delta.resolvedGaps.length > 0 ? `${delta.resolvedGaps.length} removed finding(s)` : '',
    delta.severityChanges.length > 0 ? `${delta.severityChanges.length} severity change(s)` : '',
  ].filter(Boolean);

  return {
    fromLabel,
    toLabel,
    fromAnalyzedAt: from.analyzedAt,
    toAnalyzedAt: to.analyzedAt,
    fromReleaseConfidence: fromConf,
    toReleaseConfidence: toConf,
    confidenceDelta,
    direction,
    added: delta.newGaps,
    removed: delta.resolvedGaps,
    changed: delta.severityChanges,
    summary: summaryParts.join(', '),
  };
}

// ---------------------------------------------------------------------------
// File loader
// ---------------------------------------------------------------------------

/**
 * Read and validate a GapAnalysis from a report.json file path.
 * Fails loudly on a missing/malformed/foreign file rather than diffing garbage.
 */
export async function loadGapAnalysisFile(
  filePath: string,
  cwd: string = process.cwd()
): Promise<GapAnalysis> {
  const abs = resolve(cwd, filePath);
  let raw: string;
  try {
    raw = await readFile(abs, 'utf8');
  } catch {
    throw new Error(`analyze diff: could not read file: ${abs}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`analyze diff: file is not valid JSON: ${abs}`);
  }
  const result = GapAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `analyze diff: file is not a valid qulib report.json (GapAnalysis): ${abs}\n` +
        result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n')
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// CLI orchestration
// ---------------------------------------------------------------------------

export interface AnalyzeDiffOptions {
  from: string;
  to: string;
  labelFrom?: string;
  labelTo?: string;
  json?: boolean;
}

/**
 * Core of `analyze diff`, factored out for direct testing.
 * Loads both files, validates them, diffs them, and emits the result.
 */
export async function runAnalyzeDiff(
  options: AnalyzeDiffOptions,
  out: (line: string) => void = (line) => console.log(line)
): Promise<AnalyzeDiffResult> {
  const fromAnalysis = await loadGapAnalysisFile(options.from);
  const toAnalysis = await loadGapAnalysisFile(options.to);

  const result = analyzeRunDiff(fromAnalysis, toAnalysis, {
    fromLabel: options.labelFrom ?? options.from,
    toLabel: options.labelTo ?? options.to,
  });

  if (options.json) {
    out(JSON.stringify(result, null, 2));
  } else {
    out(formatAnalyzeDiffMarkdown(result));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
};

function severityTag(severity: string): string {
  return `${SEVERITY_EMOJI[severity] ?? ''} **${severity}**`.trim();
}

function renderDeltaTable(items: BaselineDeltaItem[]): string {
  if (items.length === 0) return '_none_';
  const rows = items.map(
    (i) =>
      `| ${i.path} | ${i.category} | ${severityTag(i.severity)} | ${i.reason} |`
  );
  return [
    '| Path | Category | Severity | Reason |',
    '|------|----------|----------|--------|',
    ...rows,
  ].join('\n');
}

/**
 * Render an AnalyzeDiffResult as a human-readable Markdown report.
 *
 * The report is structured for readability in CI logs, GitHub PR comments, and
 * terminal output. It covers:
 *   - Header with report labels and timestamps
 *   - Confidence score delta with direction indicator
 *   - Added / Removed / Changed findings as tables
 *   - One-line summary
 */
export function formatAnalyzeDiffMarkdown(result: AnalyzeDiffResult): string {
  const lines: string[] = [];

  lines.push('## qulib analyze diff');
  lines.push('');
  lines.push(`| | Report |`);
  lines.push(`|---|---|`);
  lines.push(`| **From** | ${result.fromLabel} (${result.fromAnalyzedAt}) |`);
  lines.push(`| **To** | ${result.toLabel} (${result.toAnalyzedAt}) |`);
  lines.push('');

  // Confidence delta
  lines.push('### Release Confidence');
  if (result.fromReleaseConfidence !== null && result.toReleaseConfidence !== null) {
    const delta = result.confidenceDelta!;
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
    const sign = delta > 0 ? '+' : '';
    lines.push(
      `${result.fromReleaseConfidence}/100 ${arrow} ${result.toReleaseConfidence}/100 ` +
        `(${sign}${delta}) — **${result.direction}**`
    );
  } else {
    lines.push('_Confidence unavailable in one or both reports._');
  }
  lines.push('');

  // Added findings
  lines.push(`### Added Findings (${result.added.length})`);
  lines.push('');
  lines.push(renderDeltaTable(result.added));
  lines.push('');

  // Removed findings
  lines.push(`### Removed Findings (${result.removed.length})`);
  lines.push('');
  lines.push(renderDeltaTable(result.removed));
  lines.push('');

  // Changed severity
  lines.push(`### Severity Changes (${result.changed.length})`);
  lines.push('');
  lines.push(renderDeltaTable(result.changed));
  lines.push('');

  lines.push(`---`);
  lines.push(`_${result.summary}_`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI registration
// ---------------------------------------------------------------------------

export function registerAnalyzeDiffCommand(program: Command): void {
  // Nest `diff` under the existing (or new) `analyze` group.
  // Commander allows a subcommand under a top-level command; the analyze command
  // already exists in index.ts as a `program.command('analyze')` — we add a peer
  // group `analyze-diff` to avoid colliding with the top-level `analyze` action.
  // The user-facing name is `qulib analyze-diff` to keep wiring simple.
  program
    .command('analyze-diff')
    .description(
      'Diff two analyze_app report.json outputs — surface added / removed / changed findings and confidence delta'
    )
    .requiredOption('--from <path>', 'Path to the baseline report.json ("before")')
    .requiredOption('--to <path>', 'Path to the current report.json ("after")')
    .option('--label-from <label>', 'Human label for the baseline report (default: the file path)')
    .option('--label-to <label>', 'Human label for the current report (default: the file path)')
    .option('--json', 'Emit the AnalyzeDiffResult as JSON to stdout (default: Markdown)', false)
    .action(
      async (options: {
        from: string;
        to: string;
        labelFrom?: string;
        labelTo?: string;
        json?: boolean;
      }) => {
        await runAnalyzeDiff({
          from: options.from,
          to: options.to,
          labelFrom: options.labelFrom,
          labelTo: options.labelTo,
          json: Boolean(options.json),
        });
      }
    );
}
