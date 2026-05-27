# Orchestrator integration

Qulib is designed to be consumed by **external orchestrators** (for example a portfolio-level “tap-agent” style system) **without** embedding orchestration logic in this repository.

---

## What Qulib provides

- **QA intelligence:** crawl-backed signals, accessibility (axe), broken links, console errors, navigation failures, prioritized gaps.
- **Release-readiness signal:** `releaseConfidence`, coverage floors, explicit **`auth-required`** and **`low-coverage`** semantics.
- **MCP surface:** `analyze_app`, auth helpers, optional automation repo scoring (`qulib_score_automation`).
- **Optional Cost Intelligence:** token usage, budgets, fingerprints, maturity hints inside the harness (when enabled).

---

## How an orchestrator should use Qulib

1. **As a signal, not a verdict**  
   Combine Qulib output with policy (thresholds, required authenticated paths, manual sign-off). Qulib already avoids fake confidence when data is thin; orchestrators should preserve that.

2. **As a release gate (policy layer)**  
   Use **`toAgentSummary(result, policy?)`** from `@qulib/core` (CLI `--agent-summary`, MCP `agentSummary: true`) for a versioned object with `gate`, `coverageStatus`, and `honestyNotes`. Override thresholds via `AgentSummaryPolicy`; orchestrators may still apply stricter rules on top.

3. **As a benchmark signal**  
   Synthetic or seeded apps (e.g. notquality-style playgrounds) can compare runs over time: confidence trends, gap counts, and whether deterministic follow-ups reduced LLM cost.

4. **Without repository coupling**  
   Depend on **published packages** (`@qulib/core`, `@qulib/mcp`), CLI contracts, and documented JSON. Do not assume private monorepo paths or org-internal identifiers in this repo’s docs.

---

## What Qulib does not own

- Multi-agent routing, Slack threads, PRD storage, cost accounting across unrelated tools.
- **npm publish** or version bumps from agent sessions (human-maintained release process).

---

## Related docs

- [agent-usage.md](./agent-usage.md)  
- [agent-summary-output.md](./agent-summary-output.md)  
- [agent-classes-for-qulib.md](./agent-classes-for-qulib.md)  
