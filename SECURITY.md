# Security Policy

## Reporting a vulnerability

If you discover a security issue in qulib, please report it privately rather than opening a public issue.

Email: tapeshnagarwal@gmail.com

Include:

- A description of the issue
- Steps to reproduce
- Affected version(s)
- Any suggested fix

We will acknowledge receipt within 72 hours and aim to publish a patched release within 14 days for valid reports.

## Scope

In-scope:

- Code in `packages/core/` and `packages/mcp/`
- The npm-published packages `@qulib/core` and `@qulib/mcp`

Out of scope:

- Issues caused by user misconfiguration (e.g., hardcoded credentials in `qulib.config.ts`)
- Third-party dependencies — please report those upstream

## Credential handling

qulib never logs, persists, or transmits authentication credentials beyond the running browser context. If you find a violation of this principle, it is a security bug — please report it.
