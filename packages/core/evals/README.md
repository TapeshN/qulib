# qulib evals (Q2 — CLIs + evals)

> **Skeleton only.** This directory and `types.ts` are the shared seam scaffolded
> for the Q2 wave. Each build subtask fills in its own substance against the
> contract in [`types.ts`](./types.ts) without colliding with siblings.

Every LLM-touching qulib surface ships wrapped in evaluation (root `CLAUDE.md`
doctrine #11). Q2 brings the **`scaffold`** and **`score-automation`** CLIs under
that bar: each gets a golden corpus of `input → expected` cases, deterministic
asserts, and — for non-deterministic output — an **LLM-as-judge** graded against
a pinned rubric. Scores append to a ledger so regressions are visible
release-over-release.

## Why here and not `datasets/`

`datasets/` is **gitignored** (it holds the machine-local QA-sweep golden *sites*,
which must never be committed or published — see `CLAUDE.md` Data safety). The Q2
eval **corpus + runner + judge** must be tracked and shipped, so they live under
this `packages/core/evals/` path instead. (AGENT-PLAN Phase B says "add to
`datasets/golden/`"; the tracked, publishable home for the eval harness is here —
the gitignored `datasets/` remains the home for raw sweep sites only.)

## Layout (scaffolded)

```
packages/core/evals/
  types.ts            # shared contract: EvalCase, JudgeVerdict, EvalRunSummary, EvalLedgerEntry
  README.md           # this file — the contract doc
  ledger.jsonl        # append-only run history (one EvalLedgerEntry per line); starts empty
  runner/             # eval runner CLI (`npm run eval`) — OWNED BY: eval-runner subtask
  judge/              # LLM-as-judge + pinned rubric(s) — OWNED BY: eval-judge subtask
  golden/
    scaffold/         # url → expected-scaffold cases — OWNED BY: golden-scaffold subtask
    score-automation/ # repo-fixture → expected-maturity cases — OWNED BY: golden-scaffold subtask
```

## Contract (do not break)

- A golden case is a JSON file under `golden/<suite>/` that parses to an `EvalCase`.
- The runner loads cases, runs the matching CLI surface, applies **deterministic
  asserts** (shape / real selectors / no hallucinated routes), then — when a
  judge is configured and `ANTHROPIC_API_KEY` is set — calls the judge for a
  `JudgeVerdict`. No key ⇒ judge dimension is `SKIP`, deterministic asserts still run.
- Typed outcomes only: `PASS | WARN | FAIL | SKIP`. Rollup: any `FAIL` ⇒ FAIL,
  any `WARN` ⇒ WARN, else PASS.
- The judge model **and** rubric version are pinned and recorded on every verdict.
  A model never judges its own turn in the same call (separate judge provider call).
- Each run appends exactly one `EvalLedgerEntry` to `ledger.jsonl`.

## Running (once build subtasks land)

```bash
# from packages/core
npm run eval                 # all suites
npm run eval -- --suite scaffold
```

The runner exits non-zero on a `FAIL` rollup so CI can gate merges (doctrine #11:
regressions block merge). With no `ANTHROPIC_API_KEY`, judged dimensions report
`SKIP` (an acknowledged missing dependency — not a failure).

## Test discipline

qulib's test spine is `node --import tsx/esm --test` (see
`packages/core/package.json` `test` script) — **not** vitest. The runner, judge,
and loader each ship `node:test` unit tests with real assertions (no smoke stubs),
wired into the `test` script the same way the existing CLI tests are.
