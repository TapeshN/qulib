# @qulib/core

**@qulib/core** is the TypeScript-first Qulib package for analyzing deployed web apps (and optionally a local repo) and surfacing honest quality gaps.

## Install

```bash
npm install @qulib/core
```

## One-time browser setup

Qulib uses Playwright. Install Chromium once on the machine that runs scans:

```bash
npx playwright install chromium
```

If browsers are missing, commands fail with a short message pointing you here.

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

### Automated form login (`auth login`)

When **`detect-auth`** shows **`authOptions`** with **`type: "form-login"`** and **`requirements.method: "credentials"`** (including click-to-reveal paths such as NQ Login), you can save a storage state **without** manual clicking:

```bash
qulib auth login --base-url https://notquality.com \
  --auth-path nq-login \
  --credentials-file ~/.qulib/nq-creds.json \
  --out ~/.qulib/nq-state.json
```

The JSON file must map **field `name`** values from `authOptions` to secrets, e.g. `{"username":"…","password":"…","hidden.datasource":"…"}`. Prefer **`--credentials-file`** over **`--credentials`** so values are not stored in shell history.

Then analyze with the saved session:

```bash
qulib analyze --url https://notquality.com \
  --auth-storage-state ~/.qulib/nq-state.json
```

Use **`--auth-path <id>`** when multiple **`form-login`** paths appear in **`authOptions`**. Use **`--success-url-contains <substring>`** for stricter success detection; otherwise Qulib infers success from URL changes or the password field disappearing (and warns if it cannot confirm).

Then scan with it:

```bash
qulib analyze --url https://app.example.com --auth-storage-state ./qulib-storage-state.json
```

The storage state is just a JSON file of cookies and localStorage — keep it private, treat it like a credential.

### Multi-path auth exploration (`explore-auth`)

For unfamiliar apps (especially enterprise SSO with several buttons), run **`qulib explore-auth --url <url>`** before `analyze`. The JSON lists every detected path (built-in OAuth names like Google/Clever, **heuristic** unknown buttons such as tenant-specific SSO labels, password forms, and magic-link copy) plus **`suggestedAgentBehavior`** for the agent.

Unknown SSO buttons include **`unrecognizedButtons`** with a hint. Teach this machine to recognize a label next time:

```bash
qulib auth providers add --id nq-login --label "NQ Login" --pattern "nq login"
qulib auth providers list
qulib auth providers remove --id nq-login
```

Patterns live in **`~/.qulib/providers.json`** (per user, not in the repo). Built-in public platforms stay in qulib’s curated list; tenant-specific names are never shipped as built-ins.

### Auth detection

To check what auth pattern a site uses before configuring anything:

```bash
qulib detect-auth --url https://app.example.com
```

Or via MCP:

> "Use qulib's detect_auth tool on https://app.example.com — what's the recommended auth setup?"

## Release confidence

The score (0–100) is derived from **deterministic gaps** (untested routes vs repo, console errors, broken links, axe violations). High-severity items subtract more than low-severity ones. If **`coveragePagesScanned` is below `minPagesForConfidence`**, the score is **capped at 40** and `coverageWarning` is set to **`low-coverage`** so a shallow crawl cannot masquerade as high confidence.

When **`mode` is `auth-required`**, the scan never reached real app pages behind login: **release confidence is 0**, gaps are empty, and Cost Intelligence reflects the blocked state (L0 maturity).

## LLM scenario budget (naming)

- **`llmTokenBudget`** (legacy name, still required in config files): **max output tokens for a single** scenario-generation LLM completion. It maps to the provider’s **per-request completion cap**, not a multi-call or “whole run” token budget.
- **`llmMaxOutputTokensPerCall`** (optional): when set, **overrides** `llmTokenBudget` for the same purpose—clearer naming.
- **`enableLlmScenarios`**: when **`false`**, Qulib never calls an LLM for scenarios (templates only).

## Cost Intelligence and `qulib cost doctor`

After a normal **`analyze`**, `output/report.json` includes **`gapAnalysis.costIntelligence`**: usage records (**`actual`** vs **`estimated`** vs **`none`**), per-completion ceiling, budget warnings, repeated prompt fingerprints (when the same hash appears twice in one run), deterministic maturity (L0–L3 with an explicit ceiling for L4/L5), and conversion recommendations.

Re-print that block from disk:

```bash
npx tsx src/cli/index.ts cost doctor
# or: npx tsx src/cli/index.ts cost doctor --report output/report.json
```

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
  llmMaxOutputTokensPerCall: undefined,
  enableLlmScenarios: true,
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

console.log(result.releaseConfidence, result.gapAnalysis.costIntelligence);
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
- Reports: `output/report.json` and `output/report.md` when not using **`--ephemeral`** (both include **Cost Intelligence** when present on `gapAnalysis`).
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

Use the same **hostname** for `--url` as your app’s canonical host when you can. The crawler treats **`www` and apex** (e.g. `example.com` and `www.example.com`) as the same site for internal link discovery, so hydration and redirects still queue in-site URLs.

## Scripts (from `packages/core`)

- `npm run dev` — CLI via `tsx` (append subcommands, e.g. `npm run dev -- clean`)
- `npm run analyze -- --url <url> [--repo <path>] [--config <file>] [--ephemeral]`
- `npm run clean` — reset `output/` and `.scan-state/` here
- `npm run test` — unit tests (cost intelligence + hashing)
- `npm run smoke` — ephemeral analyze of `https://example.com` (uses this package’s `qulib.config.ts`)
- `npm run cost-doctor` — print Cost Intelligence from `output/report.json` (run a non-ephemeral `analyze` first)
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

**Ephemeral:** stdout prints one JSON object: `gapAnalysis` (including **`costIntelligence`** when populated), `discoveredRoutes`, `repoInventory`, `decisionLog`.

**Persistent:**

- `.scan-state/discovered-routes.json`, `gap-analysis.json`, `decision-log.json`, and `repo-inventory.json` when `--repo` is set
- `output/report.json`, `output/report.md`

For more options (`repoPath`, loading config from disk), see `src/analyze.ts` in the repository.
