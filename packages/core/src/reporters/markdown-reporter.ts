import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GapAnalysis } from '../schemas/gap-analysis.schema.js';

export async function writeMarkdownReport(analysis: GapAnalysis, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  const recommendation =
    analysis.releaseConfidence >= 80 ? 'READY' :
    analysis.releaseConfidence >= 50 ? 'CONDITIONAL' : 'NOT READY';

  const gapRows = analysis.gaps
    .map((g) => `| ${g.path} | ${g.category} | ${g.severity} | ${g.reason} |`)
    .join('\n');

  const scenarioBlocks = analysis.scenarios
    .map((s) => `### ${s.title}\n${s.description}\n\nSteps:\n${s.steps.map((step) => `- ${step.description}`).join('\n')}\n\nRecommended adapters: ${s.recommendations.map((r) => r.adapter).join(', ')}`)
    .join('\n\n---\n\n');

  const md = `# Quilib Quality Gap Report

**Generated:** ${analysis.analyzedAt}
**Mode:** ${analysis.mode}
**Release confidence:** ${analysis.releaseConfidence}/100 — ${recommendation}

## Coverage

- Pages scanned: ${analysis.coveragePagesScanned}
- Scan budget exhausted (unfinished queue): ${analysis.coverageBudgetExceeded ? 'yes' : 'no'}
${analysis.coverageWarning ? `- Warning: **${analysis.coverageWarning}**` : '- Warning: none'}

## Coverage gaps (${analysis.gaps.length})

| Path | Category | Severity | Reason |
|------|----------|----------|--------|
${gapRows}

## Generated scenarios (${analysis.scenarios.length})

${scenarioBlocks || '_No scenarios generated._'}

## Decision log

See \`.scan-state/decision-log.json\` for the full audit trail.
`;

  const filePath = join(outputDir, 'report.md');
  await writeFile(filePath, md, 'utf-8');
  console.log(`[quilib] Markdown report written to ${filePath}`);
}
