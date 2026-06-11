/**
 * Per-page coverage heatmap for Markdown reports.
 *
 * buildPageHeatmap() is a pure function — no I/O, no side-effects.
 * It derives a rows × dimensions matrix from GapAnalysis.gaps and sorts
 * rows worst-first (most critical coverage problems bubble to the top).
 *
 * Dimensions map to the GapSchema.category enum values so the heatmap
 * always stays in sync with what the scanner can produce.
 */

import type { Gap } from '../schemas/gap-analysis.schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The ordered set of gap categories that appear as heatmap columns. */
export const HEATMAP_DIMENSIONS = [
  'untested-route',
  'a11y',
  'console-error',
  'broken-link',
  'coverage',
  'untested-api-endpoint',
  'auth-surface',
] as const satisfies ReadonlyArray<Gap['category']>;

export type HeatmapDimension = (typeof HEATMAP_DIMENSIONS)[number];

/** Display labels for each dimension column header. */
export const DIMENSION_LABELS: Record<HeatmapDimension, string> = {
  'untested-route': 'Untested',
  'a11y': 'A11y',
  'console-error': 'Console',
  'broken-link': 'Links',
  'coverage': 'Coverage',
  'untested-api-endpoint': 'API',
  'auth-surface': 'Auth',
};

/** Severity order — higher index = worse. */
const SEVERITY_ORDER: Record<Gap['severity'], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Intensity glyph scale, indexed by SEVERITY_ORDER value (1..4). */
const SEVERITY_GLYPHS: Record<number, string> = {
  0: '·',    // no gap on this page for this dimension
  1: '🟡',   // low
  2: '🟠',   // medium
  3: '🔴',   // high
  4: '🚨',   // critical
};

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** One cell in the heatmap: the worst severity for that page × dimension. */
export type HeatmapCell = {
  /** Worst Gap severity found, or null when no gap exists. */
  worstSeverity: Gap['severity'] | null;
  /** Glyph to render in Markdown. */
  glyph: string;
  /** Count of gaps contributing to this cell. */
  count: number;
};

/** One row in the heatmap: a page path and its per-dimension cells. */
export type HeatmapRow = {
  path: string;
  /** Map from dimension to cell. Guaranteed to contain every HEATMAP_DIMENSION key. */
  cells: Record<HeatmapDimension, HeatmapCell>;
  /** Sum of severity scores across all cells — used for worst-first sort. */
  worstScore: number;
};

/** The full heatmap structure returned by buildPageHeatmap(). */
export type PageHeatmap = {
  /** Rows sorted worst-first (highest total severity score first). */
  rows: HeatmapRow[];
  /** Ordered dimension labels for use as column headers. */
  dimensions: typeof HEATMAP_DIMENSIONS;
  /** Total number of gaps that fed into the heatmap. */
  totalGaps: number;
};

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

/**
 * Build a per-page coverage heatmap from a flat list of gaps.
 *
 * @param gaps  The gaps array from GapAnalysis.
 * @returns     A PageHeatmap with rows sorted worst-first.
 */
export function buildPageHeatmap(gaps: Gap[]): PageHeatmap {
  const pageMap = new Map<string, Map<HeatmapDimension, Gap[]>>();

  for (const gap of gaps) {
    // Only include dimensions the heatmap tracks; skip unknowns gracefully.
    const dim = gap.category as HeatmapDimension;
    if (!HEATMAP_DIMENSIONS.includes(dim)) continue;

    if (!pageMap.has(gap.path)) {
      pageMap.set(gap.path, new Map());
    }
    const dimMap = pageMap.get(gap.path)!;
    if (!dimMap.has(dim)) {
      dimMap.set(dim, []);
    }
    dimMap.get(dim)!.push(gap);
  }

  const rows: HeatmapRow[] = [];

  for (const [path, dimMap] of pageMap) {
    const cells = {} as Record<HeatmapDimension, HeatmapCell>;
    let worstScore = 0;

    for (const dim of HEATMAP_DIMENSIONS) {
      const dimGaps = dimMap.get(dim) ?? [];
      if (dimGaps.length === 0) {
        cells[dim] = { worstSeverity: null, glyph: SEVERITY_GLYPHS[0], count: 0 };
      } else {
        let worst: Gap['severity'] = 'low';
        for (const g of dimGaps) {
          if (SEVERITY_ORDER[g.severity] > SEVERITY_ORDER[worst]) {
            worst = g.severity;
          }
        }
        const score = SEVERITY_ORDER[worst];
        worstScore += score;
        cells[dim] = { worstSeverity: worst, glyph: SEVERITY_GLYPHS[score], count: dimGaps.length };
      }
    }

    rows.push({ path, cells, worstScore });
  }

  // Sort worst-first (highest worstScore first), then alphabetically by path for stability.
  rows.sort((a, b) => {
    if (b.worstScore !== a.worstScore) return b.worstScore - a.worstScore;
    return a.path.localeCompare(b.path);
  });

  return {
    rows,
    dimensions: HEATMAP_DIMENSIONS,
    totalGaps: gaps.length,
  };
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

/**
 * Render a PageHeatmap as a Markdown section string.
 * Returns an empty string when there are no rows (nothing scanned).
 */
export function renderHeatmapSection(heatmap: PageHeatmap): string {
  if (heatmap.rows.length === 0) {
    return '';
  }

  const dimLabels = heatmap.dimensions.map((d) => DIMENSION_LABELS[d]);

  // Build table header
  const header = `| Page | ${dimLabels.join(' | ')} |`;
  const separator = `|------|${heatmap.dimensions.map(() => ':---:').join('|')}|`;

  const tableRows = heatmap.rows
    .map((row) => {
      const cells = heatmap.dimensions.map((d) => row.cells[d].glyph).join(' | ');
      return `| \`${row.path}\` | ${cells} |`;
    })
    .join('\n');

  const legend = [
    '**Legend:**',
    `🚨 critical`,
    `🔴 high`,
    `🟠 medium`,
    `🟡 low`,
    `· none`,
  ].join(' · ');

  return `## Per-page coverage heatmap

${header}
${separator}
${tableRows}

${legend}
`;
}
