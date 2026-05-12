# Manual testing checklist

Use this before releases or after changes to crawling, auth, MCP tools, or reports. Check boxes as you go.

## Prerequisites

- [ ] Repo root: `npm install`
- [ ] `npm run build`
- [ ] Playwright browsers (first machine / after Playwright upgrade): `cd packages/core && npx playwright install chromium`

## Core CLI (any branch with CLI changes)

- [ ] `cd packages/core && npm run analyze -- --url https://notquality.com --ephemeral` (or another stable public URL): exits 0, JSON on stdout in ephemeral mode
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
- [ ] **`analyze_app`:** `{ "url": "https://notquality.com" }` → structured result, exit 0 through client
- [ ] **`analyze_app` + storage-state** (if supported in your version): path to a file from `auth init` on the **same host** as the MCP process

## Known tricky URLs (regression notes)

| Site | URL | What to watch |
|------|-----|-----------------|
| GitLab | `https://gitlab.com/users/sign_in` | Has been `none` at `domcontentloaded` (bot/JS); note if still wrong after wait/heuristic changes |
| Stack Overflow | `https://stackoverflow.com/users/login` | Often `unknown` without password in first paint |
| notquality.com | `https://notquality.com` vs `/login` | Root can look `none`; `/login` should at least be `hasAuth` or `unknown` |
| Amazon | `https://www.amazon.com/ap/signin` | Often `unknown`; storage-state path should stay honest |
| Wikipedia | `https://en.wikipedia.org/wiki/Main_Page` | May follow login link → `form-login` on `Special:UserLogin` |

## After checklist

- [ ] File issues for any **wrong bucket** (false `none`, false `oauth`, misleading `form-login` on multi-step IdPs) with URL + actual JSON snippet
- [ ] Update this doc when new tools or flags ship
