/**
 * Shared eval contract for Q2 (CLIs + evals).
 *
 * This is the SKELETON seam every Q2 build subtask depends on:
 *   - the golden-corpus loader writes cases that satisfy `EvalCase`
 *   - the LLM-judge returns a `JudgeVerdict`
 *   - the eval runner scores `EvalCaseResult`s into a `EvalRunSummary`
 *   - the runner appends one `EvalLedgerEntry` per run to evals/ledger.jsonl
 *
 * Types only — no behavior. Build agents implement the runner, judge, and
 * golden cases against these shapes. Keep this additive (root CLAUDE.md: schemas
 * are additive-only); new fields are `?:` optional.
 *
 * Outcome vocabulary is the org-standard typed outcome (root doctrine #6):
 *   PASS  — meets the rubric bar
 *   WARN  — usable but below target on >=1 rubric dimension
 *   FAIL  — does not meet the bar / hallucination / wrong shape
 *   SKIP  — acknowledged missing dependency (e.g. no ANTHROPIC_API_KEY for the judge)
 */

export type EvalOutcome = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

/** Which qulib surface a golden case exercises. One suite per CLI under eval. */
export type EvalSuite = 'scaffold' | 'score-automation' | 'confidence' | 'evidence' | 'analyze-diff' | 'prompt-leakage' | 'provenance';

/**
 * A single golden case: an input the CLI is run against plus the expectation the
 * judge/asserts grade the output by. `input` and `expected` are suite-specific
 * (build agents narrow them per suite); kept loose here so the shared loader and
 * runner stay suite-agnostic.
 */
export interface EvalCase {
  /** Stable id, kebab-case, unique within a suite. e.g. "scaffold-static-marketing". */
  id: string;
  suite: 'scaffold' | 'score-automation' | 'confidence' | 'evidence' | 'analyze-diff' | 'prompt-leakage' | 'provenance';
  /** One-line human description of what this case probes. */
  description: string;
  /** Suite-specific input (e.g. { url, framework } for scaffold). */
  input: Record<string, unknown>;
  /** Suite-specific expectation the judge + deterministic asserts grade against. */
  expected: Record<string, unknown>;
  /** Optional tags for slicing (e.g. "spa", "auth-wall", "no-llm"). */
  tags?: string[];
  /**
   * Clean-twin false-positive guard: when set, this case is the DEFECT-FREE twin of
   * the seeded-defect case whose `id` this references (same suite). The twin is
   * derived from the seeded case by removing the seeded defect(s) and must produce
   * zero detections. The runner cross-references every `cleanTwinOf` case against its
   * outcome to compute `EvalRunSummary.falsePositiveRate` — a case flagged as an
   * error/gap in a clean twin is a false positive, not a legitimate detection.
   * Optional/additive so existing golden cases are unaffected.
   */
  cleanTwinOf?: string;
}

/** Rubric dimension scored by the LLM-judge. 0..1, where 1 is fully met. */
export interface JudgeDimensionScore {
  dimension: string;
  score: number;
  rationale: string;
}

/**
 * The judge's verdict on one case's output. Judge model + rubric version are
 * PINNED and recorded (root doctrine #11 — never let a model judge its own turn,
 * always record judge cost). `cost` is filled from the provider usage block.
 */
export interface JudgeVerdict {
  outcome: EvalOutcome;
  /** Aggregate 0..1 across rubric dimensions. */
  score: number;
  dimensions: JudgeDimensionScore[];
  /** Pinned identifiers so a verdict is reproducible/auditable. */
  judgeModel: string;
  rubricVersion: string;
  cost?: {
    inputTokens: number;
    outputTokens: number;
    dataQuality: 'actual' | 'estimated';
  };
}

/** Result of running one golden case end-to-end (deterministic asserts + judge). */
export interface EvalCaseResult {
  caseId: string;
  suite: EvalSuite;
  outcome: EvalOutcome;
  /** Deterministic, non-LLM checks (shape/selectors/no-hallucinated-routes). */
  deterministic: { outcome: EvalOutcome; notes: string[] };
  /** Present unless SKIP (judge unavailable) or the case is deterministic-only. */
  judge?: JudgeVerdict;
  latencyMs: number;
}

/** Roll-up of a full eval run for one suite. Rollup rule: any FAIL -> FAIL, any WARN -> WARN, else PASS. */
export interface EvalRunSummary {
  suite: EvalSuite;
  outcome: EvalOutcome;
  /** Mean judge score across non-SKIP cases, 0..1. */
  score: number;
  counts: { pass: number; warn: number; fail: number; skip: number; total: number };
  results: EvalCaseResult[];
  startedAt: string;
  finishedAt: string;
  /**
   * Clean-twin false-positive guard (precision half of the eval): fraction, in
   * [0,1], of `cleanTwinOf`-tagged cases in this suite that FAILed (i.e. qulib
   * flagged a defect-free clean twin). `undefined` when this suite's golden corpus
   * declares no clean-twin cases (not applicable, never coerced to 0). ANY nonzero
   * falsePositiveRate is a hard deduction: the runner forces `outcome` to `'FAIL'`
   * for this suite regardless of every other case's result — a tool that flags
   * clean apps is not shippable, full stop.
   */
  falsePositiveRate?: number;
}

/** One line appended to evals/ledger.jsonl per run — the self-optimizing maturity loop reads this. */
export interface EvalLedgerEntry {
  ts: string;
  suite: 'scaffold' | 'score-automation' | 'confidence' | 'evidence' | 'analyze-diff' | 'prompt-leakage' | 'provenance';
  outcome: EvalOutcome;
  score: number;
  counts: EvalRunSummary['counts'];
  judgeModel?: string;
  rubricVersion?: string;
  /** qulib version under test, from packages/core/package.json. */
  qulibVersion: string;
  /** Total judge cost for the run, if a judge ran. */
  cost?: { inputTokens: number; outputTokens: number };
  /**
   * Tenant that produced this run. Source precedence:
   *   explicit RunOptions.tenantId → env TAP_TENANT_ID → "default".
   * Never null/empty on NEW records. Old records without this field are
   * treated as "legacy" by readers — backward-compat, never rewritten.
   */
  tenantId: string;
  /**
   * Mirrors `EvalRunSummary.falsePositiveRate` (see there). Omitted when the
   * suite's golden corpus has no `cleanTwinOf` cases — never coerced to 0/undefined
   * ambiguity. Old ledger lines without this field predate the clean-twin guard.
   */
  falsePositiveRate?: number;
}
