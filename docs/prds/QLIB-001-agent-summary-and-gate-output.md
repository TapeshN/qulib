# PRD (draft): QLIB-001 — Agent summary and gate output

**Status:** Implemented on `feature/qlib-001-agent-summary-gate` (C01–C04).  
**Owner:** Maintainers / Composer via approved chunks.

---

## Problem

Orchestrators and AI agents need a **small, stable, honest** summary of a Qulib run for gates and automation. Today:

- MCP `analyze_app` returns a useful **summary-first** payload (implemented).
- There is **no** first-party, versioned **unified JSON** with explicit `gate`, `coverageStatus`, and required **`honestyNotes`** for all consumers (planned).

Fragmented interpretation risks **overclaiming** readiness.

---

## Goals

1. Define (and optionally emit) a **versioned agent summary** aligned with [../agent-summary-output.md](../agent-summary-output.md).
2. Support **orchestrator-owned** or **Qulib-bundled** gate policy (decision: document in implementation phase; default is honest mapping rules).
3. Preserve **auth-required** and **low-coverage** semantics: they cannot silently map to “pass” without explicit policy documentation.

---

## Non-goals

- Building a full multi-agent orchestrator in this repo.
- Changing npm publish process.
- Replacing the full `AnalyzeResult` report—summary is additive or a documented projection.

---

## Users

- External orchestrators (CI, custom agents).
- MCP clients that want one JSON blob for decisions.

---

## Acceptance criteria (draft)

- [x] Spec in `docs/agent-summary-output.md` matches implemented fields.
- [x] Summary includes **`honestyNotes`** when any limit applies (coverage, auth, budget, partial status).
- [x] **`gate`** derivation rules documented; forbidden combinations tested (e.g. `auth-required` + `pass` unless explicit override flag).
- [x] CLI (`--agent-summary`) and MCP (`agentSummary: true`) emit the summary.
- [x] `schemaVersion: 1` on summary object; no breaking renames in this initiative.
- [x] Tests for mapping from fixture `AnalyzeResult` → summary (`agent-summary.test.ts`).

---

## Risks

- Gate semantics are **policy-sensitive**; wrong defaults damage trust. Mitigation: conservative defaults, explicit override, loud docs.

---

## Related chunks

- [../chunks/QLIB-001-C01-agent-summary-format.md](../chunks/QLIB-001-C01-agent-summary-format.md)
