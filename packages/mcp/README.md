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

## What it does

Tools:

- **`explore_auth(url, timeoutMs?)`** — list all sign-in paths (OAuth, unknown SSO heuristics, forms, magic link) and what the agent must collect before `analyze_app`. Prefer this on unfamiliar apps.
- **`analyze_app`** — quality scan (optional form-login or storage-state auth). **Default payload is summary-first:** `summary`, `topGaps`, `costIntelligenceSummary`, `nextDeterministicChecks`, small previews. Set **`includeFullReport: true`** for the full `analyzeApp` result (all scenarios). Optional harness overrides: **`llmMaxOutputTokensPerCall`**, **`llmTokenBudget`** (legacy), **`testGenerationLimit`**, **`enableLlmScenarios`** (default true when omitted).
- **`detect_auth(url, timeoutMs?)`** — single-pattern auth guess with a short recommendation (lighter than `explore_auth`).
- **`qulib_score_automation(repoPath, includeFullDimensions?)`** — score a local automation repo across six dimensions (test coverage breadth, framework adoption, test-id hygiene, CI integration, auth test coverage, component test ratio). Returns an overall 0–100 score, maturity level (L1–L5), and top recommendations. Each dimension carries an **`applicability`** field (`applicable` / `not_applicable` / `unknown`); the overall score normalizes across applicable dimensions only so absent capabilities never get silent partial credit. **`repoPath`** must be an absolute path on the MCP host. Pass **`includeFullDimensions: true`** for per-dimension evidence and reasons.

Returns from `analyze_app`:

- Release confidence score (0-100)
- Accessibility violations (axe-core, WCAG 2 A/AA)
- Broken links
- Console errors and coverage warnings
- Prioritized gaps with severity

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
| Size | Small: top gaps, cost summary, next checks | Full `gapAnalysis` with every scenario |
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
