/**
 * Unit tests for buildPageHeatmap() and renderHeatmapSection().
 *
 * Test plan:
 * A. Golden-fixture cases — drive from datasets/golden/heatmap/*.json
 *    Each fixture supplies a `gaps` input and `expected` assertions.
 * B. Pure-function properties — determinism, stability on identical inputs.
 * C. Markdown output shape — header presence, legend, glyph scale.
 * D. Schema/export surface — runtime-import check that public exports exist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPageHeatmap, renderHeatmapSection, HEATMAP_DIMENSIONS, DIMENSION_LABELS } from '../heatmap.js';
import type { Gap } from '../../schemas/gap-analysis.schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name: string): Promise<Record<string, unknown>> {
  // from src/reporters/__tests__/ → up 3 dirs to packages/core/ → evals/golden/heatmap/
  const fixturePath = join(
    __dirname,
    '../../../evals/golden/heatmap',
    `${name}.json`
  );
  return readFile(fixturePath, 'utf-8').then((raw) => JSON.parse(raw) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// A. Golden-fixture cases
// ---------------------------------------------------------------------------

test('golden: empty-gaps — zero rows, rendered section is empty string', async () => {
  const fixture = await loadFixture('empty-gaps');
  const input = fixture['input'] as { gaps: Gap[] };
  const expected = fixture['expected'] as Record<string, unknown>;

  const heatmap = buildPageHeatmap(input.gaps);
  assert.strictEqual(heatmap.rows.length, expected['rowCount'], 'rowCount mismatch');

  const rendered = renderHeatmapSection(heatmap);
  assert.strictEqual(rendered, '', 'empty heatmap must render as empty string');
  assert.strictEqual(expected['renderedSectionEmpty'], true);
});

test('golden: multi-page-mixed-severities — worst-first row order, correct glyphs and counts', async () => {
  const fixture = await loadFixture('multi-page-mixed-severities');
  const input = fixture['input'] as { gaps: Gap[] };
  const expected = fixture['expected'] as Record<string, unknown>;

  const heatmap = buildPageHeatmap(input.gaps);

  assert.strictEqual(heatmap.rows.length, expected['rowCount'], 'rowCount mismatch');
  assert.strictEqual(heatmap.rows[0].path, expected['firstRowPath'], 'first row should be /checkout');
  assert.strictEqual(heatmap.rows[1].path, expected['secondRowPath'], 'second row should be /login');

  const checkout = heatmap.rows[0];
  assert.strictEqual(checkout.cells['untested-route'].glyph, expected['checkoutUntestedGlyph'], 'checkout untested glyph');
  assert.strictEqual(checkout.cells['a11y'].glyph, expected['checkoutA11yGlyph'], 'checkout a11y glyph');
  assert.strictEqual(checkout.cells['a11y'].count, expected['checkoutA11yCount'], 'checkout a11y has 2 gaps');

  const login = heatmap.rows[1];
  assert.strictEqual(login.cells['console-error'].glyph, expected['loginConsoleGlyph'], 'login console-error glyph');
  assert.strictEqual(login.cells['untested-route'].glyph, expected['loginUntestedGlyph'], 'login untested glyph');
  assert.strictEqual(login.cells['a11y'].glyph, expected['loginA11yGlyph'], 'login a11y has no gap → · glyph');

  const rendered = renderHeatmapSection(heatmap);
  assert.ok(rendered.includes('Legend'), 'rendered section must include legend');
  assert.ok(rendered.includes('Per-page coverage heatmap'), 'rendered section must include header');
});

test('golden: single-page-all-dimensions — all 7 columns populated with correct glyphs', async () => {
  const fixture = await loadFixture('single-page-all-dimensions');
  const input = fixture['input'] as { gaps: Gap[] };
  const expected = fixture['expected'] as Record<string, unknown>;

  const heatmap = buildPageHeatmap(input.gaps);

  assert.strictEqual(heatmap.rows.length, expected['rowCount']);
  assert.strictEqual(heatmap.rows[0].path, expected['firstRowPath']);
  assert.strictEqual(heatmap.dimensions.length, expected['dimensionCount']);

  const row = heatmap.rows[0];
  assert.strictEqual(row.cells['untested-route'].glyph, expected['untestedGlyph'], 'untested-route critical → 🚨');
  assert.strictEqual(row.cells['a11y'].glyph, expected['a11yGlyph'], 'a11y high → 🔴');
  assert.strictEqual(row.cells['console-error'].glyph, expected['consoleGlyph'], 'console-error medium → 🟠');
  assert.strictEqual(row.cells['broken-link'].glyph, expected['brokenLinkGlyph'], 'broken-link low → 🟡');
  assert.strictEqual(row.cells['coverage'].glyph, expected['coverageGlyph'], 'coverage high → 🔴');
  assert.strictEqual(row.cells['untested-api-endpoint'].glyph, expected['apiGlyph'], 'api-endpoint critical → 🚨');
  assert.strictEqual(row.cells['auth-surface'].glyph, expected['authGlyph'], 'auth-surface medium → 🟠');

  const rendered = renderHeatmapSection(heatmap);
  for (const label of Object.values(DIMENSION_LABELS)) {
    assert.ok(rendered.includes(label), `rendered section must include column label: ${label}`);
  }
});

test('golden: worst-first-sort — 4 rows ordered by total severity score', async () => {
  const fixture = await loadFixture('worst-first-sort');
  const input = fixture['input'] as { gaps: Gap[] };
  const expected = fixture['expected'] as Record<string, unknown>;

  const heatmap = buildPageHeatmap(input.gaps);
  const orderedPaths = expected['orderedPaths'] as string[];

  assert.strictEqual(heatmap.rows.length, expected['rowCount']);
  for (let i = 0; i < orderedPaths.length; i++) {
    assert.strictEqual(
      heatmap.rows[i].path,
      orderedPaths[i],
      `row[${i}] should be ${orderedPaths[i]}, got ${heatmap.rows[i].path}`
    );
  }
});

// ---------------------------------------------------------------------------
// B. Pure-function properties
// ---------------------------------------------------------------------------

test('buildPageHeatmap is deterministic — same input produces identical output', () => {
  const gaps: Gap[] = [
    { id: 'g1', path: '/home', severity: 'high', category: 'a11y', reason: 'Missing alt' },
    { id: 'g2', path: '/home', severity: 'critical', category: 'untested-route', reason: 'No tests' },
    { id: 'g3', path: '/contact', severity: 'low', category: 'broken-link', reason: '404' },
  ];
  const first = buildPageHeatmap(gaps);
  const second = buildPageHeatmap(gaps);
  assert.deepStrictEqual(first, second, 'repeated calls with same input must produce equal output');
});

test('buildPageHeatmap: worstScore picks the highest severity per dimension', () => {
  const gaps: Gap[] = [
    { id: 'g1', path: '/p', severity: 'low', category: 'a11y', reason: 'r1' },
    { id: 'g2', path: '/p', severity: 'critical', category: 'a11y', reason: 'r2' },
    { id: 'g3', path: '/p', severity: 'medium', category: 'a11y', reason: 'r3' },
  ];
  const heatmap = buildPageHeatmap(gaps);
  assert.strictEqual(heatmap.rows.length, 1);
  // critical (4) is worst
  assert.strictEqual(heatmap.rows[0].cells['a11y'].worstSeverity, 'critical');
  assert.strictEqual(heatmap.rows[0].cells['a11y'].count, 3);
  assert.strictEqual(heatmap.rows[0].cells['a11y'].glyph, '🚨');
});

test('buildPageHeatmap: pages with no gaps are absent from the heatmap', () => {
  const gaps: Gap[] = [
    { id: 'g1', path: '/present', severity: 'medium', category: 'coverage', reason: 'r' },
  ];
  const heatmap = buildPageHeatmap(gaps);
  assert.ok(heatmap.rows.every((r) => r.path !== '/absent'));
  assert.strictEqual(heatmap.rows.length, 1);
});

test('buildPageHeatmap: totalGaps reflects the full gaps array length', () => {
  const gaps: Gap[] = [
    { id: 'g1', path: '/a', severity: 'low', category: 'a11y', reason: 'r' },
    { id: 'g2', path: '/b', severity: 'high', category: 'untested-route', reason: 'r' },
    { id: 'g3', path: '/a', severity: 'medium', category: 'console-error', reason: 'r' },
  ];
  const heatmap = buildPageHeatmap(gaps);
  assert.strictEqual(heatmap.totalGaps, 3);
});

// ---------------------------------------------------------------------------
// C. Markdown output shape
// ---------------------------------------------------------------------------

test('renderHeatmapSection: contains ## header and legend when rows exist', () => {
  const gaps: Gap[] = [
    { id: 'g1', path: '/checkout', severity: 'critical', category: 'untested-route', reason: 'No tests' },
  ];
  const rendered = renderHeatmapSection(buildPageHeatmap(gaps));
  assert.ok(rendered.startsWith('## Per-page coverage heatmap'), 'must start with H2 header');
  assert.ok(rendered.includes('Legend'), 'must include legend');
  assert.ok(rendered.includes('🚨'), 'must include critical glyph');
  assert.ok(rendered.includes('none'), 'must include none label');
});

test('renderHeatmapSection: each dimension label appears exactly once in column header', () => {
  const gaps: Gap[] = [
    { id: 'g1', path: '/p', severity: 'high', category: 'a11y', reason: 'r' },
  ];
  const rendered = renderHeatmapSection(buildPageHeatmap(gaps));
  const headerLine = rendered.split('\n').find((l) => l.startsWith('| Page'));
  assert.ok(headerLine, 'table header line must be present');
  for (const label of Object.values(DIMENSION_LABELS)) {
    assert.ok(headerLine.includes(label), `header must contain label: ${label}`);
  }
});

test('renderHeatmapSection: table row uses backtick-wrapped path', () => {
  const gaps: Gap[] = [
    { id: 'g1', path: '/cart', severity: 'medium', category: 'coverage', reason: 'r' },
  ];
  const rendered = renderHeatmapSection(buildPageHeatmap(gaps));
  assert.ok(rendered.includes('`/cart`'), 'page path must be backtick-wrapped in table row');
});

test('renderHeatmapSection: returns empty string for zero-row heatmap', () => {
  const rendered = renderHeatmapSection(buildPageHeatmap([]));
  assert.strictEqual(rendered, '');
});

// ---------------------------------------------------------------------------
// D. Schema / export surface (runtime-import check)
// ---------------------------------------------------------------------------

test('runtime-import: buildPageHeatmap, renderHeatmapSection, HEATMAP_DIMENSIONS, DIMENSION_LABELS exported from @qulib/core', async () => {
  const exports = await import('../../index.js');
  assert.ok(typeof exports.buildPageHeatmap === 'function', 'buildPageHeatmap must be a function');
  assert.ok(typeof exports.renderHeatmapSection === 'function', 'renderHeatmapSection must be a function');
  assert.ok(Array.isArray(exports.HEATMAP_DIMENSIONS), 'HEATMAP_DIMENSIONS must be an array');
  assert.ok(typeof exports.DIMENSION_LABELS === 'object', 'DIMENSION_LABELS must be an object');
  // Verify every dimension has a label
  for (const dim of exports.HEATMAP_DIMENSIONS) {
    assert.ok(
      dim in exports.DIMENSION_LABELS,
      `DIMENSION_LABELS must contain entry for ${dim}`
    );
  }
});
