import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoldenManifestSchema, type GoldenManifest } from '../../src/schemas/golden-manifest.schema.js';

/** Repo-root `datasets/golden/manifest.json` (gitignored parent except this file). */
export function goldenManifestPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'datasets', 'golden', 'manifest.json');
}

/**
 * Load and validate the live-site golden regression manifest.
 * Throws a precise error on missing file, invalid JSON, or schema failure.
 */
export function loadGoldenManifest(path: string = goldenManifestPath()): GoldenManifest {
  if (!existsSync(path)) {
    throw new Error(`Golden manifest not found at ${path}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Golden manifest is not valid JSON: ${message}`);
  }

  const parsed = GoldenManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Golden manifest failed schema: ${parsed.error.message}`);
  }

  const manifest = parsed.data;
  const tagSet = new Set(manifest.coverage_tags);
  const seenIds = new Set<string>();

  for (const site of manifest.sites) {
    if (seenIds.has(site.id)) {
      throw new Error(`Duplicate golden site id "${site.id}"`);
    }
    seenIds.add(site.id);

    for (const tag of site.coverage_tags) {
      if (!tagSet.has(tag)) {
        throw new Error(
          `Site "${site.id}" uses coverage tag "${tag}" which is not declared in manifest.coverage_tags`
        );
      }
    }
  }

  return manifest;
}
