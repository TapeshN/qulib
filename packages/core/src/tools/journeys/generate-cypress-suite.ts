/**
 * Journey → Cypress suite generator.
 *
 * Consumes validated Chrome DevTools Recorder flows (the journey interchange
 * in `schemas/recorder-flow.schema.ts`), converts them via the existing
 * `importRecorderFlow` importer, and renders one Cypress spec per journey
 * through `CypressE2EAdapter` — the same adapter seam `scaffoldTests` uses.
 * No second journey model; no forked step mapping.
 *
 * Determinism contract (hard):
 *   - input journeys are processed in stable lexicographic filename order
 *   - output filenames are derived from scenario id / title slug only
 *   - generated code contains no timestamps, UUIDs, or randomness
 *   - identical inputs → byte-identical outputs on re-run
 *
 * Regression tagging: optional `tags` on the Recorder envelope (e.g. "smoke",
 * "regression") become describe-title annotations (`@smoke`, `@regression`).
 * The importer marker tag `recorder-import` is never annotated.
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { CypressE2EAdapter } from '../../adapters/cypress-e2e-adapter.js';
import type { NeutralScenario } from '../../schemas/gap-analysis.schema.js';
import { importRecorderFlow } from './recorder-import.js';

/** Tags that become `@name` annotations on the Cypress `describe` title. */
const REGRESSION_ANNOTATION_TAGS = new Set(['smoke', 'regression']);

export interface GeneratedCypressSpec {
  /** NeutralScenario / journey id (e.g. `recorder-listly-login-flow`). */
  journeyId: string;
  /** Basename written under the output dir (e.g. `listly-login-flow.cy.ts`). */
  filename: string;
  /** Spec body — byte-stable for identical inputs. */
  code: string;
  /** Path relative to the output directory. */
  relativePath: string;
  /** Non-fatal importer warnings for this journey. */
  warnings: string[];
}

export interface GenerateCypressSuiteResult {
  specs: GeneratedCypressSpec[];
  /** Journeys that converted to zero steps (skipped, not written). */
  skipped: Array<{ source: string; reason: string; warnings: string[] }>;
}

/**
 * Normalize a journey tag into a bare annotation token (`smoke` → `smoke`,
 * `@Smoke` → `smoke`). Returns undefined when the tag is not a regression
 * annotation (including the importer marker `recorder-import`).
 */
export function toRegressionAnnotation(tag: string): string | undefined {
  const bare = tag.trim().replace(/^@/, '').toLowerCase();
  if (!bare || bare === 'recorder-import') return undefined;
  if (!REGRESSION_ANNOTATION_TAGS.has(bare)) return undefined;
  return bare;
}

/**
 * Derive ordered, de-duplicated `@tag` tokens from scenario tags.
 * Stable order: smoke before regression, then any future set members alphabetically.
 */
export function regressionAnnotationsFromTags(tags: readonly string[]): string[] {
  const found = new Set<string>();
  for (const tag of tags) {
    const bare = toRegressionAnnotation(tag);
    if (bare) found.add(bare);
  }
  return [...found].sort((a, b) => {
    // Prefer the documented examples first for stable, readable titles.
    const order = (t: string): number => (t === 'smoke' ? 0 : t === 'regression' ? 1 : 2);
    const d = order(a) - order(b);
    return d !== 0 ? d : a.localeCompare(b);
  });
}

/**
 * Append `@smoke` / `@regression` (etc.) to a describe title. Pure.
 * Does not mutate tags that are already present as `@token` in the title.
 */
export function annotateDescribeTitle(title: string, tags: readonly string[]): string {
  const annotations = regressionAnnotationsFromTags(tags);
  if (annotations.length === 0) return title;
  const missing = annotations.filter((a) => !new RegExp(`(?:^|\\s)@${a}(?:\\s|$)`, 'i').test(title));
  if (missing.length === 0) return title;
  return `${title} ${missing.map((a) => `@${a}`).join(' ')}`;
}

/** Apply regression describe-title annotations; leaves other scenario fields intact. */
export function withRegressionDescribeTitle(scenario: NeutralScenario): NeutralScenario {
  const annotated = annotateDescribeTitle(scenario.title, scenario.tags);
  if (annotated === scenario.title) return scenario;
  return { ...scenario, title: annotated };
}

/**
 * Render via the Cypress adapter using the ORIGINAL scenario title (so the
 * filename slug stays free of `@smoke`/`@regression`), then rewrite only the
 * `describe(...)` title to carry regression annotations. Keeps filenames and
 * journey ids stable across tag edits.
 */
function renderAnnotatedSpec(scenario: NeutralScenario): { filename: string; code: string } {
  const generated = new CypressE2EAdapter().render(scenario);
  const annotatedTitle = annotateDescribeTitle(scenario.title, scenario.tags);
  if (annotatedTitle === scenario.title) {
    return { filename: generated.filename, code: generated.code };
  }
  // Replace the first describe("…") / describe('…') title only — the adapter
  // always emits describe as the first describe() call in the file.
  const original = JSON.stringify(scenario.title);
  const annotated = JSON.stringify(annotatedTitle);
  const needle = `describe(${original},`;
  const replacement = `describe(${annotated},`;
  if (!generated.code.includes(needle)) {
    // Adapter output shape drifted — fail closed rather than silently omit tags.
    throw new Error(
      `Cypress adapter output missing expected describe(${original}, …) for regression annotation`
    );
  }
  return {
    filename: generated.filename,
    code: generated.code.replace(needle, replacement),
  };
}

/**
 * Convert one validated Recorder journey into a Cypress spec string.
 * Throws when the raw value fails RecorderFlowSchema validation.
 */
export function generateCypressSpecFromJourney(
  raw: unknown,
  sourceLabel = 'journey'
): GeneratedCypressSpec {
  const { scenario, warnings, rejected } = importRecorderFlow(raw);
  if (rejected) {
    throw new Error(
      `${sourceLabel}: every recorded step was unmappable — refusing to emit an empty Cypress spec`
    );
  }
  const generated = renderAnnotatedSpec(scenario);
  return {
    journeyId: scenario.id,
    filename: generated.filename,
    code: generated.code,
    relativePath: generated.filename,
    warnings,
  };
}

/**
 * Generate specs for many journeys. `entries` are sorted by `source` for
 * deterministic ordering before conversion; callers that already sorted may
 * still rely on this as a second stable pass.
 */
export function generateCypressSuite(
  entries: ReadonlyArray<{ source: string; raw: unknown }>
): GenerateCypressSuiteResult {
  const sorted = [...entries].sort((a, b) => a.source.localeCompare(b.source));
  const specs: GeneratedCypressSpec[] = [];
  const skipped: GenerateCypressSuiteResult['skipped'] = [];
  const usedFilenames = new Set<string>();

  for (const entry of sorted) {
    const { scenario, warnings, rejected } = importRecorderFlow(entry.raw);
    if (rejected) {
      skipped.push({
        source: entry.source,
        reason: 'zero convertible steps',
        warnings,
      });
      continue;
    }
    const generated = renderAnnotatedSpec(scenario);
    // Collision guard: two journeys slugifying to the same filename get a
    // stable numeric suffix derived from encounter order (deterministic).
    let filename = generated.filename;
    if (usedFilenames.has(filename)) {
      const base = filename.replace(/\.cy\.ts$/, '');
      let n = 2;
      while (usedFilenames.has(`${base}-${n}.cy.ts`)) n += 1;
      filename = `${base}-${n}.cy.ts`;
    }
    usedFilenames.add(filename);
    specs.push({
      journeyId: scenario.id,
      filename,
      code: generated.code,
      relativePath: filename,
      warnings,
    });
  }

  return { specs, skipped };
}

/** True when a directory entry looks like a journey JSON file. */
function isJourneyJsonName(name: string): boolean {
  return name.endsWith('.json') && !name.startsWith('.');
}

/**
 * Read all `*.json` journeys from `inputDir` (non-recursive), generate specs,
 * and write them under `outputDir`. Returns the in-memory result as well.
 */
export async function generateCypressSuiteFromDir(
  inputDir: string,
  outputDir: string
): Promise<GenerateCypressSuiteResult> {
  const absIn = resolve(inputDir);
  const absOut = resolve(outputDir);
  const names = (await readdir(absIn)).filter(isJourneyJsonName).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    throw new Error(`No journey JSON files (*.json) found in ${absIn}`);
  }

  const entries: Array<{ source: string; raw: unknown }> = [];
  for (const name of names) {
    const path = join(absIn, name);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read journey file ${path}: ${msg}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Journey file is not valid JSON (${basename(path)}): ${msg}`);
    }
    entries.push({ source: name, raw });
  }

  const result = generateCypressSuite(entries);
  await mkdir(absOut, { recursive: true });
  for (const spec of result.specs) {
    await writeFile(join(absOut, spec.filename), spec.code, 'utf8');
  }
  return result;
}
