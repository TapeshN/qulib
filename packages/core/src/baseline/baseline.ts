import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import type { GapAnalysis, Gap } from '../schemas/gap-analysis.schema.js';
import {
  BaselineSnapshotSchema,
  BaselineDeltaSchema,
  type BaselineSnapshot,
  type BaselineDelta,
  type BaselineGap,
} from './baseline.schema.js';

const BASELINE_DIR_NAME = '.qulib-baselines';

/**
 * Resolve the directory where baselines for the given URL are stored.
 * Each URL gets its own subdirectory under baseDir, keyed by a stable slug.
 */
function resolveBaselineDir(baseDir: string, urlSlug: string): string {
  return join(baseDir, urlSlug);
}

/**
 * Produce a filesystem-safe slug from a URL.
 * e.g. "https://my-app.vercel.app/admin" → "my-app_vercel_app__admin"
 */
export function slugifyUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

/**
 * Return the default root for baseline storage: `<cwd>/.qulib-baselines`.
 * Callers may supply an explicit `baseDir` to override.
 */
export function defaultBaselineRoot(): string {
  return join(process.cwd(), BASELINE_DIR_NAME);
}

/**
 * Convert a `GapAnalysis` result into the compact `BaselineGap[]` shape.
 * Drops fields not needed for delta comparison (id, description, recommendation).
 */
function toBaselineGaps(gaps: Gap[]): BaselineGap[] {
  return gaps.map((g) => ({
    path: g.path,
    severity: g.severity,
    category: g.category,
    reason: g.reason,
  }));
}

/**
 * Save a baseline snapshot derived from the given `GapAnalysis` result.
 *
 * @returns The saved snapshot.
 */
export async function saveBaseline(
  analysis: GapAnalysis,
  url: string,
  options: { baseDir?: string; label?: string } = {}
): Promise<BaselineSnapshot> {
  const baseDir = options.baseDir ?? defaultBaselineRoot();
  const urlSlug = slugifyUrl(url);
  const dir = resolveBaselineDir(baseDir, urlSlug);
  await mkdir(dir, { recursive: true });

  const now = new Date();
  // Include milliseconds (23 chars: "2024-01-01T00-00-00-000") so rapid successive saves
  // do not collide on the same filename within the same second.
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const id = `${urlSlug}__${timestamp}`;
  const filename = `${id}.json`;

  const snapshot: BaselineSnapshot = {
    id,
    url,
    savedAt: now.toISOString(),
    releaseConfidence: analysis.releaseConfidence ?? 0,
    gapCount: analysis.gaps.length,
    gaps: toBaselineGaps(analysis.gaps),
    ...(options.label !== undefined ? { label: options.label } : {}),
  };

  const validated = BaselineSnapshotSchema.parse(snapshot);
  await writeFile(join(dir, filename), JSON.stringify(validated, null, 2), 'utf8');
  return validated;
}

/**
 * Load a specific baseline snapshot by its `id`.
 *
 * @throws If the file does not exist or fails schema validation.
 */
export async function loadBaseline(id: string, options: { baseDir?: string } = {}): Promise<BaselineSnapshot> {
  const baseDir = options.baseDir ?? defaultBaselineRoot();
  // id encodes the urlSlug: <urlSlug>__<timestamp>
  const doubleUnderIndex = id.lastIndexOf('__');
  if (doubleUnderIndex < 0) {
    throw new Error(`Invalid baseline id (no __ separator): ${id}`);
  }
  const urlSlug = id.slice(0, doubleUnderIndex);
  const dir = resolveBaselineDir(baseDir, urlSlug);
  const filepath = join(dir, `${id}.json`);

  if (!existsSync(filepath)) {
    throw new Error(`Baseline not found: ${id} (${filepath})`);
  }

  const raw = await readFile(filepath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Baseline file is not valid JSON: ${filepath}`);
  }
  return BaselineSnapshotSchema.parse(parsed);
}

/**
 * List all saved baselines for the given URL, sorted newest-first.
 *
 * Returns an empty array if no baselines exist yet.
 */
export async function listBaselines(
  url: string,
  options: { baseDir?: string } = {}
): Promise<BaselineSnapshot[]> {
  const baseDir = options.baseDir ?? defaultBaselineRoot();
  const urlSlug = slugifyUrl(url);
  const dir = resolveBaselineDir(baseDir, urlSlug);

  if (!existsSync(dir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const snapshots: BaselineSnapshot[] = [];
  for (const entry of entries) {
    if (extname(entry) !== '.json') continue;
    const filepath = join(dir, entry);
    const raw = await readFile(filepath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = BaselineSnapshotSchema.safeParse(parsed);
    if (result.success) {
      snapshots.push(result.data);
    }
  }

  // Newest first
  snapshots.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  return snapshots;
}

/**
 * Delete a specific baseline snapshot by its `id`.
 *
 * @throws If the file does not exist.
 */
export async function deleteBaseline(id: string, options: { baseDir?: string } = {}): Promise<void> {
  const baseDir = options.baseDir ?? defaultBaselineRoot();
  const doubleUnderIndex = id.lastIndexOf('__');
  if (doubleUnderIndex < 0) {
    throw new Error(`Invalid baseline id (no __ separator): ${id}`);
  }
  const urlSlug = id.slice(0, doubleUnderIndex);
  const dir = resolveBaselineDir(baseDir, urlSlug);
  const filepath = join(dir, `${id}.json`);

  if (!existsSync(filepath)) {
    throw new Error(`Baseline not found: ${id}`);
  }
  await unlink(filepath);
}

// ---------------------------------------------------------------------------
// Delta detection
// ---------------------------------------------------------------------------

/**
 * Stable key used to match gaps across snapshots for delta detection.
 * Two gaps are "the same problem" when they share path + category.
 */
function gapKey(g: BaselineGap): string {
  return `${g.path}|||${g.category}`;
}

/**
 * Compare two baseline snapshots and return a structured delta report.
 *
 * - `newGaps`: problems present in `current` but not in `prior`.
 * - `resolvedGaps`: problems present in `prior` but no longer in `current`.
 * - `severityChanges`: same problem (matching key) with a different severity.
 */
export function compareBaselines(prior: BaselineSnapshot, current: BaselineSnapshot): BaselineDelta {
  const priorMap = new Map<string, BaselineGap>();
  for (const g of prior.gaps) {
    priorMap.set(gapKey(g), g);
  }

  const currentMap = new Map<string, BaselineGap>();
  for (const g of current.gaps) {
    currentMap.set(gapKey(g), g);
  }

  const severityOrder: Record<BaselineGap['severity'], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  const newGaps: BaselineDelta['newGaps'] = [];
  const resolvedGaps: BaselineDelta['resolvedGaps'] = [];
  const severityChanges: BaselineDelta['severityChanges'] = [];

  // Gaps in current that were not in prior → new
  for (const [key, g] of currentMap) {
    if (!priorMap.has(key)) {
      newGaps.push({ path: g.path, category: g.category, severity: g.severity, reason: g.reason, status: 'new' });
    } else {
      const prev = priorMap.get(key)!;
      if (prev.severity !== g.severity) {
        const prevOrd = severityOrder[prev.severity];
        const currOrd = severityOrder[g.severity];
        severityChanges.push({
          path: g.path,
          category: g.category,
          severity: g.severity,
          reason: g.reason,
          status: currOrd > prevOrd ? 'severity-increased' : 'severity-decreased',
        });
      }
    }
  }

  // Gaps in prior that are no longer in current → resolved
  for (const [key, g] of priorMap) {
    if (!currentMap.has(key)) {
      resolvedGaps.push({
        path: g.path,
        category: g.category,
        severity: g.severity,
        reason: g.reason,
        status: 'resolved',
      });
    }
  }

  const confidenceDelta = current.releaseConfidence - prior.releaseConfidence;
  const direction = confidenceDelta > 0 ? 'improved' : confidenceDelta < 0 ? 'regressed' : 'unchanged';
  const summary = [
    `Confidence ${direction} (${prior.releaseConfidence} → ${current.releaseConfidence})`,
    newGaps.length > 0 ? `${newGaps.length} new gap(s)` : '',
    resolvedGaps.length > 0 ? `${resolvedGaps.length} resolved gap(s)` : '',
    severityChanges.length > 0 ? `${severityChanges.length} severity change(s)` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const delta: BaselineDelta = {
    fromId: prior.id,
    toId: current.id,
    fromSavedAt: prior.savedAt,
    toSavedAt: current.savedAt,
    fromReleaseConfidence: prior.releaseConfidence,
    toReleaseConfidence: current.releaseConfidence,
    confidenceDelta,
    newGaps,
    resolvedGaps,
    severityChanges,
    summary,
  };

  return BaselineDeltaSchema.parse(delta);
}
