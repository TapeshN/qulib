/**
 * `qulib confidence` — compute a fused Release Confidence verdict from qulib's own collectors.
 *
 * P3 — qulib Confidence Layer v1.
 *
 * Composes analyze_app (when --url is given) + computeAutomationMaturity + computeApiCoverage
 * (when --repo is given) through buildConfidenceInputFromQulib → computeReleaseConfidence.
 *
 * The --json flag emits the full ReleaseConfidence object as JSON to stdout (for CI gates and
 * orchestrators). Without --json, a human-readable report is printed.
 *
 * Mirrors the idiom established by score-automation-run.ts: one file owns the command end-to-end
 * and is registered from cli/index.ts via registerConfidenceCommand(program).
 */
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { Command } from 'commander';
import { analyzeApp } from '../analyze.js';
import { scanRepo } from '../tools/repo/scan.js';
import { computeAutomationMaturity } from '../tools/scoring/automation-maturity.js';
import { discoverApiSurfaceWithRepo } from '../tools/repo/api-surface.js';
import { computeApiCoverage } from '../tools/scoring/api-coverage.js';
import { buildConfidenceInputFromQulib } from '../tools/scoring/confidence-from-qulib.js';
import { computeReleaseConfidence } from '../tools/scoring/confidence.js';
import type { ReleaseConfidence } from '../schemas/confidence.schema.js';
import type { HarnessConfig } from '../schemas/config.schema.js';

export interface ConfidenceOptions {
  url?: string;
  repo?: string;
  json?: boolean;
}

/**
 * Resolve and validate an optional --repo path. Returns null if none was provided.
 */
function maybeResolveRepoPath(repoOption: string | undefined, cwd: string = process.cwd()): string | null {
  if (!repoOption || !repoOption.trim()) return null;
  const abs = resolve(cwd, repoOption.trim());
  if (!existsSync(abs)) {
    throw new Error(`--repo path does not exist: ${abs}`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new Error(`--repo path is not a directory: ${abs}`);
  }
  return abs;
}

/** Render the human-friendly report for a ReleaseConfidence result. */
export function formatConfidenceReport(rc: ReleaseConfidence, subjectRef: string): string {
  const lines: string[] = [];
  const scoreStr = rc.confidenceScore !== null ? `${rc.confidenceScore}/100` : 'null (nothing evaluable)';
  lines.push(`[qulib] Release confidence for ${subjectRef}`);
  lines.push(`  verdict: ${rc.verdict}  —  ${rc.label} (score ${scoreStr}, level ${rc.level}/5)`);

  if (rc.blockers.length > 0) {
    lines.push('  blockers:');
    for (const b of rc.blockers) lines.push(`    • ${b}`);
  }

  if (rc.honestyNotes.length > 0) {
    lines.push('  honesty notes:');
    for (const n of rc.honestyNotes) lines.push(`    • ${n}`);
  }

  lines.push('  contributions:');
  for (const c of rc.contributions) {
    const scoreLabel = c.score !== null ? `${c.score}/100` : 'n/a';
    const ewLabel = c.effectiveWeight > 0
      ? `ew=${(c.effectiveWeight * 100).toFixed(1)}%`
      : 'excluded';
    const blockingTag = c.blocking ? ' [BLOCKER]' : '';
    lines.push(
      `    - ${c.source} [${c.applicability}]${blockingTag}: ${scoreLabel}  ${ewLabel}`
    );
  }

  if (rc.topRisks.length > 0) {
    lines.push('  top risks:');
    for (const r of rc.topRisks) lines.push(`    • ${r}`);
  }

  if (rc.recommendedNextChecks.length > 0) {
    lines.push('  recommended next checks:');
    for (const r of rc.recommendedNextChecks) lines.push(`    • ${r}`);
  }

  return lines.join('\n');
}

/**
 * Core of the command, factored out of the action handler so node:test can drive it
 * without spawning a subprocess.
 */
export async function runConfidence(
  options: ConfidenceOptions,
  out: (line: string) => void = (line) => console.log(line)
): Promise<ReleaseConfidence> {
  if (!options.url && !options.repo) {
    throw new Error('qulib confidence requires at least one of --url or --repo.');
  }

  const repoPath = maybeResolveRepoPath(options.repo);
  const subjectRef = options.url ?? repoPath ?? 'unknown';
  const subjectKind = options.url && repoPath ? 'release' : options.url ? 'app' : 'repo';
  const subject = { kind: subjectKind as 'release' | 'app' | 'repo', ref: subjectRef, tenantId: 'default' };

  let analyzeResult: Awaited<ReturnType<typeof analyzeApp>> | undefined;
  let maturityResult: Awaited<ReturnType<typeof computeAutomationMaturity>> | undefined;
  let apiCoverageResult: Awaited<ReturnType<typeof computeApiCoverage>> | undefined;

  if (options.url) {
    if (!options.json) {
      out(`[qulib] Analyzing ${options.url} (analyze_app)…`);
    }
    const harnessConfig: HarnessConfig = {
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
    analyzeResult = await analyzeApp({
      url: options.url,
      writeArtifacts: false,
      config: harnessConfig,
    });
  }

  if (repoPath) {
    if (!options.json) {
      out(`[qulib] Scoring automation maturity + API coverage for ${repoPath}…`);
    }
    const repo = await scanRepo(repoPath);
    maturityResult = computeAutomationMaturity(repo);
    const apiSurface = await discoverApiSurfaceWithRepo(repoPath, repo, { enableTier3: false });
    apiCoverageResult = computeApiCoverage(repo, apiSurface);
  }

  const confidenceInput = buildConfidenceInputFromQulib({
    analyze: analyzeResult,
    maturity: maturityResult,
    apiCoverage: apiCoverageResult,
    subject,
  });

  const rc = computeReleaseConfidence(confidenceInput);

  if (options.json) {
    out(JSON.stringify(rc, null, 2));
  } else {
    out(formatConfidenceReport(rc, subjectRef));
  }

  return rc;
}

export function registerConfidenceCommand(program: Command): void {
  // Canonical flagship command. Alias: release-confidence (for integrations that prefer the
  // full concept name over the short form). Both names are kept through 1.0.
  program
    .command('confidence')
    .alias('release-confidence')
    .description(
      'Compute a fused Release Confidence verdict from qulib evidence collectors. ' +
      'Pass --url to include live-app quality + a11y + coverage evidence. ' +
      'Pass --repo to include test-automation maturity + API coverage. ' +
      'Both may be combined. ' +
      '(Alias: release-confidence)'
    )
    .option('--url <url>', 'URL of the deployed app to analyze')
    .option('--repo <path>', 'Path to the local repository to score')
    .option('--json', 'Emit the full ReleaseConfidence object as JSON to stdout', false)
    .action(async (options: { url?: string; repo?: string; json?: boolean }) => {
      await runConfidence({
        url: options.url,
        repo: options.repo,
        json: Boolean(options.json),
      });
    });
}
