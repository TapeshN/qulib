import { join } from 'node:path';
import type { HarnessConfig } from '../schemas/config.schema.js';
import type { GapAnalysis } from '../schemas/gap-analysis.schema.js';
import { writeJsonReport } from '../reporters/json-reporter.js';
import { writeMarkdownReport } from '../reporters/markdown-reporter.js';
import { logDecision } from '../harness/decision-logger.js';
import type { RunArtifactsOptions } from '../harness/run-options.js';
import { emitTelemetry } from '../telemetry/emit.js';
import { resolveScanStateBaseDir } from '../harness/state-manager.js';

export async function act(
  analysis: GapAnalysis,
  config: HarnessConfig,
  artifacts: RunArtifactsOptions = { writeArtifacts: true }
): Promise<void> {
  const sessionId = artifacts.telemetrySessionId ?? 'none';
  const reportDir = join(process.cwd(), 'output');
  const logOpts = {
    persist: artifacts.writeArtifacts,
    memory: artifacts.decisionMemory,
    outputDir: config.outputDir,
  };
  const log = artifacts.writeArtifacts ? console.log : console.error;

  emitTelemetry(artifacts.telemetry, 'phase.act.started', sessionId, {
    writeArtifacts: artifacts.writeArtifacts,
  });

  if (artifacts.writeArtifacts) {
    await writeJsonReport(analysis, reportDir);
    await writeMarkdownReport(analysis, reportDir);
  }

  await logDecision(
    {
      timestamp: new Date().toISOString(),
      phase: 'act',
      decision: 'reports-written',
      reason: artifacts.writeArtifacts
        ? `Wrote JSON and Markdown reports to ${reportDir}`
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

  emitTelemetry(artifacts.telemetry, 'phase.act.completed', sessionId, {
    gapCount: analysis.gaps.length,
    wroteReports: artifacts.writeArtifacts,
  });

  log('\n[qulib] Analysis complete');
  log(`  Gaps found:          ${analysis.gaps.length}`);
  log(`  Scenarios generated: ${analysis.scenarios.length}`);
  log(
    `  Release confidence:  ${analysis.releaseConfidence === null ? '— (null)' : `${analysis.releaseConfidence}/100`}`
  );
  if (analysis.costIntelligence?.budgetWarnings.length) {
    log(`  Cost warnings:       ${analysis.costIntelligence.budgetWarnings.length} (see report.md Cost Intelligence)`);
  }

  if (config.requireHumanReview) {
    log('\n[qulib] Human review required before applying any generated output.');
    if (artifacts.writeArtifacts) {
      log('  Reports:   output/report.json and output/report.md');
      log(`  Decisions: ${join(resolveScanStateBaseDir(config.outputDir), 'decision-log.json')}`);
    } else {
      log('  Ephemeral run: inspect JSON printed to stdout (no files written).');
    }
  }
}
