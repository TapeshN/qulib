# Agent usage guide

This document is for **AI agents and orchestrators** that consume Qulib (CLI, programmatic API, or MCP). Qulib answers: **“Is this app ready to ship?”** It prefers **honest uncertainty** over fake confidence when coverage is thin, auth blocks the crawl, or data is incomplete.

Orchestration (Slack flows, PRDs, multi-agent routing) lives **outside** this repository. Qulib only provides scan intelligence, reports, and MCP tools.

---

## CLI (quick reference)

From the published package:

```bash
npx @qulib/core analyze --url https://example.com
```

From a clone of this monorepo (repo root):

```bash
npm run analyze -w @qulib/core -- --url https://example.com
```

**Smoke (no disk writes, stdout JSON):**

```bash
npm run smoke
```

**Agent summary (writes `output/report.json`; stdout is only `toAgentSummary` JSON; progress on stderr):**

```bash
npm run analyze -w @qulib/core -- --url https://example.com --agent-summary
```

**Cost doctor** (after an analyze run that wrote `output/report.json` under `packages/core`):

```bash
cd packages/core && npx tsx src/cli/index.ts cost doctor
```

For full flags, artifact layout, and Cost Intelligence options, see [packages/core/README.md](../packages/core/README.md).

---

## MCP (quick reference)

Configure your MCP host with `npx` / `npx -y` and the `@qulib/mcp` package. Optional `ANTHROPIC_API_KEY` enables LLM-backed scenario generation; without it, template scenarios still run.

Main tools today:

| Tool | Role |
|------|------|
| `explore_auth` | Discover sign-in paths and requirements before a deep scan. |
| `detect_auth` | Lighter single-pattern auth hint. |
| `analyze_app` | Full quality scan; **default response is summary-first**. |
| `qulib_score_automation` | Score a **local** automation repo (requires absolute `repoPath` on the host). |

For `analyze_app`, pass **`includeFullReport: true`** only when you need the full `gapAnalysis` (all scenarios, generated tests) and full `repoInventory` arrays. Default keeps context small: summary, top gaps, cost summary when present, `nextDeterministicChecks`, previews. Pass **`agentSummary: true`** when you need **only** the compact gate summary (`toAgentSummary`); that replaces the default envelope for that call (and ignores `includeFullReport` for the response shape).

Details: [packages/mcp/README.md](../packages/mcp/README.md).

---

## How to interpret release confidence

- **Release confidence** is a **0–100** score derived from prioritized gaps (see engine in `packages/core/src/tools/gap-engine.ts` and scoring in `packages/core/src/tools/scoring/gaps.ts`).
- It reflects **evaluated pages**, not guaranteed production quality. **Never** present it as “the app is bug-free.”
- If **`coverageWarning` is `low-coverage`**, fewer than `minPagesForConfidence` pages were scanned: confidence is **capped** (see root README and core README) so thin coverage does not read as “ready.”
- If **`mode` is `auth-required`**, the deployment was **not** exercised past the auth boundary in that run: treat inventory and confidence accordingly (often **0** with no meaningful gap inventory for the protected surface).

`AnalyzeResult.status` is `complete`, `blocked`, or `partial`—use it with `gapAnalysis.mode` and `coverageWarning`, not as a shipping gate by itself.

---

## Low coverage

When `coverageWarning === 'low-coverage'` (or summary text mentions coverage floor):

- State clearly that **conclusions are limited** by page count.
- Recommend **more crawl budget**, **deeper entry URLs**, or **authenticated** scanning if the product surface is behind login.
- Do **not** summarize as “high confidence” or “ready to ship” without qualifying coverage.

---

## Auth-required exits

When `gapAnalysis.mode === 'auth-required'` (or `coverageWarning === 'auth-required'`):

- The scan **did not** validate authenticated routes in that run.
- Next steps for humans/agents: use documented **form login**, **storage state** (CLI), or MCP `explore_auth` / `detect_auth` guidance—**OAuth** flows still require human consent; Qulib does not automate third-party IdP consent.

Do not invent gaps for pages that were never reached.

---

## Avoid overclaiming scan results

- Qulib checks **crawl reachability**, **axe** rules on visited pages, **links**, **console** signals, and **navigation** failures within harness limits—not every user journey, payment edge case, or backend contract.
- **Cost Intelligence** (when enabled) is about **LLM usage inside the gap-analysis harness**, not about your product’s cloud bill.
- Prefer language such as: “Within this scan’s reach, …” and cite **`status`**, **`mode`**, **`coverageWarning`**, and **`releaseConfidence`**.

For a **single machine-readable summary** with an explicit **`gate`** field, use [agent-summary-output.md](./agent-summary-output.md) (`toAgentSummary`, CLI `--agent-summary`, MCP `agentSummary: true`). For the default MCP envelope (top gaps, cost slice, next checks), use `summarizeAnalyzeResult` as described in the MCP README.

---

## Related docs

- [agent-summary-output.md](./agent-summary-output.md) — agent summary schema and surfaces  
- [orchestrator-integration.md](./orchestrator-integration.md) — external orchestrators, no coupling  
- [agent-classes-for-qulib.md](./agent-classes-for-qulib.md) — optional role taxonomy for humans/agents  
- [deterministic-opportunities.md](./deterministic-opportunities.md) — repeated reasoning → checks  
