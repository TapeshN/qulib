# Quilib

Quilib is a TypeScript-first QA harness for analyzing web app quality gaps and generating actionable reports from real app + repo scans.

## Current Status

MVP path is implemented end-to-end:

- CLI `analyze` flow is wired through `observe -> think -> act`.
- Playwright explorer performs route discovery, **axe-core** accessibility checks, and sampled internal link HEAD checks.
- Optional **authenticated** crawling via `auth` in config (`form-login` or Playwright `storage-state`).
- Repo scanner inventories routes/tests and Cypress structure.
- Gap engine computes deterministic quality gaps, **release confidence with a low-page coverage floor**, and optional coverage warnings.
- Reports are generated as JSON and Markdown (`output/report.json`, `output/report.md`).
- State and decision logs persist under `.scan-state` unless you use **`--ephemeral`** (no disk writes; full JSON on stdout for MCP/CI).
- **`npm run clean`** removes generated `output/` and `.scan-state/` and restores placeholder `.gitkeep` files.

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
src/
  adapters/      # test rendering adapters (playwright, cypress, api)
  cli/           # command-line entrypoint
  harness/       # state + decision logging contracts
  llm/           # LLM provider/context contracts
  phases/        # observe / think / act orchestration contracts
  reporters/     # output report contracts
  schemas/       # shared zod schemas + inferred types
  tools/         # explorers, auth helper, gap engine, repo scanner
```

Contributor workflow and repo rules live in **`CLAUDE.md`**.

## Configuration

Primary config lives in `quilib.config.ts` and is typed with `HarnessConfig`.

Optional **authenticated scanning** uses `auth` on the config (`form-login` or `storage-state`). See the commented example in `quilib.config.ts`. For local-only credentials, use a separate file (for example `quilib.test-auth.config.ts`, gitignored) and pass **`--config <path>`** relative to the project root.

Use the same **origin** for `--url` as the app uses after login (for example `https://www.example.com` vs `https://example.com`) so same-origin links are discovered during the crawl.

## Scripts

- `npm run dev` — run CLI entry (`src/cli/index.ts`); append a subcommand (e.g. `npm run dev -- clean`)
- `npm run analyze -- --url <app-url> [--repo <repo-path>] [--config <file>] [--ephemeral]` — full pipeline
- `npm run clean` — remove generated `output/` and `.scan-state/`, then recreate placeholder dirs
- `npm run build` — compile TypeScript into `dist/`

With the package **`bin`**, you can also run **`npx quilib analyze …`** after install.

## Usage

```bash
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
npx tsc --noEmit
```

## Output and State Folders

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
