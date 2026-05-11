# @qulib/mcp

An MCP server that gives AI agents the ability to analyze deployed web apps for quality gaps.

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

Add to your MCP config:

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

## Install for Claude Desktop

Same config, in `claude_desktop_config.json`.

## Example usage

Ask Claude:

> "Use qulib to analyze https://example.com and tell me if it's ready to ship."

Claude will call `analyze_app({ url: "https://example.com" })` and reason about the result.

## Authenticated scanning

> "Use qulib to scan my staging app at https://staging.example.com. Log in as user@example.com with password Test123, the login form is at /login with selectors [data-testid='email'], [data-testid='password'], and [data-testid='submit']."

Claude will pass auth credentials to the tool, qulib will sign in, then scan.

## License

MIT
