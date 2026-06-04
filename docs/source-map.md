# Qulib source map

A contributor-friendly guide to the Qulib codebase. If you're new to the repo, start here.

## What Qulib is

Qulib is a deterministic-first, LLM-augmented QA intelligence platform for web apps. It analyzes a running app and (optionally) its source repo, and produces a structured report of public surface, gaps, and an automation maturity score. It runs as a CLI (`qulib`) and as an MCP server.

The product principle: **deterministic-first**. Every baseline capability must work without an LLM call. LLMs enrich reasoning; they never gate it.

## Package map

| Path | What lives here |
|---|---|
| `packages/core` | Analyzer engine + CLI (`@qulib/core`) |
| `packages/mcp` | MCP server that wraps the engine (`@qulib/mcp`) |

Both packages publish to npm. `@qulib/mcp` depends on `@qulib/core`.

## Main pipeline

Entry point: [`packages/core/src/analyze.ts`](../packages/core/src/analyze.ts) — `analyzeApp(config, options)`.

Internally the pipeline runs three phases:

| Phase | File | Responsibility |
|---|---|---|
| Observe | `packages/core/src/phases/observe.ts` | Launch an explorer, crawl the app, scan the repo |
| Think | `packages/core/src/phases/think.ts` | Build gap analysis, compute coverage / quality / confidence scores |
| Act | `packages/core/src/phases/act.ts` | Write JSON + Markdown reports to disk |

The phase names are part of the Qulib mental model — keep them when extending.

## Where to start by goal

| Goal | Start here |
|---|---|
| Change CLI behavior | `packages/core/src/cli/` |
| Change crawling behavior | `packages/core/src/tools/explorers/` |
| Change auth detection / login / validation | `packages/core/src/tools/auth/` |
| Change scoring logic (gaps, automation maturity) | `packages/core/src/tools/scoring/` |
| Change repo scanning / framework detection | `packages/core/src/tools/repo/` |
| Change reports (JSON / Markdown) | `packages/core/src/reporters/` |
| Change schemas or public contracts | `packages/core/src/schemas/` |
| Change telemetry events / redaction | `packages/core/src/telemetry/` |
| Change persisted run state | `packages/core/src/harness/` |
| Change LLM provider integration / cost tracking | `packages/core/src/llm/` |
| Change MCP tools | `packages/mcp/src/` |

## Tools, in detail

`packages/core/src/tools/` is split into four domain folders. Each has its own short README:

- [`tools/auth/`](../packages/core/src/tools/auth/README.md) — detect auth, explore login paths, validate storage state, apply auth to a Playwright context, build auth-related gaps.
- [`tools/explorers/`](../packages/core/src/tools/explorers/README.md) — launch the browser, crawl the app with Playwright (Cypress is a stub).
- [`tools/repo/`](../packages/core/src/tools/repo/README.md) — scan the repo for routes, tests, framework markers.
- [`tools/scoring/`](../packages/core/src/tools/scoring/README.md) — analyze gaps, compute scores, derive automation maturity.

Tests for each module live in a colocated `__tests__/` folder. Example: `tools/auth/__tests__/detect.test.ts` covers `tools/auth/detect.ts`.

## Public API surface

The `@qulib/core` package exports a small surface from [`packages/core/src/index.ts`](../packages/core/src/index.ts):

- `analyzeApp` — the programmatic entry point
- `detectAuth`, `exploreAuth`, `validateStorageState`, `evaluateStorageStateValidity`, `preflightStorageStateFile`, `waitForReturnToOrigin`
- `addUserProvider`, `removeUserProvider`, `listUserProviders`
- `scanRepo`, `computeAutomationMaturity`
- `createProvider` (LLM)
- `resolveMaxOutputTokensPerLlmCall`, `resolveScanStateBaseDir`, `resolveReportDir`
- `redactUrlForTelemetry`, `NoopTelemetrySink`
- All Zod-inferred types (`AnalyzeResult`, `HarnessConfig`, `DetectedAuth`, `AutomationMaturity`, …)

Anything not exported from `index.ts` is internal — feel free to rename it as long as imports inside `packages/core/src/` follow.

## Runtime output directories

These are created on first use and intentionally not tracked in git:

- `.scan-state/` — per-run state (route inventory, decision log, etc.). Created by `resolveScanStateBaseDir`.
- `output/` — generated JSON / Markdown reports. Created by `resolveReportDir`.

Both are listed in `.gitignore`. If you delete them, the next `qulib analyze` recreates them.

## Conventions

- **ESM only.** TypeScript sources import siblings with explicit `.js` extensions (e.g. `import { x } from './foo.js'`).
- **Schemas are the source of truth.** Files in `schemas/` use the `*.schema.ts` suffix. Changes must be additive (`.optional()` + new fields).
- **Tests live next to code** in `__tests__/` subfolders. Each `src/foo.ts` is tested by `src/__tests__/foo.test.ts` (or the closest `__tests__/` above).
- **No credentials in logs or telemetry.** URLs are passed through `redactUrlForTelemetry`. Credentials are masked in CLI debug output. Storage state contents are never written to telemetry.
- **Branch + release rules** live in [`CLAUDE.md`](../CLAUDE.md).

## Test runner

**qulib uses `node --test` with `tsx/esm` — NOT vitest.** The `"test"` script in `packages/core/package.json` is an **explicit enumerated file list**. A test file that is not appended to that list is invisible to `npm test`. Same pattern in `packages/mcp/package.json`.

```bash
node --import tsx/esm --test <file1.test.ts> <file2.test.ts> ...
```

When adding a test file: append its path to `packages/core/package.json "test"` (or `packages/mcp/package.json "test"` for MCP tests).

## Feature phases

| Phase | What ships | Status |
|---|---|---|
| Q1 | `analyzeApp`, `detect_auth`, `explore_auth`, `analyze_app` MCP | SHIPPED |
| Q2 | `qulib scaffold`, `qulib score-automation`, eval runner + LLM judge | SHIPPED |
| Q3 | Baseline monitor (`saveBaseline`, `loadBaseline`, `compareBaselines`) | SHIPPED |
| Q4 | Recipe toolshed (`auth`, `a11y`, `nav`, `seed`) | SHIPPED |
| Q5 | API coverage scoring (`computeApiCoverage`, `qulib_score_api`) | SHIPPED |
| Q7 | **Confidence Aggregator** (P3) — fused release confidence verdict | branch: `qulib/confidence-layer` |

### Q7 — Confidence Aggregator (P3)

Fuses qulib's own evidence collectors into one `ship | caution | hold | block` verdict.

**Ships in P3:**
- `schemas/confidence.schema.ts` + `schemas/views.schema.ts` — Zod schemas
- `tools/scoring/levels.ts` — shared `scoreLevel` ladder
- `tools/scoring/confidence.ts::computeReleaseConfidence` — pure scorer
- `tools/scoring/confidence-from-qulib.ts::buildConfidenceInputFromQulib` — adapter
- `tools/scoring/confidence-views.ts` — `buildReplay`, `deriveInbox`, `toAuditEntry`, `diffConfidence`
- `qulib_score_confidence` MCP tool (composes `analyze_app` / `qulib_score_automation` / `qulib_score_api`)
- `qulib confidence --url [--repo] [--json]` CLI command
- Eval suite `confidence` in the runner (4 golden cases, all deterministic)
- Tests: scorer unit, adapter, view-projection, MCP runtime-import, CLI smoke

**Deferred to P4:** external evidence collectors (CI/deploy/telemetry), persistence sinks, LLM-judge for narratives, notquality dogfood (P5).
