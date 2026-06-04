# LLM-as-judge (`evals/judge/`)

> Q2c. Grades qulib's **non-deterministic** output against **pinned, versioned
> rubrics** and returns a `JudgeVerdict` (see [`../types.ts`](../types.ts)).
> Test spine: `node --import tsx/esm --test` (qulib convention — not vitest).

## What it grades

| Suite | Candidate | Rubric | Critical (FAIL-gate) dimension |
|---|---|---|---|
| `scaffold` | a generated E2E spec (`GeneratedTest.code`) | `scaffold-v1` | `no-hallucinated-routes` |
| `score-automation` | a maturity **narrative** (label + recs + prose) | `score-automation-v1` | `numeric-faithfulness` |

The judge sees the candidate **as data** alongside a small **grounding** object (the
discovered routes for scaffold; the computed maturity numbers + per-dimension
evidence/applicability for score-automation). Anything in the candidate not supported
by the grounding is treated as unsupported/hallucinated.

## Contract (root `CLAUDE.md` doctrine #11)

- **Pinned + recorded.** Every `JudgeVerdict` carries `judgeModel` and `rubricVersion`.
  Default judge model: `claude-sonnet-4-5-20250929` (a synthesize-tier model — judging
  is a reasoning task), overridable via `QULIB_JUDGE_MODEL` or `RunJudgeOptions.judgeModel`.
  The verdict records the model the provider **actually** reported.
- **Cost recorded.** `verdict.cost` = `{ inputTokens, outputTokens, dataQuality }` from
  the provider usage block.
- **Never grades its own turn.** `runJudge` is a fresh `createProvider()` call; if the
  subject's `subjectModel` equals the judge model it **throws** — the runner must pick a
  judge model distinct from the generation model.
- **SKIP, never silent-FAIL, when the judge is unavailable.** No `ANTHROPIC_API_KEY`
  ⇒ outcome `SKIP` with no network call. Deterministic asserts (owned by the runner)
  still run.
- **Typed outcomes + rollup.** `scoreToOutcome` maps the weighted aggregate to
  `PASS | WARN | FAIL`; a `critical` dimension at/under `criticalFloor` forces `FAIL`
  regardless of the aggregate.

## Public surface (`index.ts`)

```ts
import {
  judgeScaffoldSpec,        // (ScaffoldSpecSubject, opts?) => Promise<JudgeVerdict>
  judgeMaturityNarrative,   // (MaturityNarrativeSubject, opts?) => Promise<JudgeVerdict>
  runJudge,                 // (Rubric, JudgeSubject, opts?) => Promise<JudgeVerdict>  (low-level)
  getRubric, scoreToOutcome, validateRubric, ALL_RUBRICS,
} from './index.js';
```

Runner integration sketch (the runner owns deterministic asserts; this owns the judge):

```ts
const verdict = await judgeScaffoldSpec(
  { test, scenario, discoveredRoutes, subjectModel: generationModel },
  { /* judgeModel defaults to a model distinct from generationModel */ }
);
// verdict.outcome ∈ PASS|WARN|FAIL|SKIP ; verdict.score ∈ [0,1] ; verdict.cost recorded
```

## Versioning rubrics

Rubrics are **immutable once published**. To change grading, add a `*-vN` rubric in
`rubrics.ts` and flip the entry in `RUBRICS`. Bumping a version means re-grading the
golden corpus (the ledger score is expected to move). `validateRubric` enforces
weights-sum-to-1 and ordered thresholds.

## Meta-eval (the judge's own scored harness)

`golden/judge-cases.ts` holds hand-labelled candidates (good / hallucinated-route /
assertion-less spec; faithful / invented-number narrative) with an `expectedOutcome`.
`eval-judge.ts` is the scored runner:

```bash
# from packages/core
node --import tsx/esm evals/judge/eval-judge.ts            # live judge if ANTHROPIC_API_KEY, else offline
node --import tsx/esm evals/judge/eval-judge.ts --offline  # force the deterministic pipeline check
node --import tsx/esm evals/judge/eval-judge.ts --suite scaffold
```

- **OFFLINE** (default with no key): replays each case's rubric-consistent
  `stubDimensionScores` through the real parse → aggregate → threshold pipeline and
  scores agreement with the gold labels. Deterministic; runs in CI. **Exits non-zero on
  a FAIL rollup** so a judge-pipeline regression blocks merge.
- **LIVE** (key present): calls the pinned judge and scores its agreement with the gold
  labels. A mid-run SKIP counts as skipped, not as a false FAIL.

Unit tests: `evals/judge/__tests__/judge.test.ts` (offline, stubbed provider).
