# Manual testing checklist

Use this before releases or after changes to crawling, auth, MCP tools, or reports. Check boxes as you go.

## Prerequisites

- [ ] Repo root: `npm install`
- [ ] `npm run build`
- [ ] `npm run test` (core + MCP unit tests)
- [ ] Playwright browsers (first machine / after Playwright upgrade): `cd packages/core && npx playwright install chromium`

## Core CLI (any branch with CLI changes)

- [ ] `cd packages/core && npm run analyze -- --url https://notquality.com --ephemeral` (or another stable public URL): exits 0, JSON on stdout in ephemeral mode
- [ ] `gapAnalysis.costIntelligence` present with `maxOutputTokensPerLlmCall`, `usageSummary`, `deterministicMaturity`
- [ ] After a non-ephemeral analyze: `cd packages/core && npm run cost-doctor` prints Cost Intelligence from `output/report.json`
- [ ] `npm run clean` (from `packages/core`): resets `output/` and `.scan-state/` without errors

## Auth detection and helpers

These commands exist when the **auth detection** work is present (e.g. `feature/auth-detection` or `main` after merge). If `qulib` reports `unknown command`, use the matching branch or `npx tsx src/cli/index.ts …` from `packages/core`.

### `detect-auth` smoke (CLI equals MCP `detect_auth` payload)

Run from repo root (adjust path if your `bin` differs):

```bash
node packages/core/bin/qulib.js detect-auth --url "<URL>" --timeout 30000
```

- [ ] **Form-shaped login:** `https://github.com/login` → expect `type: form-login`, `hasAuth: true`
- [ ] **Public homepage:** `https://notquality.com` or `https://www.amazon.com` → expect `type: none`, `hasAuth: false`
- [ ] **Known login path:** `https://notquality.com/login` → expect `hasAuth: true` (often `form-login`); note selector quality
- [ ] **SPA / opaque UI:** `https://linear.app/login` or `https://www.figma.com/login` → often `unknown`; recommendation should mention manual / storage state
- [ ] **Multi-step IdP:** `https://accounts.google.com/` → document current behavior (may look like `form-login`); decide if copy or classification needs a follow-up
- [ ] **False-OAuth guard:** `https://notquality.com` must **not** classify footer “GitHub” marketing as OAuth (`oauthButtons` empty or IdP-only phrasing)

### `auth init` (manual, interactive)

- [ ] `qulib auth init --base-url <staging-url> --out /tmp/qulib-storage-state.json`: browser opens, ENTER after login, file written
- [ ] `qulib analyze --url <same-origin-url> --auth-storage-state /tmp/qulib-storage-state.json` (with config that matches your harness limits): scan proceeds past login

## MCP (`@qulib/mcp`)

- [ ] Server starts: `node packages/mcp/dist/index.js` (or workspace equivalent) without startup errors
- [ ] **`detect_auth`:** call with `{ "url": "https://github.com/login" }` → JSON matches CLI `detect-auth` for the same URL
- [ ] **`analyze_app`:** `{ "url": "https://notquality.com" }` → summary-first JSON (`topGaps`, `costIntelligenceSummary`, `includeFullReport: false`)
- [ ] **`analyze_app`:** `{ "url": "https://notquality.com", "includeFullReport": true }` → full payload including all scenarios
- [ ] **`analyze_app` + storage-state** (if supported in your version): path to a file from `auth init` on the **same host** as the MCP process

## Known tricky URLs (regression notes)

| Site | URL | What to watch |
|------|-----|-----------------|
| GitLab | `https://gitlab.com/users/sign_in` | Has been `none` at `domcontentloaded` (bot/JS); note if still wrong after wait/heuristic changes |
| Stack Overflow | `https://stackoverflow.com/users/login` | Often `unknown` without password in first paint |
| notquality.com | `https://notquality.com` vs `/login` | Root can look `none`; `/login` should at least be `hasAuth` or `unknown` |
| Amazon | `https://www.amazon.com/ap/signin` | Often `unknown`; storage-state path should stay honest |
| Wikipedia | `https://en.wikipedia.org/wiki/Main_Page` | May follow login link → `form-login` on `Special:UserLogin` |

## Scaffold CLI (`qulib scaffold` — shipped v0.7.0)

- [ ] Dry-run: `node packages/core/bin/qulib.js scaffold --url https://notquality.com --dry-run` exits 0 and prints `[qulib scaffold] Dry-run` without writing files
- [ ] Write mode: `node packages/core/bin/qulib.js scaffold --url https://notquality.com --out /tmp/qulib-scaffold-test` exits 0, writes `projectConfig.json` + at least one spec file
- [ ] `--json` flag: output is valid JSON with a `specs` array
- [ ] Framework flag: `--framework playwright` produces `.spec.ts` files; `--framework cypress` produces `.cy.ts` files

## Score-automation CLI (`qulib score-automation` — shipped v0.7.0)

- [ ] `node packages/core/bin/qulib.js score-automation --repo .` exits 0 and prints an automation maturity score
- [ ] `--json` flag: output is valid JSON with `automationMaturity.score` and `automationMaturity.level`
- [ ] Missing `--repo` exits non-zero with a clear error message

## Confidence CLI (`qulib confidence` — shipped v0.8.x)

- [ ] `node packages/core/bin/qulib.js confidence --url https://notquality.com` exits 0, prints a `ship | caution | hold | block` verdict and score
- [ ] `--json` flag: output is valid JSON with `verdict` and `confidenceScore` fields
- [ ] `--repo .` combined with `--url` merges automation maturity into the confidence input
- [ ] Missing both `--url` and `--repo` exits non-zero with a clear error

## Cost doctor (`qulib cost doctor` — shipped v0.6.0)

- [ ] Run `node packages/core/bin/qulib.js analyze --url https://notquality.com` (non-ephemeral) to generate `output/report.json`
- [ ] `node packages/core/bin/qulib.js cost doctor` (from `packages/core`) prints `maxOutputTokensPerLlmCall`, `usageSummary`, and `deterministicMaturity`
- [ ] Running without a prior non-ephemeral report exits with a clear "no report found" error rather than crashing

## After checklist

- [ ] File issues for any **wrong bucket** (false `none`, false `oauth`, misleading `form-login` on multi-step IdPs) with URL + actual JSON snippet
- [ ] Update this doc when new tools or flags ship
