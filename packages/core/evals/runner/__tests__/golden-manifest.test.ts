import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGoldenManifest, goldenManifestPath } from '../load-golden-manifest.js';

test('loadGoldenManifest: tracked manifest parses and has 8-12 diverse sites', () => {
  const manifest = loadGoldenManifest();

  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.coverage_tags.length >= 5, 'manifest must declare coverage_tags');
  assert.ok(
    manifest.sites.length >= 8 && manifest.sites.length <= 12,
    `expected 8-12 sites, got ${manifest.sites.length}`
  );

  const siteTags = new Set<string>();
  for (const site of manifest.sites) {
    assert.ok(site.url.startsWith('https://'), `${site.id} must use https`);
    assert.ok(Object.keys(site.expected).length > 0, `${site.id} must declare expected ground-truth`);
    for (const tag of site.coverage_tags) {
      siteTags.add(tag);
    }
  }

  for (const required of ['form-login', 'oauth', 'magic-link', 'none'] as const) {
    assert.ok(siteTags.has(required), `coverage must include at least one "${required}" site`);
  }
});

test('loadGoldenManifest: real manifest path resolves under repo datasets/golden', () => {
  assert.match(goldenManifestPath(), /datasets\/golden\/manifest\.json$/);
  const manifest = loadGoldenManifest();
  assert.ok(manifest.sites.length > 0);
});

test('loadGoldenManifest: rejects unknown coverage tag on a site', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-golden-manifest-'));
  const path = join(dir, 'manifest.json');
  try {
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        coverage_tags: ['form-login'],
        sites: [
          {
            id: 'bad-tag',
            url: 'https://example.com/login',
            name: 'Bad tag',
            coverage_tags: ['oauth'],
            expected: { hasAuth: true, type: 'oauth' },
          },
        ],
      }),
      'utf8'
    );
    assert.throws(() => loadGoldenManifest(path), /not declared in manifest\.coverage_tags/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadGoldenManifest: rejects duplicate site ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qulib-golden-manifest-'));
  const path = join(dir, 'manifest.json');
  try {
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        coverage_tags: ['none'],
        sites: [
          {
            id: 'dup',
            url: 'https://example.com/',
            name: 'One',
            coverage_tags: ['none'],
            expected: { hasAuth: false, type: 'none' },
          },
          {
            id: 'dup',
            url: 'https://example.org/',
            name: 'Two',
            coverage_tags: ['none'],
            expected: { hasAuth: false, type: 'none' },
          },
        ],
      }),
      'utf8'
    );
    assert.throws(() => loadGoldenManifest(path), /Duplicate golden site id "dup"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
