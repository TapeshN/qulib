import { randomUUID } from 'node:crypto';
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
import type { AnalyzeProgressSink } from './harness/progress-log.js';
import type { TelemetrySink } from './telemetry/telemetry.interface.js';
import { emitTelemetry } from './telemetry/emit.js';

export type AnalyzeStatus = 'complete' | 'blocked' | 'partial';

export interface AnalyzeOptions {
  url: string;
  repoPath?: string;
  config: HarnessConfig;
  writeArtifacts?: boolean;
  skipAuthDetection?: boolean;
  progressLog?: AnalyzeProgressSink;
  telemetry?: TelemetrySink;
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
  /** Crawled public routes and their gap-derived surface (complete scans); OAuth-wall scans use the pre-auth crawl only. */
  publicSurface: PublicSurface | null;
}

function logScanEnd(progress: AnalyzeProgressSink | undefined, result: AnalyzeResult): void {
  const rc = result.releaseConfidence === null ? 'null' : String(result.releaseConfidence);
  const cs = result.coverageScore === null ? 'null' : String(result.coverageScore);
  progress?.info(`status=${result.status} | coverageScore=${cs} | releaseConfidence=${rc} | gaps=${result.gaps.length}`);
  for (const g of result.gaps) {
    progress?.debug(`gap id=${g.id} severity=${g.severity} category=${g.category}`);
  }
  if (process.env.QULIB_DEBUG === '1') {
    progress?.debug(`gaps json=${JSON.stringify(result.gaps)}`);
  }
}

export async function analyzeApp(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const writeArtifacts = options.writeArtifacts ?? false;
  const decisionLog: DecisionLogEntry[] = [];
  const progress = options.progressLog;
  const sessionId = randomUUID();
  const artifacts = {
    writeArtifacts,
    decisionMemory: decisionLog,
    telemetrySessionId: sessionId,
    ...(options.telemetry !== undefined && { telemetry: options.telemetry }),
    ...(progress !== undefined && { progressLog: progress }),
  };

  emitTelemetry(options.telemetry, 'scan.started', sessionId, {
    url: options.url,
    maxPagesToScan: options.config.maxPagesToScan,
    hasAuth: Boolean(options.config.auth),
  });

  progress?.info(`Starting scan → ${options.url} maxPagesToScan=${options.config.maxPagesToScan}`);

  let detectedAuth: DetectedAuth | undefined;
  let authWall = false;
  if (!options.config.auth && !options.skipAuthDetection) {
    detectedAuth = await detectAuth(options.url, options.config.timeoutMs, progress);
    authWall = Boolean(detectedAuth.hasAuth);
    if (detectedAuth.hasAuth) {
      emitTelemetry(options.telemetry, 'auth.detected', sessionId, {
        authType: detectedAuth.type,
        hasAuth: true,
      });
    }
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

    const status: AnalyzeStatus = observed.routes.routes.length === 0 ? 'blocked' : 'partial';
    if (status === 'blocked') {
      progress?.warn('Scan blocked by auth wall');
    } else {
      progress?.warn('Auth wall: continuing with public surface only (partial)');
    }

    const mode = observed.repo ? 'url-repo' : 'url-only';
    const publicAnalysis = analyzeGaps(observed.routes, observed.repo, mode, options.config);
    const publicSurface = PublicSurfaceSchema.parse(
      buildPublicSurface(observed.routes.routes, publicAnalysis.gaps)
    );
    progress?.info(`Public surface crawl: ${publicSurface.pages.length} page(s) reachable pre-auth`);

    const authSurfaceGaps = await analyzeAuthSurfaceGaps(
      options.url,
      detectedAuth,
      options.config.timeoutMs
    );
    const authBlockGap = buildAuthBlockGap(options.url);
    const qualityInputGaps = [...publicAnalysis.gaps, ...authSurfaceGaps];
    const qualityScore = computeQualityScoreFromGaps(qualityInputGaps, options.config.scoringWeights);
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

    const result: AnalyzeResult = {
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
    logScanEnd(progress, result);
    emitTelemetry(
      options.telemetry,
      status === 'blocked' ? 'scan.blocked' : 'scan.completed',
      sessionId,
      {
        status: result.status,
        coverageScore: result.coverageScore,
        releaseConfidence: result.releaseConfidence,
        gapCount: result.gaps.length,
      }
    );
    return result;
  }

  const analysis = await think(observed, options.config, artifacts);
  await act(analysis, options.config, artifacts);

  const publicSurface = PublicSurfaceSchema.parse(
    buildPublicSurface(observed.routes.routes, analysis.gaps)
  );
  progress?.info(`Public surface crawl: ${publicSurface.pages.length} page(s) reachable pre-auth`);

  const result: AnalyzeResult = {
    status: 'complete',
    coverageScore: computeCoverageScore(observed.routes),
    releaseConfidence: analysis.releaseConfidence,
    gaps: analysis.gaps,
    gapAnalysis: analysis,
    routeInventory: observed.routes,
    repoInventory: observed.repo,
    decisionLog,
    ...(detectedAuth !== undefined && { detectedAuth }),
    publicSurface,
  };
  logScanEnd(progress, result);
  emitTelemetry(options.telemetry, 'scan.completed', sessionId, {
    status: result.status,
    coverageScore: result.coverageScore,
    releaseConfidence: result.releaseConfidence,
    gapCount: result.gaps.length,
  });
  return result;
}
