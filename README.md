# Qulib

**Qulib** is an opinionated QA harness that analyzes deployed web apps and reports honest quality gaps. Built to answer one question: **is this app ready to ship?**

On npm the packages stay lowercase: **`@qulib/core`** (library + CLI) and **`@qulib/mcp`** (MCP server). The CLI binary is **`qulib`**.

[![npm @qulib/core](https://img.shields.io/npm/v/@qulib/core?label=%40qulib%2Fcore)](https://www.npmjs.com/package/@qulib/core)
[![npm @qulib/mcp](https://img.shields.io/npm/v/@qulib/mcp?label=%40qulib%2Fmcp)](https://www.npmjs.com/package/@qulib/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What Qulib does

- Crawls deployed web apps (anonymous or authenticated)
- Runs real accessibility scans (axe-core, WCAG 2 A/AA)
- Detects broken links, console errors, navigation failures
- Computes a release confidence score with an explicit coverage floor
- Returns structured reports (JSON, Markdown) — or runs ephemeral with no disk writes
- Ships as **`@qulib/core`** (engine + CLI) and **`@qulib/mcp`** (AI-facing MCP server)

## Packages

| Package | Purpose |
|---------|---------|
| [`@qulib/core`](./packages/core) | The analyzer engine and CLI (`qulib`) |
| [`@qulib/mcp`](./packages/mcp) | MCP server exposing Qulib to AI agents (e.g. Claude Code) |

## Quick start (CLI)

```bash
npx @qulib/core analyze --url https://example.com
```

For local development from a clone, use `npm run analyze -w @qulib/core -- --url https://example.com` from the repo root, or `cd packages/core` and `npm run analyze -- --url https://example.com`.

## Quick start (MCP)

Add to your Claude Code or Claude Desktop MCP config:

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

Then ask Claude:

> "Use Qulib to analyze https://example.com and tell me if it's ready to ship."

## Documentation

- [Core package (CLI & API)](./packages/core/README.md)
- [MCP server](./packages/mcp/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)

## Contributing

We welcome issues and pull requests. Start with [CONTRIBUTING.md](./CONTRIBUTING.md) for a fast local setup and conventions. Optional release smoke steps (CLI, auth detection when present, MCP) live in the [manual testing checklist](./docs/manual-testing-checklist.md). Everyone participating in the project is expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](LICENSE)
