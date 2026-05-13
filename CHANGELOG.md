# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [0.3.1]

Prior release; see git history for details.
