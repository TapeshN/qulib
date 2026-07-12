/**
 * Golden-case loader for the eval runner (Q2d).
 *
 * A golden case is a single `*.json` file under `evals/golden/<suite>/` that parses
 * to an `EvalCase` (see evals/types.ts). This loader reads every case file for a
 * suite, validates the shared envelope with zod (mirrors qulib's zod-everywhere
 * convention), and returns them sorted by id for stable run order. Suite-specific
 * `input`/`expected` validation lives in each run-* module — the loader stays
 * suite-agnostic, matching the contract in evals/README.md.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { EvalCase, EvalSuite } from '../types.js';

export const EVAL_SUITES: readonly EvalSuite[] = ['scaffold', 'score-automation', 'confidence', 'evidence', 'analyze-diff', 'prompt-leakage', 'provenance'] as const;

/** Shared envelope validator. `input`/`expected` are passthrough objects (suite narrows them). */
const EvalCaseSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'case id must be kebab-case'),
  suite: z.enum(['scaffold', 'score-automation', 'confidence', 'evidence', 'analyze-diff', 'prompt-leakage', 'provenance']),
  description: z.string().min(1),
  input: z.record(z.unknown()),
  expected: z.record(z.unknown()),
  tags: z.array(z.string()).optional(),
  cleanTwinOf: z.string().min(1).optional(),
});

/**
 * Tokenize a case's `input` for a cheap structural/text similarity check —
 * lowercase the serialized JSON and split on non-alphanumeric runs. Good
 * enough to distinguish "same fixture, defect lines removed" (the intended
 * clean-twin shape) from "structurally unrelated fixture" without pulling in
 * a diff dependency; fixtures here are small hand-authored JSON, not large
 * documents.
 */
function tokenize(input: Record<string, unknown>): Set<string> {
  const text = JSON.stringify(input).toLowerCase();
  const tokens = text.match(/[a-z0-9]+/g) ?? [];
  return new Set(tokens);
}

/** Jaccard similarity of two token sets: |intersection| / |union|, in [0, 1]. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Minimum Jaccard token-similarity a twin's `input` must share with the
 * `input` of the case it twins. Calibrated against the real reference pairs
 * (`clean-header`/`leaky-header` ≈ 0.48, `clean-route`/`leaky-inline-script`
 * ≈ 0.50 — a twin derived by deleting a few seeded-defect lines) with a wide
 * safety margin below both and well above a structurally unrelated fixture
 * (≈ 0.03 in the same corpus) — see evals/README.md § "Clean-twin
 * false-positive guard".
 */
const CLEAN_TWIN_MIN_SIMILARITY = 0.2;

/** Absolute path to evals/golden (one level up from runner/). */
export function goldenRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'golden');
}

/** Absolute path to evals/ledger.jsonl. */
export function ledgerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'ledger.jsonl');
}

/**
 * Load + validate all golden cases for one suite. Throws a precise error if a file
 * is malformed JSON, fails the envelope schema, or declares a mismatched `suite`
 * (an early, loud failure beats silently skipping a case — GL-005 / fail-once).
 */
export function loadCases(suite: EvalSuite, root: string = goldenRoot()): EvalCase[] {
  const dir = join(root, suite);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const cases: EvalCase[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const full = join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(full, 'utf8'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Golden case ${suite}/${file} is not valid JSON: ${message}`);
    }
    const parsed = EvalCaseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Golden case ${suite}/${file} failed schema: ${parsed.error.message}`);
    }
    if (parsed.data.suite !== suite) {
      throw new Error(
        `Golden case ${suite}/${file} declares suite "${parsed.data.suite}" but lives under "${suite}/".`
      );
    }
    if (seen.has(parsed.data.id)) {
      throw new Error(`Duplicate golden case id "${parsed.data.id}" in suite "${suite}".`);
    }
    seen.add(parsed.data.id);
    cases.push(parsed.data);
  }
  // Cross-reference clean-twin pairing after every case in the suite is known: a twin
  // must point at a seeded-defect case id that actually exists in this same suite —
  // a dangling cleanTwinOf silently drops out of the falsePositiveRate metric instead
  // of ever being computed, so fail loudly at load time rather than let it go quiet.
  const byId = new Map(cases.map((c) => [c.id, c] as const));
  for (const c of cases) {
    if (c.cleanTwinOf !== undefined && !seen.has(c.cleanTwinOf)) {
      throw new Error(
        `Golden case "${c.id}" in suite "${suite}" declares cleanTwinOf: "${c.cleanTwinOf}", which is not a known case id in this suite.`
      );
    }
    if (c.cleanTwinOf === c.id) {
      throw new Error(`Golden case "${c.id}" in suite "${suite}" cannot declare itself as its own cleanTwinOf.`);
    }
    // A twin only pads the falsePositiveRate denominator honestly when it is
    // actually a near-duplicate of the case it twins (the intended shape:
    // same fixture, seeded defect(s) deleted) — otherwise a structurally
    // unrelated case could declare cleanTwinOf and inflate the metric's
    // sample size with zero real coverage. Reject a twin whose `input`
    // token-similarity to its seeded case falls below the calibrated floor.
    if (c.cleanTwinOf !== undefined) {
      const seeded = byId.get(c.cleanTwinOf);
      if (seeded) {
        const similarity = jaccardSimilarity(tokenize(c.input), tokenize(seeded.input));
        if (similarity < CLEAN_TWIN_MIN_SIMILARITY) {
          throw new Error(
            `Golden case "${c.id}" in suite "${suite}" declares cleanTwinOf: "${c.cleanTwinOf}" but its input ` +
              `is not a plausible near-duplicate of that case's input (token similarity ${similarity.toFixed(2)} ` +
              `< required ${CLEAN_TWIN_MIN_SIMILARITY}). A clean twin must be the SAME fixture with the seeded ` +
              `defect(s) removed, not a structurally unrelated case — see evals/README.md § "Clean-twin ` +
              `false-positive guard".`
          );
        }
      }
    }
  }
  return cases;
}
