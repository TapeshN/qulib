# Quilib

Quilib is a TypeScript-first QA harness for analyzing web app quality gaps and generating actionable reports from real app + repo scans.

## Monorepo

This repository is an npm workspace with publishable packages:

| Package | Role |
|--------|------|
| [`@qulib/core`](packages/core/) | Library + CLI (`qulib`): observe → think → act pipeline, Playwright explorer, schemas, reporters. |
| [`@qulib/mcp`](packages/mcp/README.md) | MCP server (`qulib-mcp`) exposing tool `analyze_app` for AI clients; calls `@qulib/core` programmatically (stateless, no disk writes per request). |

Install once at the repo root: `npm install`. Build everything: `npm run build`.

## Current Status

MVP path is implemented end-to-end:

- CLI `analyze` flow is wired through `observe -> think -> act`.
- Playwright explorer performs route discovery, **axe-core** accessibility checks, and sampled internal link HEAD checks.
- Optional **authenticated** crawling via `auth` in config (`form-login` or Playwright `storage-state`).
- Repo scanner inventories routes/tests and Cypress structure.
- Gap engine computes deterministic quality gaps, **release confidence with a low-page coverage floor**, and optional coverage warnings.
- Reports are generated as JSON and Markdown (`output/report.json`, `output/report.md`) when not using **`--ephemeral`**.
- State and decision logs persist under `.scan-state` unless you use **`--ephemeral`** (no disk writes; full JSON on stdout for MCP/CI).
- **`npm run clean`** (from `@qulib/core`) removes generated `output/` and `.scan-state/` and restores placeholder `.gitkeep` files.

## Tech Stack

- TypeScript (strict, NodeNext)
- Commander (CLI)
- Zod (schemas and validation)
- Playwright (URL exploration)
- @axe-core/playwright (WCAG 2.0 A/AA scans)
- fast-glob (repo analysis)
- Anthropic API integration (optional scenario generation)

## Project Structure

```text
packages/core/src/
  adapters/      # test rendering adapters (playwright, cypress, api)
  analyze.ts     # programmatic entry used by CLI and @qulib/mcp
  cli/           # command-line entrypoint
  harness/       # state + decision logging contracts
  llm/           # LLM provider/context contracts
  phases/        # observe / think / act orchestration contracts
  reporters/     # output report contracts
  schemas/       # shared zod schemas + inferred types
  tools/         # explorers, auth helper, gap engine, repo scanner
packages/mcp/src/
  index.ts       # MCP stdio server (tool: analyze_app)
```

Contributor workflow and repo rules live in **`CLAUDE.md`**.

## Configuration

Primary config lives in `packages/core/quilib.config.ts` and is typed with `HarnessConfig`.

Optional **authenticated scanning** uses `auth` on the config (`form-login` or `storage-state`). See the commented example in `packages/core/quilib.config.ts`. For local-only credentials, use a separate file (for example `quilib.test-auth.config.ts`, gitignored) and pass **`--config <path>`** relative to the current working directory (typically `packages/core` when using workspace scripts).

Use the same **origin** for `--url` as the app uses after login (for example `https://www.example.com` vs `https://example.com`) so same-origin links are discovered during the crawl.

## Scripts

From the **repository root**:

- `npm run build` — compile all workspace packages
- `npm run clean` — runs `@qulib/core` clean (removes `output/` and `.scan-state/` relative to where the script runs; use from `packages/core` or pass cwd accordingly)
- `npm run analyze -w @qulib/core -- --url <app-url> [--repo <repo-path>] [--config <file>] [--ephemeral]` — full pipeline via the core workspace

From **`packages/core`** (paths like `quilib.config.ts` resolve here):

- `npm run dev` — run CLI entry (`src/cli/index.ts`); append a subcommand (e.g. `npm run dev -- clean`)
- `npm run analyze -- --url <app-url> …` — same as above with local cwd
- `npm run clean` — remove generated `output/` and `.scan-state/` under this package, then recreate placeholder dirs
- `npm run build` — compile TypeScript into `dist/`

With the **`qulib` bin** on `@qulib/core`, after install you can run **`npx qulib analyze …`** (scope/publish name may vary once packages are on npm).

## Usage

```bash
cd packages/core

# analyze app only
npm run analyze -- --url http://localhost:3000

# analyze app + repo
npm run analyze -- --url http://localhost:3000 --repo ../notquality-app

# alternate config file (e.g. local auth — keep that file out of git)
npm run analyze -- --config quilib.test-auth.config.ts --url https://example.com

# stateless run: no files on disk; full JSON payload on stdout (for MCP/CI)
# Logs go to stderr so you can pipe stdout: npm run analyze -- --url https://example.com --ephemeral > report.bundle.json
npm run analyze -- --url https://example.com --ephemeral

# wipe generated output and scan state
npm run clean
```

## Playwright browsers

First time (or after a Playwright upgrade), install browser binaries:

```bash
npx playwright install chromium
```

## Validate Setup

```bash
npm install
npm run build
```

## Output and State Folders

When running the CLI from `packages/core`, paths are relative to that directory:

- `.scan-state/` holds persisted scan state (ignored by git except `.gitkeep`).
- `output/` holds generated reports (ignored by git except `.gitkeep`).

Omitted when using **`--ephemeral`**: nothing is written under `output/` or `.scan-state/`; the tool prints one JSON object to **stdout** containing `gapAnalysis`, `discoveredRoutes`, `repoInventory`, and `decisionLog`.

Expected state files:

- `.scan-state/discovered-routes.json`
- `.scan-state/repo-inventory.json` (when `--repo` is provided)
- `.scan-state/gap-analysis.json`
- `.scan-state/decision-log.json`

Expected reports:

- `output/report.json`
- `output/report.md`

## MCP

See [`packages/mcp/README.md`](packages/mcp/README.md) for installing and configuring the `@qulib/mcp` server in Claude Code, Claude Desktop, or Cursor.
