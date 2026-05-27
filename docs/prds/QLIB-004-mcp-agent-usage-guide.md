# PRD (draft): QLIB-004 — MCP agent usage guide

**Status:** Draft — much of the content already lives in [packages/mcp/README.md](../../packages/mcp/README.md) and [../agent-usage.md](../agent-usage.md); this PRD tracks **consolidation and gaps**.

---

## Problem

MCP hosts differ (Cursor, Claude Desktop, Claude Code). Agents need a **single checklist**: tools, auth flow order, `includeFullReport`, env vars, Playwright install, and honesty rules.

---

## Goals

1. Ensure [../agent-usage.md](../agent-usage.md) and MCP README **do not diverge** on tool names and defaults.
2. Add **decision tree**: when `explore_auth` vs `detect_auth`; when compact vs full report; when `qulib_score_automation` applies.
3. Document **privacy boundaries** (API keys in host env only; `repoPath` local absolute path requirement).

---

## Non-goals

- Documenting proprietary orchestrators by name beyond generic “external orchestrator” examples.

---

## Acceptance criteria (draft)

- [ ] Tool table in one canonical place with others linking to it.
- [ ] Example JSON payloads for common agent turns (redacted URLs).
- [ ] Troubleshooting: `QULIB_DEBUG`, Playwright chromium install.

---

## Related

- [../agent-usage.md](../agent-usage.md)  
- [../orchestrator-integration.md](../orchestrator-integration.md)  
