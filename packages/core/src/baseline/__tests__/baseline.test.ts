import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  slugifyUrl,
  saveBaseline,
  loadBaseline,
  listBaselines,
  deleteBaseline,
  compareBaselines,
} from '../baseline.js';
import type { BaselineSnapshot } from '../baseline.schema.js';
import type { GapAnalysis, Gap } from '../../schemas/gap-analysis.schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGap(overrides: Partial<Gap> = {}): Gap {
  return {
    id: 'gap-1',
    path: '/login',
    severity: 'high',
    reason: 'No login test',
    category: 'untested-route',
    ...overrides,
  };
}

function makeAnalysis(gaps: Gap[] = [], confidence = 80): GapAnalysis {
  return {
    analyzedAt: new Date().toISOString(),
    mode: 'url-only',
    releaseConfidence: confidence,
    coveragePagesScanned: 5,
    coverageBudgetExceeded: false,
    gaps,
    scenarios: [],
    generatedTests: [],
  };
}

// ---------------------------------------------------------------------------
// slugifyUrl
// ---------------------------------------------------------------------------

test('slugifyUrl strips scheme and replaces non-word chars', () => {
  const slug = slugifyUrl('https://my-app.vercel.app/admin');
  assert.ok(!slug.includes('://'), 'scheme removed');
  assert.ok(!slug.includes('/'), 'slashes replaced');
  assert.match(slug, /^[a-zA-Z0-9._-]+$/, 'only safe chars remain');
});

test('slugifyUrl is stable (same input → same output)', () => {
  const url = 'https://example.com/path?q=1';
  assert.equal(slugifyUrl(url), slugifyUrl(url));
});

test('slugifyUrl handles localhost URLs', () => {
  const slug = slugifyUrl('http://localhost:3000');
  assert.ok(slug.length > 0);
  assert.match(slug, /^[a-zA-Z0-9._-]+$/);
});

// ---------------------------------------------------------------------------
// saveBaseline / loadBaseline (real disk I/O)
// ---------------------------------------------------------------------------

test('saveBaseline writes a file and loadBaseline reads it back', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    const url = 'https://staging.example.com';
    const analysis = makeAnalysis([makeGap()], 72);

    const snapshot = await saveBaseline(analysis, url, { baseDir: tmpDir });

    assert.equal(snapshot.url, url);
    assert.equal(snapshot.releaseConfidence, 72);
    assert.equal(snapshot.gapCount, 1);
    assert.equal(snapshot.gaps.length, 1);
    assert.equal(snapshot.gaps[0].path, '/login');

    const loaded = await loadBaseline(snapshot.id, { baseDir: tmpDir });
    assert.deepEqual(loaded, snapshot);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('saveBaseline strips Gap.id and optional fields not in BaselineGap', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    const gap = makeGap({ description: 'some description', recommendation: 'add a test' });
    const snapshot = await saveBaseline(makeAnalysis([gap]), 'https://example.com', { baseDir: tmpDir });

    const g = snapshot.gaps[0];
    assert.ok(!('id' in g), 'Gap.id must not appear in BaselineGap');
    assert.ok(!('description' in g), 'description must not appear in BaselineGap');
    assert.ok(!('recommendation' in g), 'recommendation must not appear in BaselineGap');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('saveBaseline stores optional label when provided', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    const snapshot = await saveBaseline(makeAnalysis(), 'https://example.com', {
      baseDir: tmpDir,
      label: 'before-refactor',
    });
    assert.equal(snapshot.label, 'before-refactor');

    const loaded = await loadBaseline(snapshot.id, { baseDir: tmpDir });
    assert.equal(loaded.label, 'before-refactor');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('loadBaseline throws when baseline does not exist', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    await assert.rejects(
      () => loadBaseline('example_com__2099-01-01T00-00-00', { baseDir: tmpDir }),
      /Baseline not found/
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('loadBaseline throws on an id without the __ separator', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    await assert.rejects(() => loadBaseline('invalid-id-no-separator', { baseDir: tmpDir }), /Invalid baseline id/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// listBaselines
// ---------------------------------------------------------------------------

test('listBaselines returns an empty array when no baselines exist', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    const list = await listBaselines('https://example.com', { baseDir: tmpDir });
    assert.deepEqual(list, []);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('listBaselines returns all saved snapshots for a URL, newest first', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    const url = 'https://app.example.com';
    const a = await saveBaseline(makeAnalysis([], 60), url, { baseDir: tmpDir });
    // Wait 2ms so the millisecond-precision timestamp advances.
    await new Promise((r) => setTimeout(r, 2));
    const b = await saveBaseline(makeAnalysis([], 70), url, { baseDir: tmpDir });

    const list = await listBaselines(url, { baseDir: tmpDir });
    assert.equal(list.length, 2);
    // Newest first: b has a later savedAt
    assert.ok(
      new Date(list[0].savedAt).getTime() >= new Date(list[1].savedAt).getTime(),
      'list is newest-first'
    );
    const ids = list.map((s) => s.id);
    assert.ok(ids.includes(a.id));
    assert.ok(ids.includes(b.id));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('listBaselines is URL-scoped: different URLs do not bleed into each other', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    await saveBaseline(makeAnalysis(), 'https://app-a.example.com', { baseDir: tmpDir });
    await saveBaseline(makeAnalysis(), 'https://app-b.example.com', { baseDir: tmpDir });

    const listA = await listBaselines('https://app-a.example.com', { baseDir: tmpDir });
    const listB = await listBaselines('https://app-b.example.com', { baseDir: tmpDir });

    assert.equal(listA.length, 1);
    assert.equal(listB.length, 1);
    assert.notEqual(listA[0].id, listB[0].id);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// deleteBaseline
// ---------------------------------------------------------------------------

test('deleteBaseline removes the file so loadBaseline throws afterward', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    const snap = await saveBaseline(makeAnalysis(), 'https://example.com', { baseDir: tmpDir });

    await deleteBaseline(snap.id, { baseDir: tmpDir });

    await assert.rejects(() => loadBaseline(snap.id, { baseDir: tmpDir }), /Baseline not found/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('deleteBaseline throws when the baseline does not exist', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'qulib-test-'));
  try {
    await assert.rejects(
      () => deleteBaseline('example_com__2099-01-01T00-00-00', { baseDir: tmpDir }),
      /Baseline not found/
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// compareBaselines (pure — no disk I/O)
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<BaselineSnapshot>): BaselineSnapshot {
  return {
    id: 'slug__2024-01-01T00-00-00',
    url: 'https://example.com',
    savedAt: new Date().toISOString(),
    releaseConfidence: 80,
    gapCount: 0,
    gaps: [],
    ...overrides,
  };
}

test('compareBaselines: identical snapshots produce empty delta', () => {
  const snap = makeSnapshot({ releaseConfidence: 80, gaps: [] });
  const delta = compareBaselines(snap, snap);

  assert.equal(delta.newGaps.length, 0);
  assert.equal(delta.resolvedGaps.length, 0);
  assert.equal(delta.severityChanges.length, 0);
  assert.equal(delta.confidenceDelta, 0);
  assert.match(delta.summary, /unchanged/);
});

test('compareBaselines: new gap detected when current has extra gap', () => {
  const prior = makeSnapshot({ releaseConfidence: 90, gaps: [] });
  const current = makeSnapshot({
    releaseConfidence: 70,
    gapCount: 1,
    gaps: [{ path: '/checkout', severity: 'high', category: 'untested-route', reason: 'Not covered' }],
  });

  const delta = compareBaselines(prior, current);

  assert.equal(delta.newGaps.length, 1);
  assert.equal(delta.newGaps[0].status, 'new');
  assert.equal(delta.newGaps[0].path, '/checkout');
  assert.equal(delta.resolvedGaps.length, 0);
  assert.equal(delta.confidenceDelta, -20);
  assert.match(delta.summary, /regressed/);
});

test('compareBaselines: resolved gap detected when prior had gap but current does not', () => {
  const prior = makeSnapshot({
    releaseConfidence: 70,
    gapCount: 1,
    gaps: [{ path: '/checkout', severity: 'high', category: 'untested-route', reason: 'Not covered' }],
  });
  const current = makeSnapshot({ releaseConfidence: 90, gaps: [] });

  const delta = compareBaselines(prior, current);

  assert.equal(delta.resolvedGaps.length, 1);
  assert.equal(delta.resolvedGaps[0].status, 'resolved');
  assert.equal(delta.newGaps.length, 0);
  assert.equal(delta.confidenceDelta, 20);
  assert.match(delta.summary, /improved/);
});

test('compareBaselines: severity-increased when same path+category worsens', () => {
  const prior = makeSnapshot({
    gaps: [{ path: '/login', severity: 'low', category: 'a11y', reason: 'minor a11y issue' }],
  });
  const current = makeSnapshot({
    gaps: [{ path: '/login', severity: 'critical', category: 'a11y', reason: 'critical a11y issue' }],
  });

  const delta = compareBaselines(prior, current);

  assert.equal(delta.severityChanges.length, 1);
  assert.equal(delta.severityChanges[0].status, 'severity-increased');
  assert.equal(delta.severityChanges[0].path, '/login');
  assert.equal(delta.newGaps.length, 0);
  assert.equal(delta.resolvedGaps.length, 0);
});

test('compareBaselines: severity-decreased when same path+category improves', () => {
  const prior = makeSnapshot({
    gaps: [{ path: '/dashboard', severity: 'critical', category: 'console-error', reason: 'JS error' }],
  });
  const current = makeSnapshot({
    gaps: [{ path: '/dashboard', severity: 'medium', category: 'console-error', reason: 'JS warning' }],
  });

  const delta = compareBaselines(prior, current);

  assert.equal(delta.severityChanges.length, 1);
  assert.equal(delta.severityChanges[0].status, 'severity-decreased');
  assert.equal(delta.newGaps.length, 0);
  assert.equal(delta.resolvedGaps.length, 0);
});

test('compareBaselines: fromId and toId are set correctly from snapshot ids', () => {
  const prior = makeSnapshot({ id: 'slug__2024-01-01T00-00-00' });
  const current = makeSnapshot({ id: 'slug__2024-02-01T00-00-00' });

  const delta = compareBaselines(prior, current);
  assert.equal(delta.fromId, 'slug__2024-01-01T00-00-00');
  assert.equal(delta.toId, 'slug__2024-02-01T00-00-00');
});
