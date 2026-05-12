# @qulib/mcp

**@qulib/mcp** is an MCP server that exposes Qulib so AI clients can analyze a deployed URL for release confidence, accessibility, broken links, console noise, and prioritized gaps (CLI entry `qulib-mcp`).

## What it does

Tools:

- **`analyze_app(url, auth?)`** — full quality scan (optional form-login auth).
- **`detect_auth(url, timeoutMs?)`** — detect whether the site uses form login, OAuth, magic link, etc., and get a plain-language recommendation (including when to use manual `qulib auth init` and storage state).

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
