# qulib

An opinionated QA harness that analyzes deployed web apps and reports honest quality gaps. Built to answer one question: **is this app ready to ship?**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What qulib does

- Crawls deployed web apps (anonymous or authenticated)
- Runs real accessibility scans (axe-core, WCAG 2 A/AA)
- Detects broken links, console errors, navigation failures
- Computes a release confidence score with an explicit coverage floor
- Returns structured reports (JSON, Markdown) — or runs ephemeral with no disk writes
- Available as a CLI (`@qulib/core`) and an MCP server (`@qulib/mcp`)

## Packages

| Package | Purpose |
|---------|---------|
| [`@qulib/core`](./packages/core) | The analyzer engine and CLI |
| [`@qulib/mcp`](./packages/mcp) | MCP server exposing qulib to AI agents like Claude Code |

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

> "Use qulib to analyze https://example.com and tell me if it's ready to ship."

## Documentation

- [Core package (CLI & API)](./packages/core/README.md)
- [MCP server](./packages/mcp/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)

## License

MIT — see [LICENSE](LICENSE)
