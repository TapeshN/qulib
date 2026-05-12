# @qulib/core

**@qulib/core** is the TypeScript-first Qulib package for analyzing deployed web apps (and optionally a local repo) and surfacing honest quality gaps.

## Install

```bash
npm install @qulib/core
```

## Scanning authenticated apps

Qulib supports three auth modes: anonymous (default), form-login, and storage-state.

### Form login

If your app uses a simple username/password form:

```bash
qulib analyze --url https://app.example.com \
  --auth-form-login \
  --login-url https://app.example.com/login \
  --username you@example.com \
  --password "..." \
  --username-selector "input[name=email]" \
  --password-selector "input[name=password]" \
  --submit-selector "button[type=submit]"
```

### OAuth, magic link, SSO, or anything else

These can't be automated. Qulib has a helper for this:

```bash
qulib auth init --base-url https://app.example.com
```

This opens a real browser. Log in normally (OAuth, magic link, password manager, whatever). Press ENTER in the terminal when you reach a logged-in page. Qulib saves your session to `qulib-storage-state.json`.

Then scan with it:

```bash
qulib analyze --url https://app.example.com --auth-storage-state ./qulib-storage-state.json
```

The storage state is just a JSON file of cookies and localStorage — keep it private, treat it like a credential.

### Auth detection

To check what auth pattern a site uses before configuring anything:

```bash
qulib detect-auth --url https://app.example.com
```

Or via MCP:

> "Use qulib's detect_auth tool on https://app.example.com — what's the recommended auth setup?"

## CLI (from npm)

```bash
npx @qulib/core analyze --url https://example.com
```

Use `npx playwright install chromium` the first time you scan (Playwright is a dependency).

## Programmatic API

```ts
import { analyzeApp, type HarnessConfig } from '@qulib/core';

const config: HarnessConfig = {
  maxPagesToScan: 20,
  maxDepth: 3,
  minPagesForConfidence: 3,
  timeoutMs: 30000,
  retryCount: 2,
  llmTokenBudget: 4000,
  testGenerationLimit: 10,
  readOnlyMode: true,
  requireHumanReview: true,
  failOnConsoleError: false,
  explorer: 'playwright',
  defaultAdapter: 'playwright',
  adapters: ['playwright', 'cypress-e2e'],
};

const result = await analyzeApp({
  url: 'https://example.com',
  config,
  writeArtifacts: false,
});

console.log(result.releaseConfidence, result.gapAnalysis);
```

## Repository

Source and issues: **[github.com/TapeshN/qulib](https://github.com/TapeshN/qulib)**.

## Monorepo context

This package is part of **[Qulib](https://github.com/TapeshN/qulib)** ([repo README](../../README.md)). Install dependencies from the repository root: `npm install`. Build all packages: `npm run build` (from root).

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

For more options (`repoPath`, loading config from disk), see `src/analyze.ts` in the repository.
