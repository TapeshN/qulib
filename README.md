# Qulib

**Honest QA gap analysis for deployed web apps.**

Qulib is an opinionated harness that answers one question: **is this app ready to ship?** It prefers **honest uncertainty** over fake confidence: if auth blocks the crawl, coverage is thin, or data is incomplete, the report says so.

**Design line:** AI should explore unknown gaps; **deterministic checks** (crawl, axe, links, console) should scale. Cost Intelligence tracks LLM usage so repeated reasoning can graduate into checks you own in CI.

On npm: **`@qulib/core`** (engine + CLI `qulib`) and **`@qulib/mcp`** (MCP server for AI agents).

[![npm @qulib/core](https://img.shields.io/npm/v/@qulib/core?label=%40qulib%2Fcore)](https://www.npmjs.com/package/@qulib/core)
[![npm @qulib/mcp](https://img.shields.io/npm/v/@qulib/mcp?label=%40qulib%2Fmcp)](https://www.npmjs.com/package/@qulib/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What Qulib does

- Crawls deployed apps (anonymous or authenticated via Playwright)
- Runs **axe-core** accessibility checks (WCAG 2 A/AA)
- Detects broken links, console errors, navigation failures
- Computes **release confidence** (0–100) with a **coverage floor** when too few pages were scanned
- Emits **JSON** and **Markdown** reports (or **ephemeral** JSON on stdout)
- **Auth-aware:** optional `detect-auth`, `explore-auth`, form-login, and storage-state flows
- **Cost Intelligence** (optional block on gap analysis): token usage, budget warnings vs per-call output ceiling, prompt fingerprints, maturity hints, conversion recommendations

---

## Packages

| Package | Purpose |
|---------|---------|
| [`@qulib/core`](./packages/core) | Analyzer engine and CLI (`qulib`) |
| [`@qulib/mcp`](./packages/mcp) | MCP server exposing Qulib to AI clients |

---

## Quick start (CLI)

```bash
npx @qulib/core analyze --url https://example.com
```

From a clone (repo root):

```bash
npm run analyze -w @qulib/core -- --url https://example.com
```

Or `cd packages/core` and `npm run analyze -- --url https://example.com`.

**Smoke (no disk writes):**

```bash
npm run smoke
```

**Cost doctor** (after a normal analyze that wrote `output/report.json`):

```bash
cd packages/core && npx tsx src/cli/index.ts cost doctor
```

---

## Quick start (MCP)

```json
{
  "mcpServers": {
    "qulib": {
      "command": "npx",
      "args": ["-y", "@qulib/mcp"]
    }
  }
}
```

Ask your agent:

> Use Qulib to analyze https://example.com and tell me if it's ready to ship.

Default **`analyze_app`** responses are **summary-first** (top gaps, cost summary, next deterministic checks). Pass **`includeFullReport: true`** for the full `gapAnalysis` including all scenarios.

---

## Release confidence (short)

- Score starts from **100** and is reduced by **high / medium / low** gaps (see [`gap-engine`](./packages/core/src/tools/gap-engine.ts)).
- If **fewer than `minPagesForConfidence`** pages were scanned, confidence is **capped at 40** and a **`low-coverage`** warning is set—thin coverage must not read as “ready”.
- **`auth-required`** early exit sets confidence **0** with no gap inventory: the deployment was not actually exercised.

Details: [packages/core/README.md](./packages/core/README.md).

---

## Documentation

- [Core (CLI, API, Cost Intelligence)](./packages/core/README.md)
- [MCP server](./packages/mcp/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Manual testing checklist](./docs/manual-testing-checklist.md)

---

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## License

MIT — see [LICENSE](LICENSE)
