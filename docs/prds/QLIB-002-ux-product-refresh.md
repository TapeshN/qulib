# PRD (draft): QLIB-002 — UX / product research refresh

**Status:** Draft — research-led; no implementation commitment in this file.

---

## Problem

README, CLI quick start, MCP onboarding, and release-confidence language must stay **clear**, **honest**, and **aligned** with what the harness actually measures. Without periodic refresh, agents and humans misread confidence or Cost Intelligence scope.

---

## Goals

1. README / docs audit: first-run success, honest uncertainty, Cost Intelligence explained as **harness LLM cost**, not customer cloud spend unless stated.
2. Identify misunderstanding hotspots (confidence vs coverage, `auth-required`, MCP `includeFullReport`).
3. Produce a prioritized backlog of doc and UX fixes (may spawn small implementation PRs).

---

## Non-goals

- Rebranding the product name or npm scope without maintainer decision.
- Adding orchestration to Qulib.

---

## Suggested inputs

- `Researcher<qulib>` findings (external process).
- Support issues / discussions (if public).

---

## Acceptance criteria (draft)

- [ ] Published doc set (root README, core README, MCP README, [../agent-usage.md](../agent-usage.md)) cross-linked without contradiction.
- [ ] At least one **“common mistakes”** subsection or doc (location TBD).
- [ ] Research notes stored per your portfolio process (not necessarily in this repo).

---

## Related

- [../agent-classes-for-qulib.md](../agent-classes-for-qulib.md)  
- [QLIB-004-mcp-agent-usage-guide.md](./QLIB-004-mcp-agent-usage-guide.md)  
