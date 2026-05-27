# Deterministic tooling opportunities

Qulib’s design line: **deterministic checks scale**; **LLMs explore gaps**. Cost Intelligence exists to surface when repeated LLM reasoning should graduate into owned checks.

This document lists **candidates** for automation (CI, validators, small CLIs)—some may already be partially covered by tests; others are **ideas** for QLIB-005–style work. Nothing here promises a shipped tool until implemented.

---

## Report and schema validation

| Opportunity | Rationale |
|-------------|-----------|
| Validate full report JSON against `GapAnalysis` / `AnalyzeResult` shapes | Catch schema drift between core and MCP consumers early. |
| Validate **agent summary** output (post–QLIB-001) | Ensure `gate` / `honestyNotes` / required fields present when orchestrators depend on them. |

---

## Gate and policy config

| Opportunity | Rationale |
|-------------|-----------|
| Validate **gate policy** files (thresholds, forbidden `pass` when `auth-required`) | Prevents CI from green-lighting blocked states by misconfiguration. |

*First-party gate defaults live in `toAgentSummary()` / `AgentSummaryPolicy`; orchestrators may still apply stricter rules.*

---

## Docs and examples

| Opportunity | Rationale |
|-------------|-----------|
| Lint or test **CLI examples** in README/docs (copy-paste commands) | Reduces doc rot. |
| Check MCP README **tool list** against registered tools in `@qulib/mcp` | Surfaces rename/add/remove drift. |

---

## Cost ledger summarization

| Opportunity | Rationale |
|-------------|-----------|
| Summarize `costIntelligence` / usage records for regression (golden tests) | Stable expectations for token shape and budget warning counts in fixtures. |

---

## Scan-state detection

| Opportunity | Rationale |
|-------------|-----------|
| Deterministic classification of **low coverage** vs **ok** vs **auth-required** | Same logic QLIB-001 would use for `coverageStatus` / `honestyNotes` templates—avoid LLM re-deriving each time. |

Core already encodes much of this in `gapAnalysis.mode`, `coverageWarning`, and scoring; exposing a **single function** or export for orchestrators is a small API enhancement (spec in QLIB-001 chunk).

---

## Related initiatives

- **QLIB-001** — Agent summary + gate output (see [prds/QLIB-001-agent-summary-and-gate-output.md](./prds/QLIB-001-agent-summary-and-gate-output.md)).  
- **QLIB-005** (portfolio-level name) — Broader “deterministic tooling” program; can fold items above into chunks as needed.  

---

## Related docs

- [agent-summary-output.md](./agent-summary-output.md)  
- [agent-usage.md](./agent-usage.md)  
