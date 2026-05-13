# tools/repo

Local-repository introspection: which routes exist, what tests cover them, and what framework the app is built on.

## Files

| File | What it does |
|---|---|
| `scan.ts` | `scanRepo(repoPath)` — walks the repo, finds routes, test files, Cypress structure, missing test IDs, and attaches automation maturity. Source of `RepoAnalysis`. |
| `detect-framework.ts` | `detectFramework(repoPath)` — identifies the primary framework (Next.js app router / pages router, Vite + React, etc.) and which test frameworks are configured. Returns evidence strings so the verdict is auditable. |

## Where it's called from

- `phases/observe.ts` runs `scanRepo` when `--repo` is passed (or `repoPath` set in `HarnessConfig`).
- `packages/mcp/src/index.ts` re-exports `scanRepo`-derived data via MCP tools.

## Invariants

- Framework detection always returns `evidence: string[]`. If evidence is empty, confidence is `'low'` — never silently `'high'`.
- The scan does not execute any project code; it only reads files.
