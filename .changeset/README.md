# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
Each pending release note lives here as its own Markdown file until it is consumed
by the automated "Version Packages" PR.

## Adding a changeset (do this in every PR that changes package code)

```bash
npx changeset
```

Pick the affected package(s), choose a bump level (`patch` / `minor` / `major`),
and write a one-line, human-readable summary. Commit the generated file in
`.changeset/` alongside your code change.

See [`docs/releasing.md`](../docs/releasing.md) for the full release flow,
including the one-time OIDC trusted-publisher setup.
