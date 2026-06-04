/**
 * Judge prompt construction + response parsing (Q2c — eval-judge).
 *
 * Split out from judge.ts so the prompt shape and the (brittle-by-nature) parsing
 * of an LLM's JSON reply are independently unit-testable WITHOUT a network call.
 * The judge model is asked to return strict JSON; `parseJudgeResponse` tolerates
 * code fences and surrounding prose, validates shape, and clamps scores to [0,1].
 */

import type { Rubric } from './rubrics.js';

/** The candidate to grade: subject text + the grounding context the rubric checks against. */
export interface JudgeSubject {
  /** The non-deterministic artifact under judgment (a generated spec, or a maturity narrative). */
  candidate: string;
  /**
   * Structured grounding the judge MUST grade against (e.g. discovered routes for
   * scaffold, or computed maturity numbers for score-automation). Serialized as
   * pretty JSON into the prompt. Keep it small and factual — this is the truth set.
   */
  grounding: Record<string, unknown>;
  /**
   * Optional model that PRODUCED the candidate. Recorded so the runner can refuse
   * to let a model grade its own turn (root doctrine #11). Not sent to the judge.
   */
  subjectModel?: string;
}

/** Raw, validated shape parsed out of the judge's JSON reply (pre-aggregation). */
export interface ParsedJudgeResponse {
  dimensions: Array<{ key: string; score: number; rationale: string }>;
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)\s*```/i;

/**
 * Build the judge prompt. The judge is a SEPARATE call from whatever produced the
 * candidate — it receives the candidate strictly as data to grade, never as its own
 * prior turn. Output contract: a single JSON object with one entry per rubric
 * dimension, each scored 0..1 with a one-sentence rationale.
 */
export function buildJudgePrompt(rubric: Rubric, subject: JudgeSubject): string {
  const dimList = rubric.dimensions
    .map(
      (d, i) =>
        `${i + 1}. "${d.key}" — ${d.title}\n   ${d.guidance}${d.critical ? '\n   (CRITICAL: a near-zero score here fails the whole candidate.)' : ''}`
    )
    .join('\n');

  const skeleton = JSON.stringify(
    {
      dimensions: rubric.dimensions.map((d) => ({ key: d.key, score: 0, rationale: '' })),
    },
    null,
    2
  );

  return [
    `You are a strict, impartial QA evaluator. You are grading an automatically generated artifact against a fixed rubric. You did NOT write the artifact; treat it purely as input data to judge. Do not be charitable — reward only what is actually present and grounded in the provided facts.`,
    ``,
    `## Rubric: ${rubric.summary}`,
    ``,
    `Score each dimension from 0.0 (not met at all) to 1.0 (fully met). Be calibrated: 0.5 means partially met.`,
    ``,
    dimList,
    ``,
    `## Grounding facts (the ONLY source of truth — anything in the candidate not supported by these is unsupported/hallucinated):`,
    '```json',
    JSON.stringify(subject.grounding, null, 2),
    '```',
    ``,
    `## Candidate under judgment:`,
    '```',
    subject.candidate,
    '```',
    ``,
    `## Output`,
    `Respond with ONLY a JSON object in exactly this shape (same dimension keys, scores in [0,1], a one-sentence rationale each). No prose before or after.`,
    '```json',
    skeleton,
    '```',
  ].join('\n');
}

/** Clamp a number into [0,1]; non-finite ⇒ 0 (defensive against a model emitting NaN/strings). */
function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Parse + validate the judge's reply. Tolerant of:
 *   - a ```json fenced block,
 *   - leading/trailing prose around a bare object,
 *   - extra/duplicate dimension keys (deduped, unknown keys dropped by the caller).
 *
 * Throws on irrecoverable shape (no JSON object, no dimensions array) so the caller
 * can record a FAIL with the parse error rather than silently scoring 0. Scores are
 * clamped to [0,1]; a missing rationale becomes ''.
 */
export function parseJudgeResponse(raw: string): ParsedJudgeResponse {
  if (!raw || !raw.trim()) throw new Error('judge returned empty response');

  let jsonText = raw.trim();
  const fenced = jsonText.match(FENCE_RE);
  if (fenced && fenced[1]) {
    jsonText = fenced[1].trim();
  } else {
    // No fence — grab the outermost {...} so surrounding prose doesn't break JSON.parse.
    const first = jsonText.indexOf('{');
    const last = jsonText.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      jsonText = jsonText.slice(first, last + 1);
    }
  }

  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`judge response was not valid JSON: ${msg}`);
  }

  if (typeof obj !== 'object' || obj === null || !Array.isArray((obj as { dimensions?: unknown }).dimensions)) {
    throw new Error('judge response missing a "dimensions" array');
  }

  const rawDims = (obj as { dimensions: unknown[] }).dimensions;
  const dimensions: ParsedJudgeResponse['dimensions'] = [];
  const seen = new Set<string>();
  for (const d of rawDims) {
    if (typeof d !== 'object' || d === null) continue;
    const key = (d as { key?: unknown }).key;
    if (typeof key !== 'string' || key.length === 0) continue;
    if (seen.has(key)) continue; // first occurrence wins on duplicates
    seen.add(key);
    dimensions.push({
      key,
      score: clamp01((d as { score?: unknown }).score),
      rationale: String((d as { rationale?: unknown }).rationale ?? '').slice(0, 1000),
    });
  }

  if (dimensions.length === 0) throw new Error('judge response had no usable dimension entries');
  return { dimensions };
}
