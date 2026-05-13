# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for **0.3.1 and earlier** were reconstructed from git tags (`v0.1.1` … `v0.2.2`) and release commits on `main`.

## [0.4.2] — 2026-05-13

### Fixed

- **@qulib/core:** `qulib --version` now reads from `packages/core/package.json` instead of returning the hardcoded `0.1.0` left over from the initial Commander scaffold.
- **@qulib/core:** Automation maturity scoring no longer awards silent partial credit for absent capabilities. `component-test-ratio` is `not_applicable` when no Cypress is detected (previously defaulted to `50`). `auth-test-coverage` is `not_applicable` when the repo shows no auth routes, auth-named test files, or auth path coverage (previously hard-coded `25`). `test-id-hygiene` is `unknown` when no interactive TSX files were scanned (previously `100`); when applicable, it now scores on the missing-id **ratio** instead of a raw count.
- **@qulib/mcp:** MCP server registration version follows the package version instead of being pinned at `0.4.1`.

### Changed

- **@qulib/core:** `AutomationMaturityDimension` schema gained optional `applicability` (`applicable` | `not_applicable` | `unknown`) and `reason` fields; `AutomationMaturity` gained an optional `scoreFormula` describing the normalization. The overall score is now computed as `round( Σ score·weight / Σ weight )` across applicable dimensions only, so absent or unknown signals cannot drag the headline number down. Changes are additive; existing consumers that don't read the new fields keep working.
- **@qulib/core:** `RepoAnalysis` gained an optional `interactiveTsxFilesScanned` counter that powers the honest test-id hygiene ratio.

### Tests

- **@qulib/core:** Added `automation-maturity.test.ts` covering the `applicable` / `not_applicable` / `unknown` branches for each dimension and the applicable-only overall normalization, plus `cli-version.test.ts` asserting `qulib --version` matches `packages/core/package.json`.

### Docs

- **@qulib/mcp:** README tools list now documents `qulib_score_automation`, including the `applicability` field on each dimension and the applicable-only normalization.

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
