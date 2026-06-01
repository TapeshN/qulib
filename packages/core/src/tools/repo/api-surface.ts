/**
 * @module tools/repo/api-surface
 * @packageBoundary @qulib/core
 *
 * Evidence-only API surface discovery. Three tiers of confidence:
 *   Tier1 — OpenAPI / Swagger spec files (YAML or JSON). Only reads `summary` and
 *            `parameters` from a real spec; never fabricates endpoints.
 *   Tier2 — Framework route files: Next.js App-Router `route.ts` exports,
 *            Next.js Pages `pages/api/`, Express router calls from RepoAnalysis.routes,
 *            Fastify `fastify.{method}`, Hono `app.{method}`, NestJS decorators.
 *   Tier3 — Opt-in heuristics. Currently: tRPC router definition files.
 *            Only activated when `options.enableTier3 === true`.
 *
 * Every endpoint carries:
 *   sourceFile  — repo-relative file path that evidence was read from
 *   sourceTier  — 'openapi' | 'framework' | 'heuristic'
 *   confidence  — 'high' | 'medium' | 'low'
 *
 * NEVER invents endpoints or parameters. When a spec file cannot be parsed,
 * or a file pattern does not clearly indicate a route, the file is skipped.
 */

import { readFile } from 'node:fs/promises';
import { relative, join, basename } from 'node:path';
import glob from 'fast-glob';
import type { RepoAnalysis } from '../../schemas/repo-analysis.schema.js';

const IGNORE_PATTERNS = ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/build/**'];

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function normalizeMethod(raw: string): DiscoveredEndpoint['method'] {
  const upper = raw.toUpperCase();
  if (upper === 'GET') return 'GET';
  if (upper === 'POST') return 'POST';
  if (upper === 'PUT') return 'PUT';
  if (upper === 'DELETE') return 'DELETE';
  if (upper === 'PATCH') return 'PATCH';
  return 'unknown';
}

export interface DiscoveredEndpoint {
  /** HTTP method inferred from the source — 'unknown' when ambiguous */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'unknown';
  /** Path as extracted from source — may contain framework-specific params like [id] or :id */
  path: string;
  /** Repo-relative file path the evidence was read from */
  sourceFile: string;
  /** Discovery tier */
  sourceTier: 'openapi' | 'framework' | 'heuristic';
  /** Evidence confidence */
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable summary from spec, if available (Tier1 only) */
  summary?: string;
  /** Parameter names extracted from spec (Tier1 only; never fabricated) */
  parameterNames?: string[];
}

export interface ApiSurface {
  discoveredAt: string;
  repoPath: string;
  endpoints: DiscoveredEndpoint[];
  /** Number of OpenAPI/Swagger spec files found and successfully parsed */
  openApiSpecsFound: number;
  /** Tier3 heuristics were enabled */
  tier3Enabled: boolean;
}

export interface DiscoverApiSurfaceOptions {
  /** Enable Tier3 heuristic discovery (default false — opt-in) */
  enableTier3?: boolean;
}

// ---------------------------------------------------------------------------
// Tier 1 — OpenAPI / Swagger spec files
// ---------------------------------------------------------------------------

type OpenApiDocument = {
  openapi?: string;
  swagger?: string;
  paths?: Record<string, Record<string, unknown>>;
};

type OpenApiOperation = {
  summary?: string;
  parameters?: Array<{ name?: string; in?: string }>;
};

function isOpenApiDocument(raw: unknown): raw is OpenApiDocument {
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return (
    (typeof obj['openapi'] === 'string' || typeof obj['swagger'] === 'string') &&
    typeof obj['paths'] === 'object'
  );
}

async function discoverFromOpenApi(repoPath: string): Promise<{ endpoints: DiscoveredEndpoint[]; specsFound: number }> {
  const endpoints: DiscoveredEndpoint[] = [];

  const specFiles = await glob(
    [
      '**/openapi.yaml',
      '**/openapi.yml',
      '**/openapi.json',
      '**/swagger.yaml',
      '**/swagger.yml',
      '**/swagger.json',
      '**/api-docs.yaml',
      '**/api-docs.json',
    ],
    { cwd: repoPath, onlyFiles: true, absolute: true, ignore: IGNORE_PATTERNS }
  );

  let specsFound = 0;

  for (const file of specFiles) {
    const rel = toPosix(relative(repoPath, file));

    let raw: unknown;
    try {
      const content = await readFile(file, 'utf8');
      if (file.endsWith('.json')) {
        raw = JSON.parse(content) as unknown;
      } else {
        // Dynamic import of js-yaml to avoid bundling issues
        const yaml = (await import('js-yaml')) as typeof import('js-yaml');
        raw = yaml.load(content);
      }
    } catch {
      // Skip unparseable files — never fabricate
      continue;
    }

    if (!isOpenApiDocument(raw)) continue;

    specsFound++;

    const paths = raw.paths ?? {};
    for (const [path, pathItem] of Object.entries(paths)) {
      if (typeof pathItem !== 'object' || pathItem === null) continue;
      const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
      for (const method of methods) {
        const operation = (pathItem as Record<string, unknown>)[method];
        if (typeof operation !== 'object' || operation === null) continue;

        const op = operation as OpenApiOperation;
        const parameterNames = (op.parameters ?? [])
          .filter((p): p is { name: string; in: string } => typeof p?.name === 'string')
          .map((p) => p.name);

        endpoints.push({
          method: normalizeMethod(method),
          path,
          sourceFile: rel,
          sourceTier: 'openapi',
          confidence: 'high',
          ...(typeof op.summary === 'string' && op.summary ? { summary: op.summary } : {}),
          ...(parameterNames.length > 0 ? { parameterNames } : {}),
        });
      }
    }
  }

  return { endpoints, specsFound };
}

// ---------------------------------------------------------------------------
// Tier 2 — Framework route files
// ---------------------------------------------------------------------------

async function discoverNextAppRouterEndpoints(repoPath: string): Promise<DiscoveredEndpoint[]> {
  const endpoints: DiscoveredEndpoint[] = [];

  const routeFiles = await glob(['app/**/route.ts', 'app/**/route.tsx', 'src/app/**/route.ts', 'src/app/**/route.tsx'], {
    cwd: repoPath,
    onlyFiles: true,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });

  for (const file of routeFiles) {
    const rel = toPosix(relative(repoPath, file));
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    // Extract the route path from the file location
    const routeSegment = rel
      .replace(/^(src\/)?app\//, '')
      .replace(/\/route\.tsx?$/, '');
    // Normalize Next.js dynamic segments: [id] -> [id] (keep as-is, it's the real path)
    const routePath = `/${routeSegment}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

    // Find exported HTTP method functions: export async function GET/POST/PUT/DELETE/PATCH
    const methodExportRe = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b/g;
    let match: RegExpExecArray | null;
    let foundAny = false;
    while ((match = methodExportRe.exec(content)) !== null) {
      foundAny = true;
      endpoints.push({
        method: normalizeMethod(match[1] ?? 'unknown'),
        path: routePath,
        sourceFile: rel,
        sourceTier: 'framework',
        confidence: 'high',
      });
    }

    // If the file exists but has no recognized export, it's still a route — emit as unknown method
    if (!foundAny) {
      endpoints.push({
        method: 'unknown',
        path: routePath,
        sourceFile: rel,
        sourceTier: 'framework',
        confidence: 'medium',
      });
    }
  }

  return endpoints;
}

async function discoverNextPagesApiEndpoints(repoPath: string): Promise<DiscoveredEndpoint[]> {
  const endpoints: DiscoveredEndpoint[] = [];

  const apiFiles = await glob(['pages/api/**/*.ts', 'pages/api/**/*.tsx', 'src/pages/api/**/*.ts'], {
    cwd: repoPath,
    onlyFiles: true,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });

  for (const file of apiFiles) {
    const rel = toPosix(relative(repoPath, file));
    const name = basename(rel);
    if (name.startsWith('_')) continue;

    const routeSegment = rel
      .replace(/^(src\/)?pages\/api\//, '')
      .replace(/\.tsx?$/, '');
    const routePath = routeSegment === 'index'
      ? '/api'
      : `/api/${routeSegment.replace(/\/index$/, '')}`.replace(/\/+/g, '/');

    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    // Pages API routes export a default handler that typically checks req.method internally.
    // We can't know the HTTP methods without executing the code, so we emit 'unknown'.
    // Look for explicit method checks like: req.method === 'POST'
    const methodCheckRe = /req\.method\s*(?:===|==|!==|!=)\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/g;
    const methods = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = methodCheckRe.exec(content)) !== null) {
      if (match[1]) methods.add(match[1]);
    }

    if (methods.size > 0) {
      for (const method of methods) {
        endpoints.push({
          method: normalizeMethod(method),
          path: routePath,
          sourceFile: rel,
          sourceTier: 'framework',
          confidence: 'medium',
        });
      }
    } else {
      endpoints.push({
        method: 'unknown',
        path: routePath,
        sourceFile: rel,
        sourceTier: 'framework',
        confidence: 'medium',
      });
    }
  }

  return endpoints;
}

function discoverExpressEndpoints(repo: RepoAnalysis): DiscoveredEndpoint[] {
  // Re-use existing RepoAnalysis.routes which already extracted Express router calls.
  // Filter to only include routes that came from src/ files (Express pattern).
  return repo.routes
    .filter((r) => r.method !== 'GET' || r.file.startsWith('src/'))
    .map((r) => ({
      method: normalizeMethod(r.method),
      path: r.path,
      sourceFile: r.file,
      sourceTier: 'framework' as const,
      confidence: 'medium' as const,
    }));
}

async function discoverFastifyEndpoints(repoPath: string): Promise<DiscoveredEndpoint[]> {
  const endpoints: DiscoveredEndpoint[] = [];

  const files = await glob(['src/**/*.ts', 'src/**/*.js', 'routes/**/*.ts', 'routes/**/*.js'], {
    cwd: repoPath,
    onlyFiles: true,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });

  for (const file of files) {
    const rel = toPosix(relative(repoPath, file));
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    // Fastify: fastify.get('/path', ...) or fastify.route({ method: 'GET', url: '/path' })
    const fastifyCallRe = /(?:fastify|app|server)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match: RegExpExecArray | null;
    while ((match = fastifyCallRe.exec(content)) !== null) {
      const method = match[1];
      const path = match[2];
      if (method && path) {
        endpoints.push({
          method: normalizeMethod(method),
          path: path.startsWith('/') ? path : `/${path}`,
          sourceFile: rel,
          sourceTier: 'framework',
          confidence: 'medium',
        });
      }
    }

    // Hono: app.get('/path', ...) — same pattern, already covered above if variable is named app/server
    // NestJS decorators: @Get('/path'), @Post('/path'), etc.
    const nestDecoratorRe = /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/g;
    while ((match = nestDecoratorRe.exec(content)) !== null) {
      const method = match[1];
      const path = match[2];
      if (method !== undefined && path !== undefined) {
        endpoints.push({
          method: normalizeMethod(method),
          path: path === '' ? '/' : (path.startsWith('/') ? path : `/${path}`),
          sourceFile: rel,
          sourceTier: 'framework',
          confidence: 'medium',
        });
      }
    }
  }

  return endpoints;
}

// ---------------------------------------------------------------------------
// Tier 3 — Heuristic (opt-in): tRPC
// ---------------------------------------------------------------------------

async function discoverTrpcEndpoints(repoPath: string): Promise<DiscoveredEndpoint[]> {
  const endpoints: DiscoveredEndpoint[] = [];

  const trpcFiles = await glob(
    ['src/**/*.ts', 'server/**/*.ts', 'lib/**/*.ts', 'app/**/*.ts'],
    {
      cwd: repoPath,
      onlyFiles: true,
      absolute: true,
      ignore: IGNORE_PATTERNS,
    }
  );

  for (const file of trpcFiles) {
    const rel = toPosix(relative(repoPath, file));
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    // Only look at files that import from @trpc
    if (!content.includes('@trpc/server') && !content.includes('@trpc/next')) continue;

    // tRPC procedure definitions: .query({ ... }) or .mutation({ ... })
    // These aren't HTTP routes in the traditional sense, but procedure names are the "paths"
    const queryRe = /(\w+)\s*:\s*(?:publicProcedure|protectedProcedure|procedure)\s*\.(?:input\([^)]*\)\s*\.)?query\s*\(/g;
    const mutationRe = /(\w+)\s*:\s*(?:publicProcedure|protectedProcedure|procedure)\s*\.(?:input\([^)]*\)\s*\.)?mutation\s*\(/g;

    let match: RegExpExecArray | null;
    while ((match = queryRe.exec(content)) !== null) {
      const name = match[1];
      if (name) {
        endpoints.push({
          method: 'GET',
          path: `/trpc/${name}`,
          sourceFile: rel,
          sourceTier: 'heuristic',
          confidence: 'low',
          summary: `tRPC query: ${name}`,
        });
      }
    }
    while ((match = mutationRe.exec(content)) !== null) {
      const name = match[1];
      if (name) {
        endpoints.push({
          method: 'POST',
          path: `/trpc/${name}`,
          sourceFile: rel,
          sourceTier: 'heuristic',
          confidence: 'low',
          summary: `tRPC mutation: ${name}`,
        });
      }
    }
  }

  return endpoints;
}

// ---------------------------------------------------------------------------
// De-duplication
// ---------------------------------------------------------------------------

function deduplicateEndpoints(endpoints: DiscoveredEndpoint[]): DiscoveredEndpoint[] {
  // Higher tier = higher priority; within a tier, first seen wins
  const tierRank = { openapi: 0, framework: 1, heuristic: 2 };
  const seen = new Map<string, DiscoveredEndpoint>();

  for (const ep of endpoints) {
    const key = `${ep.method}:${ep.path}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, ep);
    } else {
      // Keep the one with higher tier rank (lower number = better)
      const existingRank = tierRank[existing.sourceTier];
      const newRank = tierRank[ep.sourceTier];
      if (newRank < existingRank) {
        seen.set(key, ep);
      }
    }
  }

  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function discoverApiSurface(
  repoPath: string,
  options: DiscoverApiSurfaceOptions = {}
): Promise<ApiSurface> {
  const tier3Enabled = options.enableTier3 === true;

  // Run tiers in parallel for speed
  const [
    tier1Result,
    nextAppEndpoints,
    nextPagesEndpoints,
    fastifyEndpoints,
  ] = await Promise.all([
    discoverFromOpenApi(repoPath),
    discoverNextAppRouterEndpoints(repoPath),
    discoverNextPagesApiEndpoints(repoPath),
    discoverFastifyEndpoints(repoPath),
  ]);

  // Express uses existing RepoAnalysis — callers may pass a pre-scanned repo via a
  // separate helper. Here we expose the raw discovery functions; the integration
  // layer in computeApiCoverage passes the repo. For standalone usage we return
  // only file-based discoveries.
  const tier1 = tier1Result.endpoints;
  const tier2 = [...nextAppEndpoints, ...nextPagesEndpoints, ...fastifyEndpoints];

  const tier3: DiscoveredEndpoint[] = tier3Enabled
    ? await discoverTrpcEndpoints(repoPath)
    : [];

  const allEndpoints = deduplicateEndpoints([...tier1, ...tier2, ...tier3]);

  return {
    discoveredAt: new Date().toISOString(),
    repoPath,
    endpoints: allEndpoints,
    openApiSpecsFound: tier1Result.specsFound,
    tier3Enabled,
  };
}

/**
 * Variant that also incorporates RepoAnalysis.routes (Express routes already
 * extracted by scanRepo). Use this when you already have a RepoAnalysis to avoid
 * double-reading files.
 */
export async function discoverApiSurfaceWithRepo(
  repoPath: string,
  repo: RepoAnalysis,
  options: DiscoverApiSurfaceOptions = {}
): Promise<ApiSurface> {
  const base = await discoverApiSurface(repoPath, options);
  const expressEndpoints = discoverExpressEndpoints(repo);

  return {
    ...base,
    endpoints: deduplicateEndpoints([...base.endpoints, ...expressEndpoints]),
  };
}
