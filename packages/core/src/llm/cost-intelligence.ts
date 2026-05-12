import type { GapAnalysis } from '../schemas/gap-analysis.schema.js';
import type {
  CostIntelligence,
  DeterministicMaturity,
  LlmUsageRecord,
  RepeatedAiPattern,
} from '../schemas/cost-intelligence.schema.js';

export function summarizeUsageQuality(records: LlmUsageRecord[]): CostIntelligence['usageSummary'] {
  if (records.length === 0) {
    return { totalInputTokens: 0, totalOutputTokens: 0, dataQuality: 'none' };
  }
  const totalInputTokens = records.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = records.reduce((s, r) => s + r.outputTokens, 0);
  const qualities = new Set(records.map((r) => r.dataQuality));
  if (qualities.size > 1) {
    return { totalInputTokens, totalOutputTokens, dataQuality: 'mixed' };
  }
  const only = records[0]!.dataQuality;
  return { totalInputTokens, totalOutputTokens, dataQuality: only };
}

export function buildBudgetWarnings(
  records: LlmUsageRecord[],
  maxOutputTokensPerLlmCall: number
): string[] {
  const warnings: string[] = [];
  for (const r of records) {
    if (r.dataQuality === 'none' && r.inputTokens === 0 && r.outputTokens === 0) {
      continue;
    }
    const out = r.outputTokens;
    if (out >= maxOutputTokensPerLlmCall) {
      warnings.push(
        `Output tokens (${out}) reached or exceeded the configured per-completion max-output ceiling (${maxOutputTokensPerLlmCall}). Completion may be truncated; raise llmMaxOutputTokensPerCall (or legacy llmTokenBudget) or reduce testGenerationLimit.`
      );
    } else if (out >= Math.floor(maxOutputTokensPerLlmCall * 0.8)) {
      warnings.push(
        `Output tokens (${out}) are within 80% of the per-completion max-output ceiling (${maxOutputTokensPerLlmCall}). Truncation risk on heavier prompts.`
      );
    }
  }
  if (records.some((r) => r.dataQuality === 'estimated')) {
    warnings.push(
      'Some token counts are estimated (API usage missing or call failed). Treat totals as approximate until actual usage is available.'
    );
  }
  return warnings;
}

export function findRepeatedPromptPatterns(records: LlmUsageRecord[]): RepeatedAiPattern[] {
  const byHash = new Map<string, number>();
  for (const r of records) {
    if (!r.promptHash) continue;
    byHash.set(r.promptHash, (byHash.get(r.promptHash) ?? 0) + 1);
  }
  const out: RepeatedAiPattern[] = [];
  for (const [promptHash, count] of byHash) {
    if (count < 2) continue;
    out.push({
      promptHash,
      count,
      recommendation:
        'The same prompt fingerprint appeared multiple times in this run. Capture the intent as versioned Playwright/Cypress checks or shared scenario fixtures so repeat visits do not re-spend model tokens.',
    });
  }
  return out;
}

export function buildConversionRecommendations(params: {
  scenarioSource: 'llm' | 'template';
  repeatedOperations: RepeatedAiPattern[];
  budgetWarnings: string[];
  gapCount: number;
}): string[] {
  const rec: string[] = [];
  if (params.scenarioSource === 'llm' && params.gapCount > 0) {
    rec.push(
      'LLM-authored scenarios are suggestions only. Promote the highest-severity paths into deterministic checks (axe, link crawl, route smoke) checked on every deploy to shrink future LLM reliance.'
    );
  }
  if (params.repeatedOperations.length > 0) {
    rec.push(
      'Deduplicate repeated AI work: key scenarios by gap ids or route templates and reuse stored outputs where the deployment hash is unchanged.'
    );
  }
  if (params.budgetWarnings.some((w) => w.includes('truncated') || w.includes('80%'))) {
    rec.push(
      'Tune llmMaxOutputTokensPerCall (or legacy llmTokenBudget) against real prompt sizes, or lower testGenerationLimit so each completion stays within a safe envelope.'
    );
  }
  if (params.scenarioSource === 'template') {
    rec.push(
      'Scenarios were generated from built-in templates (no LLM). This is the lowest-cost path; keep expanding template coverage for recurring gap categories.'
    );
  }
  return rec;
}

export function computeDeterministicMaturity(params: {
  mode: GapAnalysis['mode'];
  coveragePagesScanned: number;
  gapCount: number;
  scenarioSource: 'llm' | 'template';
  repeatedOperations: RepeatedAiPattern[];
  releaseConfidence: number;
  requireHumanReview: boolean;
}): DeterministicMaturity {
  if (params.mode === 'auth-required') {
    return {
      level: 0,
      label: 'L0 — unknown / blocked',
      rationale:
        'Authentication blocked the crawl. Release confidence and gap inventory are not representative until a deterministic auth path is configured.',
      ceilingNote:
        'L1+ require at least one authenticated or public crawl producing structured gaps.',
    };
  }

  if (params.coveragePagesScanned === 0 && params.gapCount === 0) {
    return {
      level: 0,
      label: 'L0 — insufficient deterministic signal',
      rationale:
        'No pages were scanned and no gaps were recorded. Treat maturity as unknown rather than high.',
      ceilingNote: 'Re-run with reachable URLs, auth, or relaxed crawl limits.',
    };
  }

  let level = 1;
  let label = 'L1 — deterministic scan inventory';
  let rationale =
    'Structured gaps came from deterministic crawling and checks (links, console, a11y, coverage). This is the baseline Qulib release-confidence story.';

  if (params.scenarioSource === 'llm') {
    level = 2;
    label = 'L2 — AI-assisted analysis layer';
    rationale =
      'An LLM expanded gaps into scenarios. Value is exploratory; it is not yet the same as enforced CI coverage.';
  }

  if (params.repeatedOperations.length > 0) {
    level = Math.max(level, 3);
    label = 'L3 — repeated AI surface';
    rationale =
      'Repeated prompt fingerprints suggest the same reasoning loop is firing more than once—strong candidates to replace with cached or deterministic checks.';
  }

  const ceilingNote =
    params.releaseConfidence >= 85 && !params.requireHumanReview
      ? 'High release confidence does not imply L4–L5. Reviewed self-healing (L4) and adaptive quality intelligence (L5) require organizational process and feedback loops outside this single scan.'
      : 'L4 (reviewed self-healing) and L5 (adaptive quality intelligence) are not inferred from a snapshot scan. They require documented review, ownership, and sustained automation feedback.';

  return { level, label, rationale, ceilingNote };
}

export function assembleCostIntelligence(params: {
  maxOutputTokensPerLlmCall: number;
  records: LlmUsageRecord[];
  partial: Pick<
    GapAnalysis,
    'mode' | 'coveragePagesScanned' | 'releaseConfidence' | 'gaps'
  >;
  scenarioSource: 'llm' | 'template';
  requireHumanReview: boolean;
}): CostIntelligence {
  const usageSummary = summarizeUsageQuality(params.records);
  const budgetWarnings = buildBudgetWarnings(params.records, params.maxOutputTokensPerLlmCall);
  const repeatedOperations = findRepeatedPromptPatterns(params.records);
  const conversionRecommendations = buildConversionRecommendations({
    scenarioSource: params.scenarioSource,
    repeatedOperations,
    budgetWarnings,
    gapCount: params.partial.gaps.length,
  });
  const deterministicMaturity = computeDeterministicMaturity({
    mode: params.partial.mode,
    coveragePagesScanned: params.partial.coveragePagesScanned,
    gapCount: params.partial.gaps.length,
    scenarioSource: params.scenarioSource,
    repeatedOperations,
    releaseConfidence: params.partial.releaseConfidence,
    requireHumanReview: params.requireHumanReview,
  });

  return {
    maxOutputTokensPerLlmCall: params.maxOutputTokensPerLlmCall,
    budgetRole: 'max-output-tokens-per-llm-call',
    records: params.records,
    budgetWarnings,
    usageSummary,
    repeatedOperations,
    deterministicMaturity,
    conversionRecommendations,
  };
}

export function costIntelligenceForAuthBlocked(maxOutputTokensPerLlmCall: number): CostIntelligence {
  return {
    maxOutputTokensPerLlmCall,
    budgetRole: 'max-output-tokens-per-llm-call',
    records: [],
    budgetWarnings: [],
    usageSummary: { totalInputTokens: 0, totalOutputTokens: 0, dataQuality: 'none' },
    repeatedOperations: [],
    deterministicMaturity: {
      level: 0,
      label: 'L0 — unknown / blocked',
      rationale:
        'Authentication blocked the crawl. No LLM usage was recorded; deterministic inventory is incomplete.',
      ceilingNote:
        'Configure auth, then re-run so gap analysis and any LLM scenario pass operate on real pages.',
    },
    conversionRecommendations: [
      'Resolve authentication first (storage-state from `qulib auth init` or form-login flags). Cost intelligence for model-assisted work applies after the crawl succeeds.',
    ],
  };
}
