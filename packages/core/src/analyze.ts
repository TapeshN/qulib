import { type HarnessConfig, type DetectedAuth } from './schemas/config.schema.js';
import type { Gap, GapAnalysis } from './schemas/gap-analysis.schema.js';
import { RouteInventorySchema, type RouteInventory } from './schemas/route-inventory.schema.js';
import type { RepoAnalysis } from './schemas/repo-analysis.schema.js';
import type { DecisionLogEntry } from './schemas/decision-log.schema.js';
import { PublicSurfaceSchema, type PublicSurface } from './schemas/public-surface.schema.js';
import { observe } from './phases/observe.js';
import { think } from './phases/think.js';
import { act } from './phases/act.js';
import { detectAuth } from './tools/auth-detector.js';
import { analyzeGaps, computeCoverageScore, computeQualityScoreFromGaps } from './tools/gap-engine.js';
import { analyzeAuthSurfaceGaps } from './tools/auth-surface-analyzer.js';
import { buildPublicSurface } from './tools/public-surface.js';
import { buildAuthBlockGap } from './tools/auth-block-gap.js';
import { finalizeGapAnalysisFromDraft, type GapAnalysisDraft } from './phases/think-finalize.js';

export type AnalyzeStatus = 'complete' | 'blocked' | 'partial';

export interface AnalyzeOptions {
  url: string;
  repoPath?: string;
  config: HarnessConfig;
  writeArtifacts?: boolean;
  skipAuthDetection?: boolean;
}

export interface AnalyzeResult {
  status: AnalyzeStatus;
  coverageScore: number | null;
  /** Quality of evaluated pages only; `null` when no evaluable surface produced a score (fully blocked). */
  releaseConfidence: number | null;
  /** Same entries as `gapAnalysis.gaps` for consumers that read a flat `gaps` field. */
  gaps: Gap[];
  gapAnalysis: GapAnalysis;
  /** Authenticated crawl scope only; empty routes when the scan stopped at an auth wall without credentials. */
  routeInventory: RouteInventory;
  repoInventory: RepoAnalysis | null;
  decisionLog: DecisionLogEntry[];
  detectedAuth?: DetectedAuth;
  /** Public pre-auth crawl; `null` when there was no auth wall or the flow matched a normal authenticated scan. */
  publicSurface: PublicSurface | null;
}

export async function analyzeApp(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const writeArtifacts = options.writeArtifacts ?? false;
  const decisionLog: DecisionLogEntry[] = [];
  const artifacts = {
    writeArtifacts,
    decisionMemory: decisionLog,
  };

  let detectedAuth: DetectedAuth | undefined;
  let authWall = false;
  if (!options.config.auth && !options.skipAuthDetection) {
    detectedAuth = await detectAuth(options.url, options.config.timeoutMs);
    authWall = Boolean(detectedAuth.hasAuth);
  }

  const observed = await observe(options.url, options.repoPath, options.config, artifacts);

  if (authWall && !options.config.auth && detectedAuth) {
    decisionLog.push({
      timestamp: new Date().toISOString(),
      phase: 'observe',
      decision: 'auth-required',
      reason: detectedAuth.recommendation,
      metadata: { detection: detectedAuth },
    });

    const mode = observed.repo ? 'url-repo' : 'url-only';
    const publicAnalysis = analyzeGaps(observed.routes, observed.repo, mode, options.config);
    const publicSurface = PublicSurfaceSchema.parse(
      buildPublicSurface(observed.routes.routes, publicAnalysis.gaps)
    );
    const authSurfaceGaps = await analyzeAuthSurfaceGaps(
      options.url,
      detectedAuth,
      options.config.timeoutMs
    );
    const authBlockGap = buildAuthBlockGap(options.url);
    const status: AnalyzeStatus = observed.routes.routes.length === 0 ? 'blocked' : 'partial';
    const qualityInputGaps = [...publicAnalysis.gaps, ...authSurfaceGaps];
    const qualityScore = computeQualityScoreFromGaps(qualityInputGaps);
    const draftRelease = status === 'blocked' ? null : qualityScore;

    const draft: GapAnalysisDraft = {
      analyzedAt: new Date().toISOString(),
      mode: 'auth-required',
      releaseConfidence: draftRelease,
      coveragePagesScanned: 0,
      coverageBudgetExceeded: false,
      coverageWarning: 'auth-required',
      gaps: [...authSurfaceGaps, authBlockGap],
    };

    const costContext: Pick<GapAnalysis, 'mode' | 'coveragePagesScanned' | 'releaseConfidence' | 'gaps'> = {
      mode: publicAnalysis.mode,
      coveragePagesScanned: observed.routes.routes.length,
      releaseConfidence: qualityScore,
      gaps: publicAnalysis.gaps,
    };

    const gapAnalysis = await finalizeGapAnalysisFromDraft(
      draft,
      options.config,
      artifacts,
      costContext
    );

    const emptyAuthRoutes = RouteInventorySchema.parse({
      scannedAt: new Date().toISOString(),
      baseUrl: options.url,
      routes: [],
      pagesSkipped: 0,
      budgetExceeded: false,
    });

    await act(gapAnalysis, options.config, artifacts);

    return {
      status,
      coverageScore: computeCoverageScore(observed.routes),
      releaseConfidence: draftRelease,
      gaps: gapAnalysis.gaps,
      gapAnalysis,
      routeInventory: emptyAuthRoutes,
      repoInventory: observed.repo,
      decisionLog,
      detectedAuth,
      publicSurface,
    };
  }

  const analysis = await think(observed, options.config, artifacts);
  await act(analysis, options.config, artifacts);

  return {
    status: 'complete',
    coverageScore: computeCoverageScore(observed.routes),
    releaseConfidence: analysis.releaseConfidence,
    gaps: analysis.gaps,
    gapAnalysis: analysis,
    routeInventory: observed.routes,
    repoInventory: observed.repo,
    decisionLog,
    ...(detectedAuth !== undefined && { detectedAuth }),
    publicSurface: null,
  };
}
