# Design note: default gate policy for `toAgentSummary`

**Initiative:** QLIB-001  
**Chunk:** C02 (helper + tests)  
**Status:** Implemented for the pure helper. CLI and MCP surfaces are out of scope until C03/C04.

---

## Goal

Provide a small, **honest**, **deterministic** mapping from `AnalyzeResult` to an agent-facing JSON summary, with a default gate (`pass | warn | fail`) that orchestrators can rely on without rewriting policy from scratch.

---

## Default policy (helper)

Evaluated **in order**; first match wins.

1. **`fail`** when any of:
   - any **critical** gap exists,
   - `result.status === 'blocked'`,
   - `releaseConfidence` is `null`,
   - `releaseConfidence < failConfidenceThreshold` (default `30`),
   - `gapAnalysis.mode === 'auth-required'` **and** `authRequiredGate === 'fail'` (default).
2. **`warn`** when any of:
   - any **high** severity gap exists,
   - `result.status === 'partial'`,
   - coverage is **thin** / **budget-exceeded** / **navigation-failures**,
   - `releaseConfidence < passConfidenceThreshold` (default `80`).
3. **`pass`** otherwise.

---

## Why these defaults

- **Honesty over fake confidence.** An `auth-required` scan never silently `pass`es by default; the deployment was not exercised past the auth boundary. Callers that *intentionally* run anonymous-only scans on protected products can override with `authRequiredGate: 'warn'` — explicit, not silent.
- **Critical fails are always blocking.** Even at 100 release confidence, a critical accessibility or console finding outweighs the scalar score.
- **Coverage warnings always degrade the gate.** `low-coverage`, `budget-exceeded`, and `navigation-failures` cannot promote to `pass`; they at least drop to `warn`.
- **`null` confidence fails.** No score → no green light.
- **Thresholds are policy.** `80 / 30` are conservative defaults; orchestrators that have measured their own product can lower them via `AgentSummaryPolicy`.

---

## What the helper does **not** do

- Read or write files.
- Hit the network.
- Mutate the input.
- Decide whether to publish, deploy, or merge — that is the orchestrator’s job.

---

## Forward compatibility

- The summary carries `schemaVersion: 1`. Any breaking change to fields, gate semantics, or default policy bumps the version and is documented in CHANGELOG + `docs/agent-summary-output.md`.
- New optional fields can be added at `schemaVersion: 1` only if existing consumers can ignore them safely.

---

## Related

- [../agent-summary-output.md](../agent-summary-output.md)
- [../prds/QLIB-001-agent-summary-and-gate-output.md](../prds/QLIB-001-agent-summary-and-gate-output.md)
- [../chunks/QLIB-001-C01-agent-summary-format.md](../chunks/QLIB-001-C01-agent-summary-format.md)
- `packages/core/src/agent-summary.ts`
- `packages/core/src/__tests__/agent-summary.test.ts`
