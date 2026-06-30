# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for **0.3.1 and earlier** were reconstructed from git tags (`v0.1.1` … `v0.2.2`) and release commits on `main`.

## [Unreleased]

### Added

- **Per-session rate limit on the LLM-as-judge tools (cost/DoS hardening):** `qulib_score_bug_report` and `qulib_score_decisions` now apply a lightweight, dependency-free, in-process per-session call limiter before any scoring work. Per-field Zod length caps already stop single-call abuse, but a programmatic/direct MCP client could fire either judge tool in a tight loop and drain the deployer's Anthropic API quota. The default budget is 60 calls/minute per session, configurable via `QULIB_JUDGE_MAX_CALLS_PER_MIN` (set to `0` to disable). When exceeded, the handler returns a structured `QULIB_RATE_LIMITED` tool error with a retry hint (no exception, no stack trace) instead of invoking the LLM. Uses a fixed-window counter keyed by MCP session id (stdio shares a single window). Flagged MEDIUM in two security reviews.

### Security

- **MCP error responses no longer leak server stack traces by default:** `toolError` details previously echoed `err.stack`, which discloses the server's absolute filesystem paths. Stack details are now suppressed unless `QULIB_EXPOSE_ERROR_DETAIL=1` is set (opt-in for local debugging), applied pattern-wide across all MCP tool handlers via the new `safeErrorDetail()` helper.
- **LLM-as-judge prompt hardening (defense-in-depth):** the fixed rubric / security instructions for `qulib_score_bug_report` and `qulib_score_decisions` now live in the Anthropic `system:` role, so untrusted learner-report / fork-log text (which stays in the `user:` turn) cannot override the rubric, scoring scale, or output format. Adds an optional `system` field to the LLM provider interface; the bug-report judge also gains the delimiter-token neutralizer for parity with the decision and spec-conformance judges.

### Changed

- **Honest LLM fallback note:** `qulib score-decisions`, `qulib score-bug-report`, and `qulib validate` now print a one-line note to **stderr** when the LLM judge was requested (a key is present, and where applicable `--enable-llm-judge` was passed) but every result came back deterministic — i.e. the LLM call failed (out of API credits, network, or model). The legitimate "no `ANTHROPIC_API_KEY` → deterministic" case is unchanged and is **not** warned about. `--json` stdout stays pure (the note goes to stderr).

---

## [0.13.0] — 2026-06-27

### Added

- **`qulib validate` CLI + `qulib_validate_spec` MCP tool — spec-grounded validation:** Grade whether a deployed app's OBSERVED behavior conforms to a SUPPLIED spec (PRD / requirements file). Not "does it crash" — "does it match intent." `--spec <file>` parses a text/markdown requirements file; `--report <file>` or `--url` supplies the observed evidence. Without `--enable-llm-judge` (or no `ANTHROPIC_API_KEY`), all requirements return `conforms=unknown` and `verdict=insufficient-evidence` — honest, never fabricating verdicts. With the LLM judge enabled, each requirement is graded individually by the pinned haiku judge; both requirement text and observed summary are treated as untrusted input: wrapped with `delimitUntrusted()` and run through the delimiter-neutralizer (collapse `<<<` / `>>>` runs to `‹‹‹` / `›››`) before entering the prompt, preventing prompt-injection escape from the untrusted block. `--fail-on-violation` exits 1 on `violates` or `partial`; `insufficient-evidence` is not a violation. `--json` keeps stdout pure JSON (gate line to stderr). The MCP tool (`qulib_validate_spec`) follows the same security posture — input errors return a clean tool error without leaking a stack trace.
- **`qulib score-decisions`** — exposes the existing `scoreDecisions()` LLM-judge tool in the CLI. Reads a JSONL forks file (one `DecisionFork` per line) and emits per-fork `decisionQuality` (0..1), `seniorCorrect`, rationale, and aggregate means. Options: `--forks <file.jsonl>` (required), `--json`, `--enable-llm-judge`, `--min-quality <n>` (CI gate: exits non-zero when `aggregate.meanDecisionQuality < n`, prints `GATE: PASS|FAIL — <reason>`; gate line goes to stderr in `--json` mode).
- **`qulib score-bug-report`** — exposes the existing `scoreBugReport()` LLM-judge tool in the CLI. Reads a JSON file (`{ "report": {...}, "target": {...} }`) and emits `matched`, `matchConfidence`, a 4-part rubric (coverage/severity/repro/evidence, each 0–25), and feedback. Options: `--input <file.json>` (required), `--json`. Path is validated (regular file, ≤1 MiB); bad input prints a friendly one-line error with no raw ZodError stack. Falls back to deterministic scoring when `ANTHROPIC_API_KEY` is not set.

---

## [0.12.0] — 2026-06-27

### Added

- **CI release gate** on `qulib confidence`: `--fail-on <verdict>` exits non-zero when the verdict is at or worse than the threshold (`caution` | `hold` | `block`), and `--min-score <n>` exits non-zero when the 0–100 confidence score is below `n` (a `null` score — nothing evaluable — always fails). Prints a `GATE: PASS|FAIL — <reason>` line; in `--json` mode the gate line goes to stderr so stdout stays pure JSON. This wires the "should we ship?" verdict straight into a pipeline. The pure `evaluateConfidenceGate()` is exported for programmatic use.

---

## [0.11.0] — 2026-06-27

### Added

- **`qulib_score_bug_report`** — LLM-as-judge that grades a bug report against a planted-bug target: `matched` verdict, `matchConfidence`, a 4-part rubric (coverage / severity / repro / evidence), and actionable feedback. Falls back to deterministic scoring when no `ANTHROPIC_API_KEY` is set. The learner report is untrusted input and is prompt-injection hardened. Read-only.
- **`qulib_score_decisions`** — pivotal-decision evaluation: scores whether an autonomous agent made the senior-correct call at decision forks (gate block/pass, stop/continue, escalate/proceed) from a JSONL forks file. Returns per-fork `decisionQuality` (0–1), `seniorCorrect`, rationale, and aggregate means. Deterministic baseline by default; optional LLM refinement. `forksPath` is traversal-validated within `QULIB_FORKS_ALLOWED_ROOT` (default: process cwd).
- **Open-core boundary** documented in the README: the tool is fully open and local; calibrated benchmarks + cross-project signal + the hosted service are the gated tier.

### Security

- Decision-scoring path hardening (two adversarial review passes): reject a forks allowed-root of `/` and any symlink resolving to it (path-containment / LFI bypass), and neutralize forged untrusted-block delimiter tokens in fork text before the judge prompt (prompt-injection escape).

---

## [0.10.1] — 2026-06-27

### Fixed

- **Release confidence honesty notes:** Present-but-excluded evidence sources (`not_applicable`, `unknown`, null score) are now narrated before uncollected model sources so `maxListLength` truncation no longer drops notes that name collected sources.

---

## [0.10.0] — 2026-06-13

### Added

- **Per-page coverage heatmap in Markdown reports:** `report.md` now includes a `## Per-page coverage heatmap` section — a sorted table of scanned pages × coverage dimensions (`untested-route`, `a11y`, `console-error`, `broken-link`, `coverage`, `untested-api-endpoint`, `auth-surface`). Each cell shows the worst-severity gap for that page × dimension using an emoji intensity scale (🚨 critical · 🔴 high · 🟠 medium · 🟡 low · `·` none). Rows are sorted worst-first so the pages most in need of attention appear at the top. When no gaps are present the section is omitted entirely (no noise on clean runs). The two pure functions `buildPageHeatmap()` and `renderHeatmapSection()` — plus the `HEATMAP_DIMENSIONS` constant and `DIMENSION_LABELS` map — are exported from `@qulib/core` for programmatic use. Four golden-fixture test cases cover: empty gaps, multi-page mixed severities, a single page with all 7 dimensions populated, and worst-first sort order.

- **`qulib analyze-diff` — structured diff between two analyze_app outputs:** A new `qulib analyze-diff --from <report.json> --to <report.json>` command that compares two serialized `qulib analyze` outputs and produces a structured diff: added findings, removed findings, severity changes, and a confidence score delta. Emits Markdown by default (human-readable, suitable for CI job summaries and PR comments); `--json` emits a schema-valid `AnalyzeDiffResult` for scripted use. `--label-from` and `--label-to` attach human provenance labels to the report. The diff is a pure function of the two inputs — no disk state, no network, no LLM. Reuses the existing `BaselineDelta` schema and `compareBaselines()` logic; no second format is introduced. Golden eval cases added to `npm run eval` (new `analyze-diff` suite). `analyzeRunDiff()`, `formatAnalyzeDiffMarkdown()`, and `loadGapAnalysisFile()` exported from `@qulib/core`.

- **`qulib baseline` CLI — save, list, and compare (headline feature for 0.10):** Exposes the existing file-backed baseline store as a first-class CLI. `qulib baseline save --url <url> --from-report output/report.json` snapshots any `qulib analyze` run; `qulib baseline list --url <url>` shows all saved snapshots newest-first; `qulib baseline compare --url <url>` diffs the two most-recent snapshots and reports per-dimension drift — new gaps, resolved gaps, severity changes, and a confidence delta. Each changed item carries `path`, `category`, and `severity` so CI can attribute regressions to the exact dimension. `--from <id> --to <id>` lets you compare any two snapshots by explicit id. `--json` on all three commands emits machine-readable output for CI pipelines. Baselines are stored under `.qulib-baselines/` (local, gitignored); `--dir` overrides the storage root.

- **Naming convergence — 0.10 non-breaking aliases:** Confidence is the product; naming now converges on that truth without breaking any existing integration. Three legacy MCP tool names predate the `qulib_` prefix convention; they are now aliased under canonical forms: `qulib_analyze_app` (was `analyze_app`), `qulib_explore_auth` (was `explore_auth`), `qulib_detect_auth` (was `detect_auth`). Legacy names keep working unchanged. Two CLI commands gain aliases for integrations that prefer the full concept name: `qulib release-confidence` (alias for `qulib confidence`) and `qulib automation-score` (alias for `qulib score-automation`). All help text for the legacy names is annotated with the canonical form; all canonical help text notes the legacy alias. No deprecation warnings are emitted at runtime (notes in docs only). Removal is planned for 1.0. The `qulib_scaffold_tests` description is corrected: the `playwright` framework option is experimental and not yet implemented (it throws at runtime); the description no longer advertises it as working. The `explorer: 'cypress'` config field description now explicitly states it is not yet implemented and reserved for future use.

### Changed

- **MCP `qulib_scaffold_tests` description:** corrected to not advertise Playwright as a supported scaffold framework. The `cypress-e2e` default remains the only implemented option; `playwright` is now documented as experimental/unreleased.
- **Config schema `explorer` field:** description updated to note that `'cypress'` is reserved for future Cypress-driven exploration and throws at runtime. Always use `'playwright'` in production.

---

## [0.9.0] — 2026-06-10

This release promotes all work merged since v0.8.2 (PRs #92–#113). The headline fix is a broken installed CLI (any `npx @qulib/core` quickstart failed on published v0.8.2); the headline feature is the Release Confidence Layer — qulib can now answer "should we ship?" with a fused, multi-signal verdict.

### Fixed

- **Installed CLI bin shim (PR #109 — headline fix):** `npx @qulib/core analyze` and every other CLI command crashed with `ERR_MODULE_NOT_FOUND` on any published install of v0.8.2. The bin shim was pointing at the TypeScript source (`src/`) and running it via `npx tsx`, but `src/` is excluded from the published tarball and `tsx` is a devDependency. The shim now points at the compiled `dist/cli/index.js` and runs it with plain `node`. A companion fix ensures every packed or published tarball is guaranteed to contain a fresh `dist/` build (via a `prepack` script), and the config loader falls back gracefully when `qulib.config.ts` is not available under plain `node`.
- **CLI default-config fallback (PR #113):** Running `qulib analyze` from any directory without a `qulib.config.ts` file previously crashed with a config-not-found error. The CLI now starts with sensible built-in defaults when no config file is present, so the quickstart (`npx @qulib/core analyze --url https://example.com --ephemeral`) works with zero configuration. An explicit `--config` pointing at a missing file still produces a hard error.
- **`typescript` promoted to a runtime dependency:** `validate-specs.ts` (added in PR #102) imports the TypeScript compiler at module load time to validate generated specs. Because `typescript` was listed as a devDependency, the installed package was missing it and every CLI entry point crashed with `ERR_MODULE_NOT_FOUND` on a fresh install. Moving it to `dependencies` restores the correct runtime behaviour without changing any compile-time semantics.

### Added

- **Release Confidence Layer — `computeReleaseConfidence()` (PRs #95, #96, #97):** A new core function that folds multiple evidence sources (live-app scan, automation maturity, API coverage, CI results, PR metadata) into a single `ReleaseConfidence` output with a `ship` / `caution` / `hold` / `block` verdict. Includes `buildConfidenceInputFromQulib()` to adapt existing qulib outputs into evidence items (auth-required → unknown; blocked → blocking; honesty rules preserved), evidence collectors `ciResultsToEvidence()` and `prMetadataToEvidence()`, and a notquality dogfood example demonstrating a real 76/100 CAUTION verdict from live signals.
- **`qulib_score_confidence` MCP tool (PR #95):** A single MCP call that runs the full confidence pipeline — `analyzeApp` → `computeAutomationMaturity` → `computeApiCoverage` → confidence aggregation — and returns a schema-valid `ReleaseConfidence` with verdict. This is the flagship tool for AI agents that need a single authoritative "should we ship?" answer.
- **`qulib confidence` CLI command (PR #95):** Runs the same confidence pipeline from the command line. `--json` emits the full `ReleaseConfidence` envelope on stdout for CI or scripted use.
- **`qulib scaffold` and `qulib score-automation` CLIs (PR #92):** First-class command-line wrappers for the scaffold and automation-maturity APIs. `scaffold` supports the `cypress-e2e` and `playwright` adapters with `--json` for stdout output; `score-automation` renders `not_applicable` / `unknown` dimensions honestly with an applicable-dimensions-only normalized score.
- **Scaffold dry-run spec validation (PR #102):** `scaffoldTests()` now optionally transpiles every generated spec through the TypeScript compiler before returning it, surfacing generator bugs at scaffold time rather than when a developer first runs the suite. The CLI gains `--validate-specs` to make a validation failure a hard non-zero exit.
- **Reusable GitHub Actions analyze gate (PR #100):** A composite action (`.github/actions/qulib-analyze`) and a reusable workflow (`.github/workflows/qulib-analyze.yml`) that run `qulib analyze --agent-summary`, upload the JSON artifact, write a job summary, and map the gate verdict (`fail` / `warn` / `never`) to a CI exit code. Drop-in CI integration for any repo.
- **Evidence golden eval suite (PR #101):** A new `evidence` eval suite added to `npm run eval` that exercises the CI-results and PR-metadata adapters and the full confidence fusion path through `computeReleaseConfidence`. Closes the eval-coverage gap left after v0.8.2 (doctrine rule 11 — everything ships wrapped in evaluation).
- **Recipe toolshed (PR #93):** Four reusable `NeutralScenario` builders (`auth`, `a11y`, `nav`, `seed`) behind a `RecipeId` enum. `ScaffoldOptions` gains an additive `recipes?: RecipeId[]` parameter with recipe-aware rendering in both the Cypress and Playwright adapters.
- **Baseline monitor (PR #94):** A file-backed baseline store (`save` / `load` / `list` / `delete`) and `compareBaselines()` delta detection that identifies new, resolved, and severity-changed gaps between two snapshots. Full public surface exported from `@qulib/core`.
- **Publish guard (PR #99):** `prepublishOnly` build scripts added to root, `@qulib/core`, and `@qulib/mcp` so a local `npm publish` attempt always builds from a clean state rather than shipping stale or missing `dist/`. The pre-release gate script gains a pack-then-install smoke step that packs core into a tarball, installs it in a fresh directory, and asserts both `qulib --version` and `qulib --help` exit cleanly.

### Changed

- **New public exports from `@qulib/core`:** `computeReleaseConfidence`, `buildConfidenceInputFromQulib`, `ciResultsToEvidence`, `prMetadataToEvidence`, `compareBaselines` and related baseline store helpers, `RecipeId` / `RecipeIdSchema`, and the confidence / views schema types. All additions are additive — existing consumers are unaffected.
- **Multi-tenant eval ledger (PR #98):** Every `evals/ledger.jsonl` entry now carries a `tenantId` (from `TAP_TENANT_ID` env or `'default'`). Pre-existing entries read back as `legacy`.

### Chore

- **Repo hygiene (PR #110):** Removed four broken proposal workflow files (`.github/workflows/proposal-*.yml`) that called reusable workflows in a private repo and had 15/15 startup failures. Updated `CLAUDE.md` version references and `docs/source-map.md` to reflect shipped features.
- **Fresh-clone test reliability (PR #111):** Browser-dependent test suites (`analyze.fixtures.test.ts` and the fixture-server sub-suite in `scaffold.test.ts`) now detect Playwright Chromium availability at runtime and emit a clear skip message when the binary is absent or `PLAYWRIGHT_SKIP=1` is set. Pure-unit tests in those suites remain unconditional. CI coverage is unchanged.
- **Docs truth-up (PR #112):** READMEs for root, `@qulib/core`, and `@qulib/mcp` now accurately describe all seven MCP tools (led by `qulib_score_confidence`), all CLI commands including `scaffold`, `score-automation`, and `confidence`, and the correct quickstart (`npx @qulib/core confidence`). CI snippet refs pinned from `@v1` to `@v0.9.0`.

## [0.8.2] — 2026-06-01

### Added
- **@qulib/core:** repo-first API toolshed — `discoverApiSurface` (tiered, evidence-only discovery across OpenAPI/Swagger specs + Next/Express/Fastify/Hono/Nest routes), `computeApiCoverage` (new `api-test-coverage` dimension; the six existing dimensions rebalanced to sum 1.0; `untested-api-endpoint` gap category), and an `ApiAdapter` for supertest test generation.
- **@qulib/mcp:** `qulib_score_api` — repo → API discovery → contextual coverage score.

### Notes
- Backward-compatible: `computeAutomationMaturity(repo)` without an API surface is unchanged; existing scores are stable.

## [0.7.0] — 2026-05-30

### Added
- **@qulib/core:** `scaffoldTests(url, options?)` — crawls a URL via `analyzeApp`, renders
  `NeutralScenario[]` through the adapter layer, and returns `GeneratedTest[]` + `ProjectConfig`
  (ready-to-write `cypress.config.ts` / `playwright.config.ts` + `package.json` deps +
  support files). Framework: `cypress-e2e` (default) or `playwright`.
- **@qulib/core:** `CypressE2EAdapter.render()` fully implemented — handles all 10 `TestStep`
  action types: `navigate`, `click`, `type`, `assert-visible`, `assert-hidden`, `assert-text`,
  `assert-disabled`, `assert-count`, `wait`, `api-call`.
- **@qulib/mcp:** `qulib_scaffold_tests` tool — accepts `url` + optional `framework` +
  `maxPagesToScan`; returns `generatedTests` (array of `{filename, code, outputPath}`) and
  `projectConfig` so an agent can write the files directly to a repo with no manual test-writing.
- **@qulib/core exports:** `scaffoldTests`, `ScaffoldOptions`, `ScaffoldResult`, `ProjectConfig`
  re-exported from `@qulib/core` root.

## [0.6.0] — 2026-05-27

### Added
- **@qulib/core:** `toAgentSummary(result, policy?)` — a pure, no-I/O helper that projects an `AnalyzeResult` into a small versioned JSON shape (`schemaVersion: 1`) with `gate: 'pass' | 'warn' | 'fail'`, `coverageStatus`, `topRisks`, `recommendedNextChecks`, `honestyNotes`, `costSummary`, and `deterministicFollowUps`. Designed for orchestrators (CI gates, AI agents) that need a single small payload to decide whether a scan is good enough to ship. Conservative defaults — critical gaps, blocked status, or `auth-required` mode never silently pass.
- **@qulib/core CLI:** `qulib analyze --agent-summary` — emits the agent-summary JSON on stdout and writes nothing to disk. Mutually exclusive with `--ephemeral`.
- **@qulib/mcp:** `analyze_app` now accepts `agentSummary: true` to return the compact gate JSON instead of the summary-first envelope. Overrides `includeFullReport`.
- **docs:** `docs/agent-summary-output.md` — public spec for the shape, gate-derivation rules, policy overrides, and the `schemaVersion: 1` stability contract. Also adds the QLIB-001 PRD, implementation chunk plan, and design note.

## [0.5.3] — 2026-05-27

### Fixed
- **@qulib/core:** `detect-auth` no longer derives credential field names from placeholder example values. An email input with `placeholder="you@example.com"` and no `name` attribute previously produced a field name like `"youexamplecom"`; the fallback chain now prefers stable identifiers (`name` → `id` → `autocomplete` → input `type`) and guards placeholder/aria-label fallbacks against values containing `@` or `://`.

### Changed
- Example provider references in docs and tests updated to use notquality.com as the canonical demo target — qulib's own primary test surface.

## [0.5.2] — 2026-05-14

### Fixed
- **@qulib/core:** `detect-auth` now skips click-probe candidates that navigate to a non-login path after click (e.g. a marketing CTA that happens to lead to a sign-up form). Only paths whose post-click URL contains `/login`, `/sign-in`, `/auth`, `/sso`, or `/oauth` are treated as click-to-reveal auth forms. Eliminates false-positive automatable paths from homepage CTA buttons.
- **@qulib/core:** LLM scenario generation now receives each gap's real UUID in the prompt (prefixed `id:xxxx`) instead of a positional counter. Fixes `sourceGapIds` in generated scenarios returning `["1"]`, `["2"]` instead of actual gap UUIDs.

## [0.5.1] — 2026-05-14

### Fixed

- **@qulib/core:** `detect-auth` now probes `[role="button"]` elements in addition to `<button>` tags, and waits up to 5 s for a password field after navigation (was 2 s), so custom SSO providers that navigate to a dedicated login page are correctly detected.
- **@qulib/core:** `explore-auth` now click-probes user-local provider buttons (registered via `qulib auth providers add`) before classifying them as non-automatable OAuth. When clicking reveals a form, the path is returned as `automatable: true` with discovered field names and types.
- **@qulib/core:** `qulib auth login` now accepts `form-multi` paths (3+ fields such as username/password/district) and triggers click-reveal navigation for `user-local` source paths, completing the `qulib auth providers add` → `qulib auth login --auth-path <id>` workflow.

## [0.5.0] — 2026-05-14

### Added

- **PR #30** — local HTML fixtures + deterministic fixture server for offline integration baselines (`packages/core/fixtures/*`, `fixture-server.ts`, `analyze.fixtures.test.ts`).
- **PR #32** — offline CI smoke path using fixtures (`cli-smoke-fixture.ts`) plus a dedicated unit+fixture test job.
- **PR #33** — SKIP semantics now include actionable guidance on non-applicable/unknown automation maturity dimensions, with guidance surfaced in MCP compact summaries.
- **PR #31** — Claude 4 LLM scenario generation hardening: model default update, markdown fence stripping before JSON parse, and `--skip-auth-detection` CLI option.

### Changed

- `smoke-test-cli` CI workflow now runs offline against the local fixture server instead of a live `https://example.com` dependency.
- Core and MCP docs now include copy-paste walkthroughs for public/auth-blocked/authenticated flows, MCP tool mapping, and host env setup/troubleshooting.

### Fixed

- LLM scenario generation no longer fails silently on Claude 4 API keys due to a stale default model and fenced JSON parse path.

### Internal

- v0.5.0 **Runtime QA Intelligence Baseline** — Phase 1 complete.

## [0.4.3] — 2026-05-13

### Fixed

- **@qulib/core:** `qulib analyze` now validates the provided `--auth-storage-state` file **before** crawling. Invalid, missing, wrong-origin, or expired storage state produces an honest `status: 'blocked'` result with `releaseConfidence: 0`, `coverageScore: null`, and a structured `storage-state-invalid` gap explaining how to recover, instead of a misleading `releaseConfidence: 80`-style outcome from crawling 401 pages. The browser is never launched when the file is missing, unreadable, not JSON, or empty — those preflights are pure file checks.
- **@qulib/core:** `validateStorageState` now returns a stable reason code (`missing-file` · `unreadable-file` · `invalid-json` · `no-auth-cookies` · `wrong-origin` · `expired-or-unauthorized` · `unknown`) alongside the human-readable reason, so MCP clients and reports can branch on a fixed enum instead of free-text matching. Origin matching is strict — scheme + host + port must match exactly; subdomain, port, and protocol differences are all rejected.
- **@qulib/core:** `qulib auth login` now refuses to save a storage state when the browser ends the login flow on an origin different from `--base-url` (federated/SSO redirect that never returned to the app). Previously the storage state was saved on the IdP domain with only a soft warning, which caused later `analyze` runs to fail with 401s and (before the validator) misleading release confidence. The new failure message names both the expected and final origins and points the user at `qulib auth init` as the fallback.
- **@qulib/core:** Hardened CLI debug logging — `[qulib] Active config:` now redacts the form-login username as well as the password, and replaces the storage-state file path with `<provided>`. Recovery text in the `auth-block` and `storage-state-invalid` gaps now strips query strings and fragments from echoed URLs so a `?token=…` in `--url` cannot land in `report.md`, `report.json`, or `decision-log.json`.
- **@qulib/core:** New telemetry event `auth.storage-state.validated` (kind only) carrying `{ targetOrigin, valid, reasonCode, storageStateProvided }` — no file path, no cookies, no storage state contents. The existing `scan.blocked` event also carries the `reasonCode` when blocking on storage state validation.

### Changed

- **@qulib/core:** `evaluateStorageStateValidity` and `validateStorageState` now return `StorageStateValidationResult` (`{ valid, reasonCode, reason }`); the old `{ valid, reason }` fields are preserved so existing consumers keep working. A new `preflightStorageStateFile(path)` helper is exported for callers that want a fast file-shape check without launching a browser. `StorageStateInvalidReason` and `StorageStateValidationResult` are exported from `@qulib/core`.
- **@qulib/core:** New `buildStorageStateInvalidGap({ url, reasonCode, reason })` helper exported next to `buildAuthBlockGap`, used by `analyzeApp` and available to embedders building their own report renderers.

### Tests

- **@qulib/core:** Extended `auth-detector.test.ts` to assert every reason code on `evaluateStorageStateValidity` and `preflightStorageStateFile`, including strict-origin cases (`www`-subdomain, http-vs-https, differing port), unparseable final URLs, missing files, invalid JSON, empty storage state (cookies and localStorage both empty), localStorage-only storage state (still valid), and a POSIX-only `unreadable-file` case skipped on Windows/root.
- **@qulib/core:** New `analyze.storage-state-invalid.test.ts` wiring test asserts `analyzeApp` short-circuits to `status: 'blocked'` with `releaseConfidence: 0`, a `storage-state-invalid` gap, a `storage-state-invalid` decision-log entry, and an `auth.storage-state.validated` telemetry event — all without launching Playwright (uses a missing storage state path so the preflight short-circuits).
- **@qulib/core:** Extended `auth-block-gap.test.ts` with a per-reason-code recovery-text assertion for `buildStorageStateInvalidGap`.

### Docs

- **@qulib/core:** README "Scanning authenticated apps" section now documents the storage-state validator, the seven stable reason codes, the strict-origin rule, and the new `auth login` refusal-to-save behavior for federated flows that never return to the app origin.

## [0.4.2] — 2026-05-13

### Fixed

- **@qulib/core:** `qulib --version` now reads from `packages/core/package.json` instead of returning the hardcoded `0.1.0` left over from the initial Commander scaffold.
- **@qulib/core:** Automation maturity scoring no longer awards silent partial credit for absent capabilities. `component-test-ratio` is `not_applicable` when no Cypress is detected (previously defaulted to `50`). `auth-test-coverage` is `not_applicable` when the repo shows no auth routes, auth-named test files, or auth path coverage (previously hard-coded `25`). `test-id-hygiene` is `unknown` when no interactive TSX files were scanned (previously `100`); when applicable, it now scores on the missing-id **ratio** instead of a raw count.
- **@qulib/core:** `analyzeApp` reports now honor `HarnessConfig.outputDir`. Previously the `act` phase hard-coded `<cwd>/output` for `report.json` / `report.md` even when `outputDir` was set, despite the [0.4.0] entry claiming output directory support.
- **@qulib/core:** `qulib auth init` creates the parent directory of `--out` before saving the storage state (parity with `qulib auth login`). Previously a missing intermediate directory failed silently at write time.
- **@qulib/core:** Telemetry events no longer carry full URLs with query strings or fragments. `scan.started`, `phase.observe.started`, and the observe-phase decision log entry pass URLs through `redactUrlForTelemetry`, so secrets embedded in `?token=…` cannot leak via `QULIB_TELEMETRY_STDERR=1`. The exported helper accepts only `http:` and `https:` URLs and emits `protocol://host/pathname` (any `user:pass@` userinfo is stripped from the host). For all other inputs — non-URL strings, `mailto:`, `data:`, `file:`, `javascript:`, and other schemes the WHATWG URL parser accepts but that may carry secret-shaped right-hand sides — it returns the literal string `'[redacted-non-url]'` rather than echoing the input.
- **@qulib/mcp:** MCP server registration version follows the package version instead of being pinned at `0.4.1`.
- **@qulib/mcp:** `analyze_app` compact response replaces the full `repoInventory` (which contained unbounded `testFiles` and `missingTestIds` arrays) with a bounded `repoInventorySummary` of counts + framework verdict. The full `repoInventory` is still returned when `includeFullReport: true`.

### Changed

- **@qulib/core:** `AutomationMaturityDimension` schema gained optional `applicability` (`applicable` | `not_applicable` | `unknown`) and `reason` fields; `AutomationMaturity` gained an optional `scoreFormula` describing the normalization. The overall score is now computed as `round( Σ score·weight / Σ weight )` across applicable dimensions only, so absent or unknown signals cannot drag the headline number down. Changes are additive; existing consumers that don't read the new fields keep working.
- **@qulib/core:** `RepoAnalysis` gained an optional `interactiveTsxFilesScanned` counter that powers the honest test-id hygiene ratio.
- **@qulib/core:** New `resolveReportDir(outputDir?)` helper exported next to `resolveScanStateBaseDir`. When `HarnessConfig.outputDir` is set, both scan state and reports share that directory (state and report file names do not overlap); when unset, reports default to `<cwd>/output` and state defaults to `<cwd>/.scan-state` (legacy behavior).
- **@qulib/core:** New `redactUrlForTelemetry(url)` helper exported from the public API for embedding apps that build their own `TelemetrySink`.

### Tests

- **@qulib/core:** Added `automation-maturity.test.ts` covering the `applicable` / `not_applicable` / `unknown` branches for each dimension and the applicable-only overall normalization.
- **@qulib/core:** Added `cli-version.test.ts` asserting `qulib --version` matches `packages/core/package.json`.
- **@qulib/core:** Added `state-manager.test.ts` covering `resolveReportDir` defaults and the shared-dir contract when `outputDir` is set.
- **@qulib/core:** Added `redact-url.test.ts` covering query/fragment stripping and graceful fallback for non-URL inputs.
- **@qulib/mcp:** Extended `compact-analyze-payload.test.ts` to assert the compact payload never carries the raw `testFiles` or `missingTestIds` arrays and that `includeFullReport: true` still ships the full `repoInventory`.

### Docs

- **@qulib/mcp:** README tools list now documents `qulib_score_automation`, including the `applicability` field on each dimension and the applicable-only normalization. Compact vs full response table updated to call out the new `repoInventorySummary`.
- **@qulib/mcp:** Code comment on the MCP `auth` schemas documents the intentional flat shape vs core's nested `AuthConfigSchema` and the 1:1 translation contract.

## [0.4.1] — 2026-05-13

### Added

- **@qulib/core:** Optional `authOptions` on `DetectedAuth` (each entry is an `AuthPath`); `detectAuth` probes up to four non–IdP `<button>` labels for click-to-reveal username/password flows (and visible `<select>` fields such as District), then restores the login URL between probes.

### Fixed

- **@qulib/core:** `detectAuth` matches OAuth IdP buttons against `BUILT_IN_OAUTH_PROVIDERS` (including Clever, ClassLink, and other built-ins) instead of a short hard-coded list; single-word labels that match a built-in provider name are accepted; SSO-shaped buttons that do not match any built-in pattern are still surfaced as `provider: 'unknown'` in `oauthButtons`.
- **@qulib/core:** Click-to-reveal `authOptions` credential fields now include every visible text/email/password input and `select` (with labels from associated `<label>`, placeholder, aria-label, or name); auth-surface analysis no longer flags “OAuth-only” when `authOptions` includes a `form-login` path (emits a low-severity informational gap instead).

## [0.4.0] — 2026-05-12

### Added

- **@qulib/core:** `LlmProvider` abstraction with `AnthropicProvider` and `createProvider()`; `HarnessConfig` fields `llmProvider`, `llmModel`, `outputDir`, and `scoringWeights`.
- **@qulib/core:** Telemetry hooks (`TelemetrySink`, `emitTelemetry`, `NoopTelemetrySink`) and optional `telemetry` / `telemetrySessionId` on scan artifact options; phase and LLM lifecycle events.
- **@qulib/core:** Repo `framework` detection and `automationMaturity` scoring on `RepoAnalysis`; exports `scanRepo`, `computeAutomationMaturity`, `resolveScanStateBaseDir`.
- **@qulib/mcp:** `qulib_score_automation` tool; structured `QULIB_*` tool errors; optional `QULIB_TELEMETRY_STDERR=1` NDJSON telemetry on stderr; `automationMaturitySummary` in compact `analyze_app` payloads when repo data includes maturity.

### Changed

- **@qulib/core:** `callLLM` delegates to the provider registry; `computeQualityScoreFromGaps` honors optional severity weights (defaults unchanged).
- **@qulib/core:** `StateManager` and decision log paths respect `config.outputDir` (default remains `.scan-state` under cwd).
- **@qulib/mcp:** Migrated to `McpServer` + `registerTool`; server metadata includes description and version aligned with the package.

### Fixed

- **@qulib/mcp:** Deprecated low-level `Server` usage removed in favor of the supported MCP SDK high-level API.

## [0.3.1] — 2026-05-12

### Fixed

- **@qulib/core / @qulib/mcp:** Normalize `bin` paths for reliable npm installs on all platforms ([#21](https://github.com/TapeshN/qulib/pull/21)).

## [0.3.0] — 2026-05-12

### Added

- **@qulib/core:** Cost intelligence for LLM usage (token summaries, budget warnings, deterministic maturity hints, conversion recommendations).
- **@qulib/core:** Auth-wall handling with public-surface analysis, coverage score behavior, and flatter gap reporting for blocked/partial scans.
- **@qulib/mcp:** Stderr progress logger and optional `AnalyzeProgressSink` for `analyze_app`.
- **@qulib/core:** `npm run smoke` script for ephemeral `example.com` analyze.

### Changed

- LLM budget field naming clarified (`llmMaxOutputTokensPerCall` vs legacy `llmTokenBudget`); MCP default responses stay summary-first; cost doctor and docs updates.

### Fixed

- **@qulib/mcp:** Build `@qulib/core` before `tsc`; stricter typing for progress logging.

### Chore

- Live `analyzeApp` integration tests and coverage-score TODO follow-ups.

## [0.2.2] — 2026-05-12

### Added

- **@qulib/core / MCP:** `explore_auth` (multi-path auth exploration, curated + heuristic providers, user-local `~/.qulib/providers.json` registry) ([#15](https://github.com/TapeshN/qulib/pull/15)).

## [0.2.1] — 2026-05-11

### Fixed

- Clear error when Playwright Chromium is not installed; auth detector waits for hydration ([#13](https://github.com/TapeshN/qulib/pull/13)).

## [0.2.0] — 2026-05-11

### Added

- **CLI:** `detect-auth` / auth detection pipeline and **`qulib auth init`** for OAuth/SSO-style flows (storage state capture) ([#10](https://github.com/TapeshN/qulib/pull/10)).
- Manual testing checklist for CLI, auth, and MCP (linked from README).

## [0.1.1] — 2026-05-11

### Fixed

- **Explorer:** Same-site link discovery handles `www` vs apex hostnames ([#8](https://github.com/TapeshN/qulib/pull/8)).

### Chore

- Community onboarding (issue/PR templates, code of conduct, contributing).
- Root `package.json` repository metadata; publish-readiness README and dry-run verification.
