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

  const ci = analysis.costIntelligence;
  const costSection = ci
    ? `## Cost Intelligence

- **Per-completion LLM output ceiling:** ${ci.maxOutputTokensPerLlmCall} (${ci.budgetRole.replace(/-/g, ' ')})
- **Meaning:** this caps **one** model completion per scenario-generation call; it is **not** a multi-step or multi-run token budget.
- **Usage (this run):** input ${ci.usageSummary.totalInputTokens}, output ${ci.usageSummary.totalOutputTokens} tokens — _${ci.usageSummary.dataQuality}_
- **Budget warnings:** ${ci.budgetWarnings.length ? ci.budgetWarnings.map((w) => `\n  - ${w}`).join('') : '_none_'}
- **Repeated AI patterns:** ${ci.repeatedOperations.length ? ci.repeatedOperations.map((r) => `\n  - \`${r.promptHash}\` ×${r.count}: ${r.recommendation}`).join('') : '_none detected in this run_'}
- **Deterministic maturity:** **${ci.deterministicMaturity.label}** (level ${ci.deterministicMaturity.level}/5) — ${ci.deterministicMaturity.rationale}${ci.deterministicMaturity.ceilingNote ? `\n  - _${ci.deterministicMaturity.ceilingNote}_` : ''}
- **Conversion recommendations:**${ci.conversionRecommendations.length ? ci.conversionRecommendations.map((c) => `\n  - ${c}`).join('') : '\n  - _none_'}
`
    : '';

  const md = `# Qulib Quality Gap Report

**Generated:** ${analysis.analyzedAt}
**Mode:** ${analysis.mode}
**Release confidence:** ${analysis.releaseConfidence}/100 — ${recommendation}

## Coverage

- Pages scanned: ${analysis.coveragePagesScanned}
- Scan budget exhausted (unfinished queue): ${analysis.coverageBudgetExceeded ? 'yes' : 'no'}
${analysis.coverageWarning ? `- Warning: **${analysis.coverageWarning}**` : '- Warning: none'}

${costSection}
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
  console.log(`[qulib] Markdown report written to ${filePath}`);
}
