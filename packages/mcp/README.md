# @qulib/mcp

**@qulib/mcp** is an MCP server that exposes Qulib so AI clients can analyze a deployed URL for release confidence, accessibility, broken links, console noise, and prioritized gaps (CLI entry `qulib-mcp`).

## What it does

One tool: `analyze_app(url, auth?)`

Returns:

- Release confidence score (0-100)
- Accessibility violations (axe-core, WCAG 2 A/AA)
- Broken links
- Console errors and coverage warnings
- Prioritized gaps with severity

Supports optional form-login auth for scanning authenticated pages.

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

> "Use Qulib to scan my staging app at https://staging.example.com. Log in as user@example.com with password Test123, the login form is at /login with selectors [data-testid='email'], [data-testid='password'], and [data-testid='submit']."

Claude will pass auth credentials to the tool; Qulib signs in, then scans.

## Known limitations

In **v0.1.0**, link discovery and route expansion from the entry URL are **shallow** compared to full multi-site crawling. Broader multi-page coverage is planned for **0.1.1**; treat low page counts in the output as a signal that the scan may not represent the whole app yet.

## Repository

Source and issues: **[github.com/TapeshN/qulib](https://github.com/TapeshN/qulib)**.

## License

MIT
