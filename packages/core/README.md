# @qulib/core

TypeScript-first QA harness: analyze deployed web apps for quality gaps and generate reports from real app and optional repo scans.

## Monorepo context

This package lives under the [qulib workspace root](../../README.md). Install dependencies from the repo root: `npm install`. Build all packages: `npm run build` (from root).

## Current capabilities

- CLI `analyze` flow: `observe` → `think` → `act`.
- Playwright explorer: route discovery, **axe-core** (WCAG 2.0 A/AA), sampled internal link HEAD checks.
- Optional **authenticated** crawling via `auth` in config (`form-login` or Playwright `storage-state`).
- Repo scanner: routes, tests, Cypress structure.
- Gap engine: deterministic gaps, **release confidence** with a low-page coverage floor, coverage warnings.
- Reports: `output/report.json` and `output/report.md` when not using **`--ephemeral`**.
- State under `.scan-state/` unless **`--ephemeral`** (no disk writes; full JSON on stdout).
- **`npm run clean`** removes generated `output/` and `.scan-state/` and restores `.gitkeep` placeholders.

## Tech stack

TypeScript (strict, NodeNext), Commander, Zod, Playwright, @axe-core/playwright, fast-glob; optional Anthropic API for scenario generation.

## Layout

```text
src/
  adapters/      # test rendering adapters
  analyze.ts     # programmatic API (also used by @qulib/mcp)
  cli/           # CLI entry
  harness/       # state + decision logging
  llm/           # LLM contracts
  phases/        # observe / think / act
  reporters/     # JSON + Markdown reports
  schemas/       # Zod schemas
  tools/         # explorers, auth, gap engine, repo scanner
```

Repo rules: see [`CLAUDE.md`](../../CLAUDE.md).

## Configuration

Default file: **`qulib.config.ts`** in this package directory (or pass **`--config <path>`** relative to the process working directory).

Optional `auth` for authenticated scanning — see commented example in `qulib.config.ts`. For local credentials, use a separate file (e.g. `qulib.test-auth.config.ts`, gitignored at the repo root) and point `--config` at it.

Use the same **origin** for `--url` as the app uses after login so same-origin links are discovered during the crawl.

## Scripts (from `packages/core`)

- `npm run dev` — CLI via `tsx` (append subcommands, e.g. `npm run dev -- clean`)
- `npm run analyze -- --url <url> [--repo <path>] [--config <file>] [--ephemeral]`
- `npm run clean` — reset `output/` and `.scan-state/` here
- `npm run build` — compile to `dist/`

From the **repository root**:

- `npm run analyze -w @qulib/core -- --url <url> …`
- `npm run clean` — runs core clean via workspace

Binary name after publish: **`qulib`** (see `package.json` `bin`).

## Usage examples

```bash
cd packages/core

# app only
npm run analyze -- --url http://localhost:3000

# app + repo
npm run analyze -- --url http://localhost:3000 --repo ../your-app

# local auth config (keep out of git)
npm run analyze -- --config ../../qulib.test-auth.config.ts --url https://example.com

# ephemeral: JSON on stdout, logs on stderr
npm run analyze -- --url https://example.com --ephemeral > report.bundle.json

npm run clean
```

## Playwright browsers

```bash
npx playwright install chromium
```

## Output and state (cwd = `packages/core` when you `cd` here)

**Ephemeral:** stdout prints one JSON object: `gapAnalysis`, `discoveredRoutes`, `repoInventory`, `decisionLog`.

**Persistent:**

- `.scan-state/discovered-routes.json`, `gap-analysis.json`, `decision-log.json`, and `repo-inventory.json` when `--repo` is set
- `output/report.json`, `output/report.md`

## Programmatic API

```ts
import { analyzeApp } from '@qulib/core';
```

Use `writeArtifacts: false` for stateless runs (same path as MCP). See `src/analyze.ts`.
