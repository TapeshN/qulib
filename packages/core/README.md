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

## Journey interchange (Chrome DevTools Recorder)

`scaffoldTests(url, { scenarios })` already accepts pre-built scenarios instead
of crawling — `importRecorderFlow` lets those scenarios come from a **Chrome
DevTools Recorder** export (Chrome DevTools → Recorder panel → record a flow →
"Export as JSON") instead of hand-authoring them:

```ts
import { readFileSync } from 'node:fs';
import { importRecorderFlow, isRecorderFlow, scaffoldTests } from '@qulib/core';

const raw = JSON.parse(readFileSync('login-flow.json', 'utf8'));

if (isRecorderFlow(raw)) {
  const { scenario, warnings } = importRecorderFlow(raw);
  // warnings: non-fatal notes for steps Recorder emits that have no
  // NeutralScenario equivalent (hover, scroll, waitForExpression, an unknown
  // future step type, …) — the converter tolerates and skips these, it never
  // throws on them. Only a structurally malformed flow throws.
  for (const w of warnings) console.warn(w);

  const result = await scaffoldTests('https://app.example.com', {
    framework: 'cypress-e2e',
    scenarios: [scenario],
  });
  // result.generatedTests is a ready-to-run Cypress spec — the exact same
  // downstream path a crawl-derived or recipe-derived scenario takes.
}
```

**Mapping.** `navigate` seeds the scenario's `targetPath`; `click`/`change`
become `click`/`type` steps; `keyDown` becomes a framework-neutral
**`key-press`** step (see below); `waitForElement` becomes
`assert-visible`/`assert-hidden` — or `assert-count` when the step carries a
Recorder element-COUNT assertion (`count`/`operator`, e.g. "wait until >= 3
matching elements exist") instead of a single-element check; a step's
`assertedEvents` (e.g. a `navigation` event) becomes an extra assertion step.
Each step's `selectors` fallback chain is resolved by `pickResilientSelector`,
which prefers `aria/`- and `text/`-prefixed selectors over brittle
`css`/`xpath` ones — the selector least likely to break when the page's
markup changes wins. Steps Recorder can emit with no NeutralScenario
equivalent (`hover`, `scroll`, `waitForExpression`, an unrecognized future
`type`) are skipped with a warning rather than thrown or silently dropped;
`setViewport` is genuinely informational (no user-facing action to map) but
is still warned about, since its dimensions are not threaded into the
generated project config either.

**Honesty guardrails.** The governing rule for every Recorder step type
against every adapter: a conversion is EITHER rendered faithfully at real
framework runtime, OR accompanied by a warning naming the exact risk — never
a silent drop, and never a warning that reassures a reviewer about only one
of several equally-real risks.
- **`keyDown` → framework-neutral `key-press` (not Cypress-only `{key}`
  syntax).** A `keyDown` step converts to a new `'key-press'` `TestStep`
  action carrying the RAW key Recorder recorded (e.g. `"Enter"`, `"Tab"`,
  `"a"`) — never Cypress's `{token}` special-sequence syntax baked in up
  front, which would be wrong under Playwright (writes the literal string
  `"{enter}"` instead of pressing a key) and wrong under Cypress itself for
  any multi-character key NAME outside its small special-sequence whitelist
  (`{tab}` throws at real runtime even though the spec compiles). Each
  adapter renders `key-press` in its own idiom: `cypress-e2e` emits real
  `.type("{token}")` syntax for whitelisted key NAMES (`Enter`, `Escape`,
  `Backspace`, `Delete`, the arrow keys, `Home`/`End`/`PageUp`/`PageDown`,
  `Insert` — see `cypress-special-keys.ts`), a plain unbraced
  `.type("a")`/`.type("1")`/`.type("?")`/`.type(" ")` call for a **single
  printable character** (a letter, digit, punctuation mark, symbol, or space,
  counted by Unicode CODE POINT so a single astral-plane character like an
  emoji also qualifies — this renders FAITHFULLY, firing a real
  keydown/keypress/input/keyup sequence, the exact primitive a common
  single-key shortcut recording like Gmail's `c`/`j`/`k` needs), and a safe,
  non-throwing comment only for a genuinely un-typeable multi-character key
  NAME outside the whitelist (`Tab`, `F1`, `Shift`, …); `playwright` renders
  `page.locator(t).press(key)` faithfully for virtually any key, since
  Playwright's key names match Recorder's directly. Only a key that is
  genuinely un-renderable by Cypress — outside BOTH the `{token}` whitelist
  AND the single-printable-character case — is warned about by name (the
  exact key + `cypress-e2e`) at conversion time; a plain printable character
  gets no warning, since it renders faithfully (an earlier round warned about
  EVERY non-whitelisted key, including faithfully-renderable single
  characters — an inverse facade, now fixed). **Every `"{"` in ANY typed
  value is escaped, not just a whole-string `"{"`.** Cypress's `.type()`
  treats an unescaped `"{"` as the OPENING of a `{token}` special-sequence
  ANYWHERE it appears — `cy.get(t).type("{")` compiles but THROWS at real
  Cypress runtime, and worse, `cy.get(t).type("press {enter} to search")`
  (ordinary prose) compiles, runs, and SILENTLY fires a real Enter keypress
  mid-string with no error. The `cypress-e2e` adapter routes every
  `.type()` value — the single-char key-press case above AND the far more
  common `'type'` `TestStep` action (any recorded `change`-event text) —
  through one `escapeCypressType` export (`cypress-special-keys.ts`), which
  escapes EVERY `"{"` occurrence in the string to Cypress's own documented
  form, `"{{}"`; every other character, including `"}"` (never special on
  its own), passes through unescaped. (`escapeCypressTypeLiteral` still
  exists as a deprecated alias for the same function — there is one escaper
  now, not two.) A source-scanning guard test
  (`adapters/__tests__/type-and-comment-choke-point-guard.test.ts`) fails
  the build if any `.type()` call site in the adapters ever bypasses this
  choke-point again.
- **Orphan `keyUp` (no matching `keyDown`).** A `keyUp` step is dropped
  silently ONLY when it is truly redundant — i.e. a `keyDown` for the same
  key already converted to a `key-press` step earlier in the SAME flow. A
  `keyUp` with no matching prior `keyDown` (a trimmed/hand-edited export, a
  chord's second-key release, or any Recorder-shaped JSON not produced by an
  unedited Recorder session) is warned about by index + key rather than
  silently vanishing — the same "never a silent drop" guarantee every other
  step type in this table already gets.
- **Element-count operator.** Only `>=` has a faithful rendering in EITHER
  adapter today (`should('have.length.gte', …)` in Cypress,
  `toBeGreaterThanOrEqual(…)` in Playwright). A `waitForElement` count
  assertion with any other Recorder `operator` (`==`, `<=`, …) still converts
  to `assert-count`, but with a warning naming BOTH adapters — the generated
  spec enforces `>=` semantics, not the operator Recorder recorded, no matter
  which framework renders it.
- **`change` vs `<select>`/checkbox/radio.** Chrome Recorder's `change` step
  is identical whether the user typed into a text input, picked an option
  from a `<select>`, or toggled a checkbox/radio — there is no field that
  disambiguates any of them. Guessing `type` silently would be false
  confidence: BOTH `cy.get(t).type(value)` (Cypress) and
  `page.locator(t).fill(value)` (Playwright) throw at runtime against a real
  `<select>`, checkbox, or radio, even though the scenario is schema-valid
  and the spec compiles. So every `change` step converts to `type` **and**
  carries a warning naming ALL THREE non-text-input risks (never just
  `<select>` alone). A reviewer who confirms the target really is a
  `<select>` can hand-edit that one step's `action` to the `'select'`
  `TestStep` action, which renders `cy.get(t).select(v)` (Cypress) /
  `page.locator(t).selectOption(v)` (Playwright); a checkbox/radio target
  should become a `'click'` step instead.
- **`assertedEvents` with an unrecognized `type`.** Any asserted event whose
  `type` is not `"navigation"` (or a `navigation` event missing its `url`) is
  warned about by name rather than silently no-op'd.
- **Zero-converted-step flows.** A Recorder flow whose every step is
  unmappable (`hover`/`scroll`/`waitForExpression`/unknown, or no usable
  selector) still returns a schema-valid `NeutralScenario` from
  `importRecorderFlow` (so a caller not tracking rejection still gets a
  well-formed value) — but the result also carries `rejected: true`. The
  **MCP** `qulib_scaffold_tests` tool (below) acts on this flag: a rejected
  journey is excluded from the scaffold input entirely and reported in a
  distinct `rejectedJourneys` response field, never folded into
  `scenarioCount`/`testCount` — a useless stub must never read as a
  successful conversion.
- **Newline-safe generated comments — all THREE adapters, and the guard is
  field-name-agnostic.** Every raw external field the
  `cypress-e2e`/`playwright`/`api` adapters interpolate into a generated `//`
  fallback comment — `TestStep.description`, a `key-press` step's raw key,
  `NeutralScenario.description`/`id`/`targetPath`/recipe tag, and (as of
  round 7) `DiscoveredEndpoint.summary`/`sourceFile`/`sourceTier`/`confidence`
  and `ApiSurface.repoPath` in `api-adapter.ts`'s repo-first API scaffold path
  — is passed through `sanitizeForComment` (`adapters/comment-safety.ts`)
  first, which collapses any embedded line break to a space. Without this, a
  hand-edited/non-Recorder-produced flow, or a caller-supplied OpenAPI spec
  (`ep.summary` is lifted straight from spec text), carrying a raw newline in
  one of these fields could terminate a `//` comment early and turn the rest
  of that field's text into live, uncommented code in the generated spec.
  `api-adapter.ts`'s `render()` path was fixed at round 6; its separate
  repo-first `renderEndpointTest`/`scaffoldApiTests` path (a different code
  path the round-6 fix never touched) was still raw until round 7 — and
  round 6's guard, which enumerated a fixed list of known field names, had no
  way to catch it either, since `ep.summary` wasn't on that list. The guard
  (`adapters/__tests__/type-and-comment-choke-point-guard.test.ts`) is now
  **field-NAME-agnostic**: it fails the build on ANY `${...}` interpolation
  inside a bare `//`-comment template that isn't itself a
  `sanitizeForComment(...)` call, whatever the expression is named — with a
  tiny, explicit allowlist for the two shapes that can never carry a line
  terminator (a bare numeric literal, a `.length` property access). A future
  field on any schema, interpolated at a site this README doesn't even
  mention yet, is caught automatically. Code-string interpolations (anything
  wrapped in `JSON.stringify(...)`, e.g. selectors and typed values) were
  never at risk — `JSON.stringify` already escapes a raw newline to `\n`
  *inside* the string literal — and are correctly left alone by the guard,
  which only looks at `//`-comment-shaped templates.
- **The comment guard is now BEHAVIORAL / output-based, not source-text-shaped (round 8, FINAL).** The round 6/7 guard above is a SOURCE-TEXT scanner: it only inspects a `${...}` hole when it sits inside a single backtick template literal whose own content starts with `//`. Round-8 review found the predicted gap: a comment built by `+`-concatenating a `//`-prefixed literal to a SECOND literal that does not itself start with `//` is invisible to that scanner, even though the two pieces are concatenated onto each other at runtime and become the SAME logical comment line in the generated file — and this real shape existed in shipped code (`cypress-e2e-adapter.ts`'s `key-press` warning comment used three `+`-joined literals; only the first was scanned). `adapters/__tests__/behavioral-injection-guard.test.ts` is the new AUTHORITATIVE gate: for every adapter and every public entrypoint (`render`/`renderAll` on all three adapters, plus `ApiAdapter.scaffoldApiTests`'s populated AND zero-endpoint branches), it sets every raw field to a sentinel carrying every ECMAScript line-terminator code point (CR, LF, U+2028, U+2029) around a uniquely-tagged live-code marker, runs the REAL adapter, and parses the REAL generated output with the TypeScript compiler — asserting the marker never resolves to a live AST node and no Cypress `.type()` argument carries an un-escaped `{`. It checks what the generated file IS, not how the source that produced it was shaped, so it cannot be defeated by reformatting the same bug into a new shape. The source-text scanner (`type-and-comment-choke-point-guard.test.ts`) is kept as a fast, cheap lint, but the behavioral guard is authoritative. It caught and drove the fix for a real leak: `JSON.stringify` is safe for a REAL generated string literal, but not for text used purely as comment decoration — and `JSON.stringify` never escapes U+2028/U+2029 at all (legal raw content inside a genuine string literal since ES2019) — so those two code points, embedded in a `step.value`/`step.target`, terminated the `//` comment in the generated file. Fixed by routing those fields through `sanitizeForComment` before `JSON.stringify` at every comment-decoration site.

The **MCP** `qulib_scaffold_tests` tool exposes the same converter through its
optional `journeys` input — see the MCP tools table below. Both `cypress-e2e`
and `playwright` are fully implemented `framework` choices for scaffolding,
including from Recorder-derived journeys.

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

The fixture tests in `packages/core/src/__tests__/analyze.fixtures.test.ts` assert structural shape — that `releaseConfidence` is a number, `gaps` is an array, and coverage scores are non-negative. Exact scores vary with each scoring version; re-run the fixture suite for current reference values.

A minimal structural snapshot looks like:

```json
{
  "status": "complete",
  "releaseConfidence": 68,
  "gaps": [
    "... gap items ..."
  ]
}
```

## MCP tools quick map

| Tool | When to use | Key input |
|---|---|---|
| **`qulib_score_confidence`** | **Flagship.** Fused verdict (ship/caution/hold/block) from all collectors | `url` and/or `repoPath`, optional `includeViews.replay` |
| `qulib_analyze_app` | Live-app QA scan: release confidence + gaps + a11y | `url`, optional `auth`, optional LLM knobs |
| `qulib_score_automation` | Score local repo test-automation maturity | absolute `repoPath`, optional `includeFullDimensions` |
| `qulib_score_api` | Discover API endpoints and score their test coverage | absolute `repoPath`, optional `enableTier3`, `includeEndpointDetail` |
| `qulib_scaffold_tests` | Generate a Cypress or Playwright scaffold from a live URL, or from pre-recorded journeys instead of crawling (`cypress-e2e` and `playwright` both fully implemented) | `url`, optional `framework`, `maxPagesToScan`, `recipes`, `journeys` (Chrome DevTools Recorder exports or NeutralScenarios — format auto-detected) |
| **`qulib_score_bug_report`** | LLM-as-judge of a learner bug report vs planted-bug target | `report` (title, description, steps, severity), `target` (description, type, severity, expectedBehavior) |
| **`qulib_score_decisions`** | Pivotal-decision evaluation at agent forks | absolute `forksPath` (JSONL), optional `enableLlmJudge` |
| `qulib_explore_auth` | Deeper auth-path discovery on unfamiliar apps | `url`, optional `timeoutMs` |
| `qulib_detect_auth` | Fast single-pass auth pattern guess | `url`, optional `timeoutMs` |
| `analyze_app` | Legacy alias for `qulib_analyze_app` — kept for backwards compatibility | same as `qulib_analyze_app` |
| `explore_auth` | Legacy alias for `qulib_explore_auth` — kept for backwards compatibility | same as `qulib_explore_auth` |
| `detect_auth` | Legacy alias for `qulib_detect_auth` — kept for backwards compatibility | same as `qulib_detect_auth` |

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
