# PRD (draft): QLIB-003 — Cost Intelligence reporting UX

**Status:** Draft — Cost Intelligence exists in core/MCP; this PRD targets **how it is presented** to humans and agents.

---

## Background (implemented today)

Core can attach **Cost Intelligence** to gap analysis: token usage, budget warnings, prompt fingerprints, deterministic maturity hints, conversion recommendations (when the harness runs LLM-backed phases). MCP compact responses expose `costIntelligenceSummary` and may include fuller `costIntelligence` depending on payload design—see `@qulib/mcp` implementation.

---

## Problem

Dense JSON is hard for agents to summarize consistently; humans may confuse **harness LLM cost** with **application hosting cost**.

---

## Goals

1. **Clarify semantics** in UI/docs: what is measured, when `costSummary` is null, what “maturity” implies.
2. Improve **scan readability**: short human strings + stable machine fields (may overlap QLIB-001 `costSummary`).
3. Optional: CLI `cost doctor` discoverability from main docs (already partially documented).

---

## Non-goals

- Building a hosted billing product inside Qulib.
- Storing API keys or user secrets (never).

---

## Acceptance criteria (draft)

- [ ] Terminology glossary (tokens, budget warning, fingerprint, maturity) in docs or report appendix.
- [ ] Agent-facing guidance: when to run full vs compact MCP for cost reasons.
- [ ] No overclaiming: Cost Intelligence does not assert “you saved $X in production.”

---

## Related

- [../deterministic-opportunities.md](../deterministic-opportunities.md)  
- [../agent-summary-output.md](../agent-summary-output.md)  
