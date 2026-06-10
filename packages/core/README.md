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

#### Storage state is validated before crawl

Qulib now validates the provided storage state before doing any work. If the file is missing, unreadable, empty, on the wrong origin, or carries a session that is already expired, Qulib stops with an honest `blocked` result (no fake `releaseConfidence`) and a structured gap explaining how to recover. The validator reports one of these stable reason codes:

| Reason code               | Meaning                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `missing-file`            | Path passed to `--auth-storage-state` does not exist.                   |
| `unreadable-file`         | File exists but the process can't read it (permissions).                |
| `invalid-json`            | File is present and readable but not valid JSON.                        |
| `no-auth-cookies`         | File parses, but has zero cookies and zero localStorage entries.        |
| `wrong-origin`            | Session redirects to a different origin (host/port/scheme mismatch).    |
| `expired-or-unauthorized` | Loaded session shows the login form again, or the app returns 401/403. |
| `unknown`                 | Validation could not be completed for an unexpected reason.             |

Origin matching is strict — `https://app.example` and `https://www.app.example` are different origins, as are `http://localhost:3000` and `http://localhost:4000`. Re-run `qulib auth login` against the same origin you plan to `analyze`.

Relatedly, `qulib auth login` will now refuse to save a storage state if the browser ends the flow on a different origin than `--base-url` (a federated/SSO redirect that never returned to the app). This prevents Qulib from quietly persisting an IdP-domain session that would later produce false-confidence scans.

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
qulib cost doctor
# or: qulib cost doctor --report output/report.json
```

## CLI (from npm)

**Release confidence — the flagship command:**

```bash
npx @qulib/core confidence --url https://example.com
```

Returns ship / caution / hold / block with a 0–100 score, top risks, and recommended next checks. Add `--repo` to also score test-automation maturity and API coverage.

**Analyze (full gap report):**

```bash
npx @qulib/core analyze --url https://example.com
```

**Scaffold a test suite:**

```bash
npx @qulib/core scaffold --url https://example.com --framework cypress-e2e
```

**Score automation maturity (repo-only, no URL needed):**

```bash
npx @qulib/core score-automation --repo /path/to/repo
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
  analyze.ts        # programmatic API (also used by @qulib/mcp)
  cli/              # CLI entry
  harness/          # state + decision logging
  llm/              # LLM contracts
  phases/           # observe / think / act
  reporters/        # JSON + Markdown reports
  schemas/          # Zod schemas
  telemetry/        # event sink + URL redaction
  tools/
    auth/           # detection, exploration, validation, providers, gap builders
    explorers/      # browser launch, Playwright/Cypress crawlers, factory
    repo/           # repo scanner, framework detection
    scoring/        # gap engine, automation maturity, public surface
  __tests__/        # integration and wiring tests live in __tests__/ in each folder
```

A contributor map of which folder to touch for each kind of change lives at [`docs/source-map.md`](../../docs/source-map.md).

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

## Minimum config

Smallest legal `qulib.config.ts`:

```ts
import type { HarnessConfig } from './src/schemas/config.schema.js';

const config: HarnessConfig = {
  maxPagesToScan: 20,
  maxDepth: 3,
  timeoutMs: 30000,
};

export default config;
```

All other fields inherit from schema defaults or CLI/runtime defaults.

## Scan walkthroughs (copy-paste)

### 1) Public scan

```bash
npx @qulib/core analyze --url https://yourapp.com
```

### 2) Auth-blocked scan (honest blocked mode)

```bash
npx @qulib/core analyze --url https://yourapp.com/auth
```

When auth blocks access and no auth config is supplied, Qulib reports `status: "blocked"` (or `partial` if it could still crawl some public pages). This is intentional honesty, not a failure mode.

### 3) Authenticated scan with storage state

```bash
# Capture once (manual OAuth/SSO-safe flow)
qulib auth init --base-url https://yourapp.com

# Reuse saved session
qulib analyze --url https://yourapp.com --auth-storage-state ./qulib-storage-state.json
```

## Sample report (fixture baseline)

From the local fixture baseline used in v0.5.0 PR 1/2:

```json
{
  "status": "complete",
  "releaseConfidence": 68,
  "gaps": [
    "... 4 total gap items ..."
  ]
}
```

Use these as conservative reference numbers:
- public fixture (`/`): `releaseConfidence: 68/100`, `gaps: 4`
- auth-wall fixture (`/auth`): `releaseConfidence: 24/100`, `gaps: 2`
- broken fixture (`/broken`): `releaseConfidence: 0/100`, `gaps: 6`

## MCP tools quick map

| Tool | When to use | Key input |
|---|---|---|
| **`qulib_score_confidence`** | **Flagship.** Fused verdict (ship/caution/hold/block) from all collectors | `url` and/or `repoPath`, optional `includeViews.replay` |
| `analyze_app` | Live-app QA scan: release confidence + gaps + a11y | `url`, optional `auth`, optional LLM knobs |
| `qulib_score_automation` | Score local repo test-automation maturity | absolute `repoPath`, optional `includeFullDimensions` |
| `qulib_score_api` | Discover API endpoints and score their test coverage | absolute `repoPath`, optional `enableTier3`, `includeEndpointDetail` |
| `qulib_scaffold_tests` | Generate Cypress/Playwright scaffold from a live URL | `url`, optional `framework`, `maxPagesToScan`, `recipes` |
| `explore_auth` | Deeper auth-path discovery on unfamiliar apps | `url`, optional `timeoutMs` |
| `detect_auth` | Fast single-pass auth pattern guess | `url`, optional `timeoutMs` |

## Output directories

Qulib writes runtime artifacts to:

- `.scan-state/` — intermediate state (discovered routes, gap analysis snapshots, decision log)
- `output/` — final `report.json` and `report.md`

Both are gitignored and safe to delete; Qulib recreates them on the next non-ephemeral run.

## ANTHROPIC_API_KEY (LLM scenarios)

For MCP-hosted usage, set `ANTHROPIC_API_KEY` in your host's `env` block:

```json
{
  "mcpServers": {
    "qulib": {
      "command": "npx",
      "args": ["@qulib/mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Without this key, Qulib still runs deterministic checks (crawl, a11y, links, console, scoring) and falls back to template scenarios instead of LLM-generated ones.

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
