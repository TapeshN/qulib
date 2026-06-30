# Monetization and entitlements (open-core)

Qulib is **open-core**: the local OSS tool stays free, offline-capable, and no-egress. Monetization applies only to **hosted / enterprise DEEP rungs** — deeper evidence collection and generation that go beyond what the free local path provides.

## Evidence ladder

| Rung | Tier | Examples |
|------|------|----------|
| Shallow / deterministic | **free** (local OSS) | `analyze_app`, `qulib_score_automation`, `qulib_score_confidence`, `qulib_score_api`, auth tools, deterministic spec/decision rubrics |
| Deep generation & LLM judges | **pro** | `qulib_scaffold_tests`, LLM-backed `qulib_validate_spec`, LLM refinement in `qulib_score_decisions` |
| Full-repo generation (future) | **enterprise** | End-to-end repo synthesis (not yet exposed) |

Deeper evidence requires a higher tier. The MCP layer returns **honest** results: either the shallow/deterministic path, or a clear notice that the capability requires a paid tier — never fabricated scores.

## What stays free

These MCP tools are **tier-agnostic** and unchanged on the free local path:

- `analyze_app` / `qulib_analyze_app`
- `qulib_score_automation`
- `qulib_score_api`
- `qulib_score_confidence`
- `qulib_score_provenance`
- `qulib_diff`
- `detect_auth` / `qulib_detect_auth`
- `explore_auth` / `qulib_explore_auth`
- `qulib_detect_prompt_leakage`
- `qulib_score_bug_report` (subject to rate limits, not tier)
- Deterministic paths for `qulib_validate_spec` and `qulib_score_decisions` when `enableLlmJudge` is false or omitted

Core scorers in `@qulib/core` remain tier-agnostic. Gating lives **only** in `packages/mcp/src/entitlements.ts` and the MCP tool handlers.

## Tier resolution

Tiers: `free` | `pro` | `enterprise` (default: `free`).

```
explicit tierOverride (future hosted per-request)
  → TAP_TIER env
  → "free"
```

Tenant id (for telemetry and future per-tenant billing):

```
explicit subject.tenantId (where a tool accepts it)
  → TAP_TENANT_ID env
  → "default"
```

No network calls — env/config only. A future hosted MCP endpoint can inject `tierOverride` per request without changing core.

## Gated capabilities

Defined in `packages/mcp/src/entitlements.ts` as `GATED_CAPABILITIES`:

| Capability | Minimum tier |
|------------|--------------|
| `scaffold_tests` | pro |
| `validate_spec_deep` (LLM judge) | pro |
| `score_decisions_deep` (LLM refinement) | pro |
| `full_repo_generation` (future) | enterprise |

When unentitled:

- **`qulib_scaffold_tests`** — returns an entitlement notice pointing to `analyze_app` as the free alternative. No scaffold output is fabricated.
- **`qulib_validate_spec`** with `enableLlmJudge=true` — falls back to the deterministic insufficient-evidence path and attaches an entitlement notice.
- **`qulib_score_decisions`** with `enableLlmJudge=true` — falls back to the deterministic rubric and attaches an entitlement notice.

Handlers never throw on entitlement denial and never mutate core scoring logic.

## Local development

```bash
# Default — free tier, all currently-free tools behave as today
qulib-mcp

# Simulate pro/enterprise for integration testing
TAP_TIER=pro qulib-mcp
TAP_TIER=enterprise qulib-mcp
```

Publishing to npm is a separate deliberate step; this document describes runtime behavior only.
