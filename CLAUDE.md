# Qulib

An opinionated QA harness that analyzes deployed web apps and emits honest quality gap reports. Positioned as an AI-callable QA engineer — not just another browser automation wrapper. Built by Tapesh Nagarwal.

---

## RULES — READ BEFORE TOUCHING ANYTHING

### Git

- Do **not** push directly to **`main`** on the remote. Land changes via **PR from a branch** (even when using an agent).
- Branch naming: `feature/short-description`, `fix/short-description`, `chore/short-description` (one kebab slug; **no version in the branch name**).
- **`fix/`** — wrong behavior, missing cases, regressions, or parity fixes (e.g. detector gaps, incorrect scoring). **`feature/`** — new user-facing capability or a meaningful new surface. When unsure for analyzer/auth/MCP behavior fixes, prefer **`fix/`**.
- Version drops (bump `package.json`, `package-lock.json`, `CHANGELOG.md`): use **`chore/release-0.x.y`** (semver **without** a `v` — matches existing PRs). Land product changes on **`fix/`** or **`feature/`** first when possible; keep release branches mostly version + changelog unless bundling is unavoidable.
- Run `git branch` (and `git status`) before writing code so you are not committing on `main` by accident.
- Commit messages: `type: short description` (types: `feat`, `fix`, `chore`, `refactor`, `docs`).
- User-facing releases: bump versions in `packages/*/package.json`, refresh `package-lock.json` with `npm install`, update **`CHANGELOG.md`**, then tag if you use tags (see existing entries for format).

### Code

- Read files before editing them.
- **ESM only** (`"type": "module"`). TypeScript sources import with **`.js` extensions** (NodeNext / bundler resolution).
- Do not install packages without explicitly stating what you are installing and why.
- Before commit: **`npm run build`** at repo root (matches CI `build` job).
- Before PR (or when changing analyzer/MCP behavior): **`npm run test`** at repo root. If you touch the `analyzeApp` pipeline deeply, also run **`npm run test:integration`** from repo root when reasonable.
- The schemas in `packages/core/src/schemas/` use Zod and are the source of truth. Prefer **additive** changes (`optional()`, new fields). Do not remove or rename fields without a **semver-major** plan and migration notes.
- Do not add comments explaining what obvious code does. Add comments only when the **why** is non-obvious. **Exception:** brief file-level notes for **package boundaries** (e.g. candidate extraction to `@qulib/analyzer`) where the *why* is architectural.

### Packages

- **`@qulib/mcp` depends on `@qulib/core`.** Put shared logic in **core**, then expose through MCP — do not duplicate the analyzer in MCP.
- Publishing: CI runs **`npm publish --dry-run`** per package; real publish is manual (`npm publish -w @qulib/core` then `@qulib/mcp`). Keep **`@qulib/mcp`’s `@qulib/core` dependency version** aligned with the published core version for that release.

### Design principle

The output must be honest. If Qulib has not collected enough data to assess a deployment, it must say so — not report 100% confidence. False confidence is the worst possible failure mode for a QA tool.
