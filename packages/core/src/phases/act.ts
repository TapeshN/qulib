import { join } from 'node:path';
import type { HarnessConfig } from '../schemas/config.schema.js';
import type { GapAnalysis } from '../schemas/gap-analysis.schema.js';
import { writeJsonReport } from '../reporters/json-reporter.js';
import { writeMarkdownReport } from '../reporters/markdown-reporter.js';
import { logDecision } from '../harness/decision-logger.js';
import type { RunArtifactsOptions } from '../harness/run-options.js';

export async function act(
  analysis: GapAnalysis,
  config: HarnessConfig,
  artifacts: RunArtifactsOptions = { writeArtifacts: true }
): Promise<void> {
  const outputDir = join(process.cwd(), 'output');
  const logOpts = { persist: artifacts.writeArtifacts, memory: artifacts.decisionMemory };
  const log = artifacts.writeArtifacts ? console.log : console.error;

  if (artifacts.writeArtifacts) {
    await writeJsonReport(analysis, outputDir);
    await writeMarkdownReport(analysis, outputDir);
  }

  await logDecision(
    {
      timestamp: new Date().toISOString(),
      phase: 'act',
      decision: 'reports-written',
      reason: artifacts.writeArtifacts
        ? `Wrote JSON and Markdown reports to ${outputDir}`
        : 'Skipped writing reports (ephemeral run)',
      metadata: {
        gapCount: analysis.gaps.length,
        scenarioCount: analysis.scenarios.length,
        releaseConfidence: analysis.releaseConfidence,
        requireHumanReview: config.requireHumanReview,
      },
    },
    logOpts
  );

  log('\n[qulib] Analysis complete');
  log(`  Gaps found:          ${analysis.gaps.length}`);
  log(`  Scenarios generated: ${analysis.scenarios.length}`);
  log(`  Release confidence:  ${analysis.releaseConfidence}/100`);
  if (analysis.costIntelligence?.budgetWarnings.length) {
    log(`  Cost warnings:       ${analysis.costIntelligence.budgetWarnings.length} (see report.md Cost Intelligence)`);
  }

  if (config.requireHumanReview) {
    log('\n[qulib] Human review required before applying any generated output.');
    if (artifacts.writeArtifacts) {
      log('  Reports:   output/report.json and output/report.md');
      log('  Decisions: .scan-state/decision-log.json');
    } else {
      log('  Ephemeral run: inspect JSON printed to stdout (no files written).');
    }
  }
}
