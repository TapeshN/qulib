# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for **0.3.1 and earlier** were reconstructed from git tags (`v0.1.1` … `v0.2.2`) and release commits on `main`.

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
