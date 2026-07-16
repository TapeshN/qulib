# Publishing `@qulib/mcp` to the official MCP registry

> Operator runbook. This PR prepares the metadata (`mcpName` + `server.json`); the two
> publish steps below need credentials only the operator holds (npm token, GitHub
> device-auth), so they are **not** run by an agent. qulib npm publish is delegated per
> the release doctrine — this is that delegated release for `0.14.1`.

## What this PR already did (no action needed)
- Added `"mcpName": "io.github.tapeshn/qulib"` to `packages/mcp/package.json`.
- Bumped `@qulib/mcp` to `0.14.1` (metadata-only patch; `@qulib/core` unchanged).
- Added `packages/mcp/server.json` (schema `2025-12-11`). Field parity is enforced:
  `server.json.name` === `package.json.mcpName`, and
  `server.json.version` === `server.json.packages[0].version` === `package.json.version` === `0.14.1`,
  and `server.json.packages[0].identifier` === `@qulib/mcp`.

## Namespace decision — CONFIRM BEFORE PUBLISHING
The `mcpName` namespace `io.github.tapeshn/qulib` must match the GitHub account you
authenticate `mcp-publisher` with in Step 3. The registry normalizes the `io.github.<login>`
segment to **lowercase**, so `io.github.tapeshn` corresponds to GitHub login `TapeshN`.
If you publish under a different GitHub account, change `mcpName` (package.json) AND
`name` (server.json) to match its login (lowercased) first — they must stay identical.

## Step 1 — republish the npm package (operator; needs npm auth)
The registry pulls the package from npm and verifies the `mcpName` field is present, so
`0.14.1` must exist on npm before registry publish. From the repo root:
```bash
npm install
npm run build                       # builds packages/mcp/dist
cd packages/mcp
npm publish --access public         # publishes @qulib/mcp@0.14.1 (needs `npm login`)
```
Verify: `npm view @qulib/mcp version` → `0.14.1`, and
`npm view @qulib/mcp mcpName` → `io.github.tapeshn/qulib`.

## Step 2 — install the publisher CLI (one-time)
```bash
brew install mcp-publisher          # or grab the prebuilt binary from the registry repo
mcp-publisher --help
```

## Step 3 — authenticate (operator; GitHub device-auth)
```bash
cd packages/mcp
mcp-publisher login github          # opens a URL + shows a code to enter in the browser
```
The authenticated GitHub login must match the `io.github.<login>` namespace (see the
namespace note above). A mismatch fails with
"Your authentication method doesn't match your server's namespace format."

## Step 4 — publish to the registry
```bash
cd packages/mcp
mcp-publisher publish               # reads ./server.json
```

## After publish
- Confirm the listing resolves at the registry (search `io.github.tapeshn/qulib`).
- Tag the release: `git tag v0.14.1 && git push origin v0.14.1`.
- Update the qulib board (#3): move the registry issue to Done.
- Future releases: bump `version` in BOTH `package.json` and `server.json` together
  (the parity check above), republish to npm, then re-run `mcp-publisher publish`.
