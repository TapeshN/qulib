# Agent-facing summary output

This document defines a **desired** consolidated JSON shape for orchestrators and AI agents, and compares it to **what exists today**.

---

## Status: planned vs implemented

| Aspect | Status |
|--------|--------|
| `toAgentSummary(result, policy?)` helper exported from `@qulib/core` | **Implemented (QLIB-001-C02)** — see `packages/core/src/agent-summary.ts` and [design/agent-summary-policy.md](./design/agent-summary-policy.md). |
| CLI `analyze --agent-summary` | **Implemented (QLIB-001-C03)** — stdout is only agent summary JSON; incompatible with `--ephemeral`. |
| MCP `analyze_app` with `agentSummary: true` | **Implemented (QLIB-001-C04)** — response is only `toAgentSummary(result)` JSON. |
| Unified top-level object with `gate`, `topRisks`, `recommendedNextChecks`, `honestyNotes`, etc. | **Implemented** via `toAgentSummary` (`schemaVersion: 1`). Exposed from **CLI** (`--agent-summary`) and **MCP** (`agentSummary: true`). |
| MCP `analyze_app` default (summary-first) | **Implemented** — see `@qulib/mcp` `summarizeAnalyzeResult` and [packages/mcp/README.md](../packages/mcp/README.md). |
| Full `AnalyzeResult` / report JSON on disk or with `includeFullReport: true` | **Implemented** — see `GapAnalysis` in `@qulib/core` schemas. |

Orchestrators may consume the stable object via **`toAgentSummary`**, **CLI `--agent-summary`**, or **MCP `analyze_app` with `agentSummary: true`**. For the default MCP summary-first envelope, continue to use `summarizeAnalyzeResult` fields unless you need the gate-shaped object.

---

## Desired shape (QLIB-001 target)

Stable, versioned object for gates and orchestration (e.g. tap-agent, CI). Field names are indicative; final names may follow strict semver / schema export rules.

```json
{
  "gate": "warn",
  "releaseConfidence": 64,
  "coverageStatus": "thin",
  "topRisks": [
    "Auth blocked key routes",
    "Low crawl coverage",
    "Accessibility violations found"
  ],
  "recommendedNextChecks": [
    "Run authenticated scan",
    "Verify checkout flow manually",
    "Review axe violations"
  ],
  "honestyNotes": [
    "This scan does not guarantee production readiness.",
    "Coverage was below confidence threshold."
  ],
  "costSummary": null,
  "deterministicFollowUps": []
}
```

### Field notes (normative intent)

| Field | Description |
|-------|-------------|
| `gate` | **`pass` \| `warn` \| `fail`** — derived by `toAgentSummary()` from Qulib signals and optional `AgentSummaryPolicy`. Must align with **honest** semantics: e.g. `auth-required` or thin coverage cannot imply `pass` without explicit policy (see [design/agent-summary-policy.md](./design/agent-summary-policy.md)). |
| `releaseConfidence` | Number **0–100** or orchestrator mapping when source is `null` (document why). Mirrors `gapAnalysis.releaseConfidence`. |
| `coverageStatus` | Coarse enum for agents (e.g. `ok` \| `thin` \| `blocked-by-auth`). Maps from `coveragePagesScanned`, `coverageWarning`, and `mode`. |
| `topRisks` | Short strings; may mirror top severities from `gaps` plus mode/coverage/auth context. |
| `recommendedNextChecks` | Human/agent actionable; can align with MCP `nextDeterministicChecks` and Cost Intelligence `conversionRecommendations` when present. |
| `honestyNotes` | **Required** for brand-consistent messaging: limits of scan, coverage floor, auth wall, etc. |
| `costSummary` | Optional subset when Cost Intelligence ran (tokens, budget warnings, maturity). **Planned** as a stable slice; today see `costIntelligenceSummary` in MCP compact response. |
| `deterministicFollowUps` | Structured list (strings or objects) of checks to implement in CI/playwright/axe, etc. Overlaps MCP `nextDeterministicChecks`. |

---

## What exists today (mapping hints)

Agents can **construct** the planned shape from:

- **`gapAnalysis.releaseConfidence`**, **`gapAnalysis.mode`**, **`gapAnalysis.coverageWarning`**, **`gapAnalysis.coveragePagesScanned`**
- **`gaps`** (severity-sorted top N)
- MCP compact payload: **`summary`**, **`topGaps`**, **`nextDeterministicChecks`**, **`costIntelligenceSummary`**, **`routeInventorySummary`**, **`decisionLogPreview`**

`AnalyzeResult.status`: `complete` | `blocked` | `partial` — use alongside `mode` for honesty.

---

## Versioning and schema changes

When QLIB-001 is implemented:

- Document **schema version** in the summary object.
- Any **breaking** change to report JSON or this summary requires **migration notes** in the changelog and agent docs.

---

## Related

- [agent-usage.md](./agent-usage.md)  
- [design/agent-summary-policy.md](./design/agent-summary-policy.md)  
- [prds/QLIB-001-agent-summary-and-gate-output.md](./prds/QLIB-001-agent-summary-and-gate-output.md)  
- [chunks/QLIB-001-C01-agent-summary-format.md](./chunks/QLIB-001-C01-agent-summary-format.md)  
