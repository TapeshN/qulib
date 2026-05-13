# Contributing to Qulib

Thanks for your interest in contributing. Qulib is a small project focused on honest quality reporting for deployed web apps.

## Quick local setup

```bash
git clone https://github.com/TapeshN/qulib.git
cd qulib
npm install
npm run build
```

Run the CLI against any URL to verify the build works (from `packages/core` so the default `qulib.config.ts` is found):

```bash
cd packages/core
node bin/qulib.js analyze --url https://example.com --ephemeral
```

You should see a JSON report on stdout with a `releaseConfidence` score.

## Before opening a PR

1. Open an issue first if the change is non-trivial — saves wasted effort if the direction needs discussion.
2. Read `CLAUDE.md` — it documents the project's rules, branch conventions, and design principles.
3. Run `npm run build` and confirm it passes before submitting.

## Branch and commit conventions

- Branch from `main`
- Branch naming: `feature/short-description`, `fix/short-description`, `chore/short-description`
- Commit messages: `type: short description` (types: `feat`, `fix`, `chore`, `refactor`, `docs`)

## Design principle

The output must be honest. If Qulib has not collected enough data to assess a deployment, it must say so — not report false confidence. PRs that hide failure modes will not be merged.

## Project structure

```
qulib/
├── packages/
│   ├── core/          # The analyzer engine + CLI (@qulib/core)
│   └── mcp/           # MCP server wrapper (@qulib/mcp)
├── docs/
│   └── source-map.md  # Where each kind of change lives — read this first
├── CLAUDE.md          # Project rules (read this before contributing)
└── README.md
```

New contributors should start with **[`docs/source-map.md`](./docs/source-map.md)** to understand the codebase layout — it maps each kind of change (CLI, crawling, auth, scoring, reports, MCP, …) to the folder where the work goes.

`@qulib/mcp` depends on `@qulib/core`. The MCP wraps the programmatic `analyzeApp()` function exported from core. Do not duplicate logic — extend core, then expose it through mcp.

## Good first contributions

If you want to help but aren't sure where to start:

- Improve crawl coverage (e.g. sitemap seeds, deeper authenticated expansion — see Known limitations in [packages/mcp/README.md](./packages/mcp/README.md))
- Add new gap detection rules (e.g., missing page titles, oversized images, missing meta tags)
- Add integration with another scanner (Lighthouse, Pa11y, axe DevTools Pro)
- Improve docs or add usage examples
- Fix typos

## Questions?

Open a [discussion](https://github.com/TapeshN/qulib/discussions) or use the issue tracker.

## License

By contributing, you agree your contributions are licensed under the MIT License.
