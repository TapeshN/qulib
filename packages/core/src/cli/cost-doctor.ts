import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GapAnalysisSchema } from '../schemas/gap-analysis.schema.js';

export async function runCostDoctor(reportPath: string): Promise<void> {
  const abs = resolve(process.cwd(), reportPath);
  let raw: string;
  try {
    raw = await readFile(abs, 'utf8');
  } catch {
    throw new Error(
      `Could not read ${abs}. Run \`qulib analyze --url <url>\` (without --ephemeral) from this directory first.`
    );
  }

  const parsed = GapAnalysisSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new Error('File is not a valid gap analysis report (report.json schema mismatch).');
  }

  const ci = parsed.data.costIntelligence;
  if (!ci) {
    console.log(
      '[qulib] No costIntelligence in this report (older scan). Re-run analyze with the current qulib version to populate Cost Intelligence.'
    );
    return;
  }

  console.log('# Qulib cost doctor\n');
  console.log(`Report: ${abs}`);
  console.log(`Analyzed at: ${parsed.data.analyzedAt}\n`);
  console.log('## Token ceiling (per LLM completion)\n');
  console.log(`- maxOutputTokensPerLlmCall: ${ci.maxOutputTokensPerLlmCall}`);
  console.log(`- budgetRole: ${ci.budgetRole}\n`);
  console.log('## Usage (this scan)\n');
  console.log(
    `- Input / output tokens: ${ci.usageSummary.totalInputTokens} / ${ci.usageSummary.totalOutputTokens} (${ci.usageSummary.dataQuality})`
  );
  if (ci.budgetWarnings.length) {
    console.log('\n## Budget warnings\n');
    for (const w of ci.budgetWarnings) {
      console.log(`- ${w}`);
    }
  } else {
    console.log('\n## Budget warnings\n\n- (none)\n');
  }
  if (ci.repeatedOperations.length) {
    console.log('\n## Repeated AI patterns\n');
    for (const r of ci.repeatedOperations) {
      console.log(`- ${r.promptHash} ×${r.count}`);
      console.log(`  ${r.recommendation}`);
    }
  } else {
    console.log('\n## Repeated AI patterns\n\n- (none in this run)\n');
  }
  console.log('\n## Deterministic maturity\n');
  console.log(`- ${ci.deterministicMaturity.label}`);
  console.log(`- ${ci.deterministicMaturity.rationale}`);
  if (ci.deterministicMaturity.ceilingNote) {
    console.log(`- _${ci.deterministicMaturity.ceilingNote}_`);
  }
  console.log('\n## Conversion recommendations\n');
  for (const c of ci.conversionRecommendations) {
    console.log(`- ${c}`);
  }
  const topGap = [...parsed.data.gaps].sort((a, b) => {
    const o = { high: 0, medium: 1, low: 2 };
    return o[a.severity] - o[b.severity];
  })[0];
  console.log('\n## Next best deterministic check\n');
  if (topGap) {
    console.log(
      `- Prioritize **${topGap.category}** on \`${topGap.path}\` (${topGap.severity}): ${topGap.reason}`
    );
  } else {
    console.log('- No gaps in this report; extend crawl coverage or add auth before chasing new checks.');
  }
  console.log('\n---\n');
  console.log(
    'TODO: correlate multiple historical reports and CI adapters for cross-run “cost doctor” diffing (not implemented yet).'
  );
}
