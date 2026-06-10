# @qulib/mcp

**@qulib/mcp** is an MCP server that exposes Qulib so AI clients can analyze a deployed URL for release confidence, accessibility, broken links, console noise, and prioritized gaps (CLI entry `qulib-mcp`).

## Setup

To enable LLM-powered scenario generation, add your Anthropic API key to the
`env` block in your MCP host config (Claude Desktop, Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "qulib": {
      "command": "npx",
      "args": ["@qulib/mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Without this key, qulib still runs but uses built-in template scenarios only.
Your key is never stored by qulib — it is read from your local config at runtime.

After updating this config, restart your MCP host (Claude Desktop / Claude Code / Cursor) so the new environment variables are picked up.

For verbose server-side stderr logs while troubleshooting host wiring, add:

```json
{
  "mcpServers": {
    "qulib": {
      "command": "npx",
      "args": ["@qulib/mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "QULIB_DEBUG": "1"
      }
    }
  }
}
```

## MCP tools

| Tool | Purpose |
|---|---|
| **`qulib_score_confidence`** | **Flagship.** Fuses evidence from `analyze_app`, `qulib_score_automation`, and `qulib_score_api` into one verdict: **ship / caution / hold / block** with a 0–100 confidence score, L1–L5 level, per-source contributions, honesty notes, and recommended next checks. Pass `url` and/or `repoPath`. |
| `analyze_app` | Live-app quality scan: release confidence (0–100), axe-core a11y, broken links, console errors, prioritized gaps. Default payload is summary-first; pass `includeFullReport: true` for all scenarios. Optional form-login / storage-state auth. |
| `qulib_score_automation` | Score a local repo's test-automation maturity across six dimensions (test coverage breadth, framework adoption, test-id hygiene, CI integration, auth test coverage, component test ratio) — plus a conditional 7th dimension (API coverage) when API endpoints are detected. Returns overall 0–100, level (L1–L5), and top recommendations. Each dimension carries `applicability`; score normalizes over applicable dimensions only. |
| `qulib_score_api` | Discover API endpoints in a repo and score their test coverage. Tier1=OpenAPI specs, Tier2=framework routes (Next.js, Express, Fastify, NestJS), Tier3=heuristic opt-in (tRPC). Returns an api-test-coverage dimension score with per-endpoint evidence. |
| `qulib_scaffold_tests` | Generate a ready-to-run test scaffold (Cypress or Playwright config + spec files) by crawling a deployed URL. Returns `generatedTests` and `projectConfig` so an agent can write files directly. Pass `recipes` (e.g. `["auth","a11y"]`) to append proven test patterns. |
| `explore_auth` | List all sign-in paths (OAuth, SSO, forms, magic link) and what the agent must collect before `analyze_app`. Prefer on unfamiliar apps. |
| `detect_auth` | Single-pass auth pattern guess with a recommendation. Lighter than `explore_auth`. |

**Example — flagship confidence call:**

```
qulib_score_confidence({ url: "https://example.com", repoPath: "/path/to/repo" })
```

Returns a verdict like:

```json
{
  "releaseConfidence": {
    "verdict": "caution",
    "confidenceScore": 54,
    "level": 3,
    "label": "Moderate confidence — proceed with known risks",
    "topRisks": ["Low crawl coverage (2 pages)", "No CI integration detected"],
    "recommendedNextChecks": ["Add CI pipeline", "Increase crawl depth"],
    "honestyNotes": ["API coverage: not_applicable (no API endpoints found — excluded from score)"]
  }
}
```

### `analyze_app` detail

- **Default payload:** `summary`, `topGaps`, `costIntelligenceSummary`, `nextDeterministicChecks`, small previews.
- **`includeFullReport: true`** — full `gapAnalysis` (all scenarios) and full `repoInventory`.
- **`agentSummary: true`** — compact gate-decision payload (`pass`/`warn`/`fail`) for CI orchestrators.
- Optional harness overrides: **`llmMaxOutputTokensPerCall`**, **`llmTokenBudget`** (legacy), **`testGenerationLimit`**, **`enableLlmScenarios`**.

Returns: release confidence score (0–100), accessibility violations (axe-core, WCAG 2 A/AA), broken links, console errors and coverage warnings, prioritized gaps with severity.

Supports optional form-login auth for scanning authenticated pages. If auth is required but not configured, the scan can stop early with `mode: auth-required` and guidance in `detectedAuth` / the decision log.

## Install for Claude Code

```bash
claude mcp add qulib --scope user npx -y @qulib/mcp
```

## Install for Claude Desktop / Cursor

Add this under `mcpServers` in `claude_desktop_config.json` (Claude Desktop) or your editor MCP settings (Cursor), adjusting paths if your client uses a different layout:

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

## One-time browser setup

qulib uses Playwright under the hood. After your MCP host first runs the qulib server, you'll need to install Chromium:

```bash
npx playwright install chromium
```

This is a one-time step. You'll only need to do it again if Playwright's browser version is bumped in a future qulib release.

If you skip this step, the first tool call will return a clear error telling you to run the command.

## Agentic auth exploration (`explore_auth`)

On unfamiliar apps, call **`explore_auth`** before **`analyze_app`**. The response lists each sign-in path (curated public OAuth/SSO, password forms, magic-link wording, and **heuristic** unknown buttons such as tenant-specific SSO). Each path includes **`requirements`** (e.g. storage-state vs credentials) and **`suggestedAgentBehavior`**.

When the model sees **`unrecognizedButtons`**, it can ask the user to register a label on the **MCP host** with the CLI:

`qulib auth providers add --id <kebab-id> --label "..." --pattern "..."` — patterns are saved under **`~/.qulib/providers.json`** and merged with the built-in list on the next `explore_auth` / `explore-auth`. Nothing is auto-written without an explicit `providers add`.

## Compact vs full `analyze_app` response

| | Default (`includeFullReport` omitted or false) | `includeFullReport: true` |
|--|--|--|
| Size | Small: top gaps, cost summary, next checks, `repoInventorySummary` (counts only) | Full `gapAnalysis` (all scenarios) and full `repoInventory` (test files, missing test IDs) |
| When to use | Routine agent turns, chat context limits | Deep dives, exporting full scenario JSON |

Example (full):

```json
{ "url": "https://example.com", "includeFullReport": true }
```

Example (tighter LLM envelope from MCP):

```json
{
  "url": "https://example.com",
  "llmMaxOutputTokensPerCall": 2048,
  "testGenerationLimit": 5,
  "enableLlmScenarios": true
}
```

## Example usage

Ask Claude:

> "Use Qulib to analyze https://example.com and tell me if it's ready to ship."

Claude will call `analyze_app({ url: "https://example.com" })` and reason about the result.

## Authenticated scanning

### Form login (automated)

> "Use Qulib to scan my staging app at https://staging.example.com. Log in as user@example.com with password Test123, the login form is at /login with selectors [data-testid='email'], [data-testid='password'], and [data-testid='submit']."

Claude will pass auth credentials to `analyze_app`; Qulib signs in, then scans.

### OAuth, SSO, magic link, or anything that cannot be scripted

OAuth and similar flows need human consent on the provider domain; Qulib does not automate them. Use the **CLI** (same machine as the browser):

```bash
qulib auth init --base-url https://app.example.com
```

Log in manually in the opened window, press ENTER in the terminal, then reuse the saved JSON with:

```bash
qulib analyze --url https://app.example.com --auth-storage-state ./qulib-storage-state.json
```

For MCP-driven workflows, run `auth init` on the machine where the MCP server runs, then pass `auth: { type: 'storage-state', path: '/absolute/path/to/qulib-storage-state.json' }` to `analyze_app`.

### Detecting auth before you configure anything

> "Use qulib's `detect_auth` tool on https://app.example.com — what auth pattern does it use and what should I do next?"

The tool returns `type`, `oauthButtons`, `recommendation`, and related fields so the agent can explain options honestly.

## Known limitations

Qulib discovers routes by following **same-site** links from pages it visits; it is not a full multi-site crawler (no sitemap-first mode, no unbounded domain expansion). Treat the route list as a sample of what was reachable within `maxPagesToScan` and `maxDepth`.

## Repository

Source and issues: **[github.com/TapeshN/qulib](https://github.com/TapeshN/qulib)**.

## License

MIT
