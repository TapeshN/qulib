# tools/scoring

Turns observed routes, gaps, and repo signals into the structured scores that show up in the final report.

## Files

| File | What it does |
|---|---|
| `gaps.ts` | `analyzeGaps`, `computeCoverageScore`, `computeQualityScoreFromGaps` — the gap-analysis engine. Aggregates observed gaps into a `GapAnalysis` and derives coverage / quality scores. |
| `automation-maturity.ts` | `computeAutomationMaturity(repo)` — produces the maturity matrix (test-id hygiene, auth test coverage, component test ratio, …) with per-dimension `applicability` and `evidence`. |
| `public-surface.ts` | `buildPublicSurface(routes, gaps)` — packages public-surface findings (pages, a11y violations, broken links) for the report. |

## Invariants

- Maturity scoring **never invents partial credit** for absent capabilities. A dimension without evidence is `applicability: 'unknown'` or `'not_applicable'`, and is excluded from the overall normalization.
- Every dimension carries an `evidence` array so a reviewer can audit the score.
- `releaseConfidence` is gated honestly upstream — see `analyze.ts` and `tools/auth/` for storage-state honesty logic.
