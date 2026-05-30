# Releasing qulib

Releases are automated with [Changesets](https://github.com/changesets/changesets)
and published to npm via **OIDC trusted publishing** — there is **no `NPM_TOKEN`
secret** anywhere in this repo. The release workflow's own GitHub OIDC identity is
what npm trusts to publish, and it also produces signed
[npm provenance](https://docs.npmjs.com/generating-provenance-statements) attestations.

`@qulib/core` and `@qulib/mcp` version together: `@qulib/mcp` depends on
`@qulib/core`, and `updateInternalDependencies: patch` in
[`.changeset/config.json`](../.changeset/config.json) bumps `mcp`'s dependency
range whenever `core` is released. Publishing happens in topological order
(`core` before `mcp`) automatically.

---

## Contributor flow — add a changeset to every PR that changes package code

When your PR changes anything under `packages/core/src`, `packages/mcp/src`,
their `bin/`, or a package's `package.json`, add a changeset:

```bash
npx changeset
```

You'll be prompted to:

1. select the affected package(s) — `@qulib/core`, `@qulib/mcp`, or both,
2. pick a bump level — `patch` (fixes), `minor` (features), `major` (breaking),
3. write a one-line summary. This line becomes the public CHANGELOG entry, so
   write it for a reader, not a reviewer.

Commit the generated `.changeset/*.md` file with your code. CI's **"Changeset
present"** job fails a PR that changes package source without one. Docs-only and
chore-only PRs (no package source touched) are exempt — the gate skips itself.

> Releasing a tooling/CI-only change that affects no published code? You don't
> need a changeset; the gate won't ask for one.

---

## The "Version Packages" PR mechanic

You never hand-edit versions or `CHANGELOG.md`. The flow is:

1. **You merge a feature PR to `main`** that carries one or more changesets.
2. The **Release workflow** ([`.github/workflows/release.yml`](../.github/workflows/release.yml))
   runs `changesets/action`, which opens (or updates) a PR titled
   **"chore: version packages"**. That PR consumes the pending changeset files,
   applies the version bumps to both packages, and promotes the CHANGELOG entries.
3. **Review and merge the Version Packages PR.** Merging it is another push to
   `main` — but now there are no pending changesets, so the same workflow runs the
   **publish** step instead: it publishes `@qulib/core` then `@qulib/mcp` to npm
   with provenance, and pushes the git tags.

So a release is two merges: your change, then the auto-generated version PR.

---

## ONE-TIME setup: configure the npm trusted publisher

The publish step **will fail by design** until a maintainer wires up npm's
trusted publisher for each package. This is the security gate — npm refuses to
accept an OIDC publish from an unrecognized workflow.

Do this **once per package**, for **both** `@qulib/core` and `@qulib/mcp`:

1. Sign in to [npmjs.com](https://www.npmjs.com/) as a maintainer of the package.
2. Go to the package page → **Settings** → **Trusted Publisher** (under "Publishing access").
3. Choose **GitHub Actions** and enter:
   - **Organization or user:** `TapeshN`
   - **Repository:** `qulib`
   - **Workflow filename:** `release.yml`
   - **Environment:** *(leave blank — the workflow uses no GitHub Environment)*
4. Save.

Repeat for the second package. Requirements:

- The package must already exist on npm (v0.6.0 was published manually, so both do).
- 2FA on the npm account should be set to **"Authorization only"** (not "Authorization
  and writes"), otherwise automation publishes are blocked.
- The runner uses **npm ≥ 11.5** (the workflow upgrades npm explicitly), which is
  the minimum that supports OIDC trusted publishing.

Once both packages have a trusted publisher pointing at this repo + workflow, the
next merge of a Version Packages PR publishes automatically — no token, no manual
`npm publish`.

---

## Local sanity checks

```bash
npx changeset status --since=origin/main   # what would the next release bump?
npm run build                              # both workspaces compile
npm test                                   # all unit/fixture tests
npm run lint:packages                      # publint + attw on both packages
node packages/mcp/scripts/smoke-tools.mjs  # MCP server advertises its tools
```

`npm run version` and `npm run release` exist for local/debug use but in normal
operation are invoked only by the release workflow — don't run `release` by hand.
