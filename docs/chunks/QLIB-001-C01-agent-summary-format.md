# Work chunk: QLIB-001-C01 — Agent summary format (docs/spec only)

**Initiative:** QLIB-001  
**Type:** Documentation / specification  
**Implementation code:** Out of scope for this chunk unless explicitly approved later.

---

## Objective

Lock the **intended** machine-readable agent summary so Composer and orchestrators can implement against a stable target.

---

## Deliverables (done when this chunk merges)

- [x] `docs/agent-summary-output.md` defines planned JSON shape vs current MCP/core fields.
- [x] Mapping notes from `AnalyzeResult` / MCP compact payload to future fields (`gate`, `coverageStatus`, `topRisks`, etc.).
- [x] Explicit statement: **`gate` is not emitted by core today**; orchestrators may derive interim gates from documented rules.

---

## Out of scope (next chunks)

- TypeScript types + exported builder `toAgentSummary(result, policy)`.
- CLI flag (e.g. `--agent-summary`) or MCP field to request summary-only artifact.
- Golden tests for summary mapping.

---

## Acceptance criteria

- A new contributor can read **only** `agent-summary-output.md` and know what is **shipped** vs **planned**.
- Honesty requirements (`auth-required`, `low-coverage`) are reflected in field descriptions.

---

## References

- [../prds/QLIB-001-agent-summary-and-gate-output.md](../prds/QLIB-001-agent-summary-and-gate-output.md)  
- `packages/mcp/src/summarize-analyze-result.ts`  
- `packages/core/src/schemas/gap-analysis.schema.ts`  
