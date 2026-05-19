# Qulib

An opinionated QA harness that analyzes deployed web apps and emits honest quality gap reports. Positioned as an AI-callable QA engineer — not just another browser automation wrapper. Built by Tapesh Nagarwal.

**Every agent session loads this file first. No exceptions.**

---

## System Architecture

```
@qulib/core          — CLI + programmatic API (the engine)
@qulib/mcp           — MCP server exposing core to AI agents
packages/core/src/
  phases/            — observe → think → act pipeline
  tools/auth/        — auth detection, exploration, login automation
  tools/scoring/     — automation maturity, gap engine, public surface
  llm/               — provider abstraction, cost intelligence, context builder
  schemas/           — Zod schemas (source of truth for all types)
  cli/               — CLI commands and auth login flow
  reporters/         — JSON + markdown output
  harness/           — state manager, decision logger, progress log
  telemetry/         — redacted event emission
packages/mcp/src/    — MCP tool wrappers over core
```

---

## Roadmap

The release plan lives in `roadmap.json` at the repo root. Any agent planning work reads it first.

**Current:** v0.5.2 on main, v0.5.1 on npm registry.

**Target:** v1.0.0 — full auth intelligence, composable audit tools, CI integration.

Before starting new feature work, read `roadmap.json` to understand where the feature fits in the release sequence and what its dependencies are.

---

## How to Use This

You talk to one agent. That agent auto-scales based on what you ask. Slash commands give you direct control over work-in-flight.

### Slash commands

| Command | What it does |
|---|---|
| `/status` | Dashboard — clocked-in time, all active initiatives, blockers, drift between state and git/GitHub |
| `/start "<thing>"` | Kick off a new initiative. Agent classifies (fix/feature/sweep), picks version, creates branch, starts work |
| `/scope <id> add\|remove\|retarget` | Change scope mid-flight, with impact analysis and subagent handling |
| `/stop <id>` | Cancel an initiative — closes PR, deletes branch, stashes WIP, updates roadmap |
| `/clock in\|out\|pause\|resume\|status` | Your ultimate control. Clock out stashes WIP and pauses every initiative. Clock in resumes. |

### Plain English (no command needed)

| You say | Agent does |
|---|---|
| "what's next?" | Reads roadmap.json + initiatives.json, recommends next task |
| "ship 0.7.0" | Plans the train, spawns parallel subagents if safe, handles release + publish prompt |
| "fix this bug" | Solo work — branch, fix, test, PR. Suggests a patch release after. |
| "find test sites" | Spawns research agent in background |
| "run QA sweep" | Spawns sweep agent, presents findings |
| "how's it going?" | Same as `/status` |

You never need to say "spawn 3 agents" or "use subagents." The agent reads the task shape and decides:

- **1 fix or small feature** → does it solo
- **2-3 sequential phases** (fix → release → publish) → does it solo, sequentially
- **2+ independent features** that touch different files → spawns parallel subagents
- **Research or QA sweep** → spawns in background while continuing other work
- **Supervised mode** → never spawns subagents (you want to approve each step)

Max 3 subagents at once. The orchestrator never delegates publishing or merging to main.

## Guardrails

These are hard rules. They apply at every autonomy level, to every agent and subagent, in every session. No exceptions. No "just this once."

### Before you write

- **Read before edit.** Never edit a file you haven't read in this session.
- **Branch before commit.** Run `git branch` — if it says `main`, stop and create a branch.
- **Build before commit.** `npm run build && npm test` must pass. If you skip this, the next agent inherits broken code.

### Things you never do

- **Never commit to main.** Always PR from a branch. The hooks will block you, but don't rely on hooks — follow the rule.
- **Never `git push --force` to main.** Force-push to feature branches is fine. Main is sacred.
- **Never publish from a non-main branch.** Checkout main, pull, verify, then publish.
- **Never publish MCP before core.** MCP depends on core. If core isn't on the registry, MCP installs will break for every consumer.
- **Never install packages without stating what and why.** No surprise dependencies.
- **Never remove or rename schema fields** without a semver-major plan. Schemas are additive only.
- **Never delete tests.** You can rewrite them, but removing test coverage requires an explanation.
- **Never fabricate test results.** If a test fails, report the failure. Do not say "all tests pass" without running them.

### When you're stuck

- **3 failed attempts → stop and report.** If you've tried the same fix 3 times and it's not working, tell the user what you tried and what failed. Don't keep looping.
- **Unclear scope → ask, don't guess.** If the user's request is ambiguous, ask one clarifying question. Don't build the wrong thing.
- **Merge conflict → stop and report.** Don't try to resolve merge conflicts silently. Show the conflict and let the user decide.

### Subagent limits

- **Max 3 concurrent subagents.** More than 3 creates merge chaos and tracking overhead.
- **Never delegate publish or merge to a subagent.** Those are user-facing decisions — the orchestrator handles them directly.
- **Never spawn subagents in supervised mode.** The user chose supervised because they want to approve each step. Subagents bypass that.
- **Every subagent gets a FORBID list.** Files it must not touch, actions it must not take. No open-ended subagent prompts.

### Data safety

- **Never commit `.env`, credentials, API keys, or storage-state files.** Check `git diff --cached` before every commit.
- **Never store real user data in the golden dataset.** Public login page URLs only. No credentials, no PII.
- **Never run qulib against authenticated pages** in the golden dataset. Login pages only — never past the auth wall.

---

## Work-in-Flight State

The agent maintains two state files that track everything in progress. The user gets a live dashboard by asking for status. State persists across Cursor sessions — close your laptop and tomorrow the agent knows exactly where you left off.

| File | Contains |
|---|---|
| `.cursor/state/initiatives.json` | Every active/paused/done initiative — phases, branches, PRs, metrics, blockers |
| `.cursor/state/sessions.json` | Clock-in/out log with active time |
| `.cursor/state/README.md` | Schema docs — read this before writing |

**State rules:**
- Every initiative starts via `/start` (or the agent invokes the same flow when the user says "let's build X")
- Every phase transition (queued → in_progress → done) updates `last_update_at`
- Every subagent dispatch increments `metrics.subagents_spawned`
- When in doubt about truth, **git and GitHub win**. The state file is best-effort tracking.
- The user can reconcile drift with `/status` — it surfaces but never auto-fixes

**What "consumed" means in practice:**
Token counts aren't available to rules. Instead, every initiative tracks proxies: subagents spawned, files changed, build/test runs, time elapsed, PRs created/merged. The `/status` dashboard reports these so you know which streams are heavy vs light.

---

## Agent Protocol

### Session start

Every agent — parent or subagent — runs this before touching code:

1. `git branch` + `git status` — know where you are
2. `grep '"version"' packages/core/package.json packages/mcp/package.json` — know the version
3. Read this file — know the rules
4. Read `.cursor/state/initiatives.json` — know what's in flight
5. Read `.cursor/state/sessions.json` — is the user clocked in?
6. If planning work: read `roadmap.json` — know what ships when

### Autonomy levels

Set by the user at session start. Default is **standard**.

| Level | Agent pauses at | Runs without asking |
|---|---|---|
| supervised | Every file edit, every commit, every PR | Nothing |
| **standard** | Build/test gate, PR creation, npm publish, merge to main | File edits, branch creation, git push |
| autonomous | Build/test gate only (hard stop) | Everything else |

**Hard stops at ALL levels — no exceptions:**
- `npm run build && npm test` must pass before every commit
- Never commit directly to main — always PR from a branch
- Never `git push --force` to main
- Never publish to npm without verifying versions match and build is green
- Core publishes before MCP — always

### Memory routing

| What it is | Where it goes |
|---|---|
| Workflow rule, agent behavior | This file (`CLAUDE.md`) |
| Release plan, feature scope | `roadmap.json` |
| File-specific coding pattern | `.cursor/rules/<name>.mdc` |
| One-off session context | Chat memory (do not persist) |

**Never write workflow rules to chat-only memory.** If it should survive the session, it goes in a file.

### Agent handoff

When one agent finishes a phase and the next phase depends on it:

1. State what was done: branch name, PR number, merge status
2. State what's next: which workflow, which files, what version
3. State blockers: "user must publish to npm before continuing"

When spawning subagents, include:
- Current branch and version
- Exact scope (files to read, changes to make)
- Exit criteria (what to verify before reporting done)
- Forbidden actions (what NOT to do)

---

## Git

- **Never push directly to main.** Land changes via PR from a branch.
- Branch naming: `fix/short-description`, `feature/short-description`, `chore/short-description` (kebab-case, no version in fix/feature names).
- Release branches: `chore/release-0.x.y` (semver without `v`).
- `fix/` — wrong behavior, regressions, detector gaps. `feature/` — new capability. When unsure, prefer `fix/`.
- Commit messages: `type: short description` (types: `feat`, `fix`, `chore`, `refactor`, `docs`).
- Run `git branch` and `git status` before writing code — never commit on main by accident.

### PR train protocol

When shipping multiple dependent changes:

```
main (v0.5.2)
  └── fix/thing           → PR, CI green, merge
        └── chore/release-0.5.3  → PR, CI green, merge, PUBLISH
              └── feature/next   → PR, CI green, merge
                    └── chore/release-0.6.0  → PR, CI green, merge, PUBLISH
```

Each branch is created from the **updated main** after the previous PR merges. Gate: `npm run build && npm test` green before each PR opens.

After every release PR merge, prompt the user:
```
Ready to publish. From repo root on main:
  npm ci && npm run build
  npm publish -w @qulib/core --access public
  npm publish -w @qulib/mcp --access public
Core first, then MCP. Let me know when done (or say "publish it" and I'll try).
```

---

## Code

- Read files before editing them.
- **ESM only** (`"type": "module"`). TypeScript imports use **`.js` extensions**.
- Do not install packages without stating what and why.
- Before commit: **`npm run build`** at repo root.
- Before PR: **`npm run test`** at repo root.
- Schemas in `packages/core/src/schemas/` are the source of truth. **Additive changes only** — `optional()`, new fields, new enum values. No removals or renames without semver-major.
- Do not add comments explaining what obvious code does.

### Release PRs

A release PR touches **exactly** these files and nothing else:
- `packages/core/package.json` — version bump
- `packages/mcp/package.json` — version bump + `@qulib/core` dep alignment
- `package-lock.json` — `npm install` to refresh
- `CHANGELOG.md` — new entry above previous version

### npm publish

Order: **core first, then MCP.** MCP depends on core — consumers can't install MCP if core isn't on the registry yet.

Pre-publish checklist:
1. On main, clean tree, `git pull`
2. Versions match across both packages
3. `npm ci && npm run build && npm test` — all pass
4. `npm publish -w @qulib/core --access public`
5. `npm publish -w @qulib/mcp --access public`
6. Verify: `npm view @qulib/core version && npm view @qulib/mcp version`

---

## Packages

- **`@qulib/mcp` depends on `@qulib/core`.** Shared logic lives in core, exposed through MCP. Never duplicate.
- Keep MCP's `@qulib/core` dependency version aligned with core's version for every release.

---

## Golden Dataset + QA Sweep

qulib tests itself. The `datasets/golden/` directory contains a curated set of public websites that exercise qulib's features.

**Research agent** (`agent-research.mdc`) discovers viable sites and adds them to `datasets/golden/manifest.json`. Each site is tagged with the features it exercises (form-login, oauth, click-reveal, SPA, etc.) and has expected outputs so regressions can be detected.

**QA sweep agent** (`agent-qa-sweep.mdc`) runs qulib against the golden dataset after every minor release. It compares actual output to expected, produces a findings report in `datasets/golden/sweeps/`, and recommends patch releases for regressions and crashes.

The sweep cycle:
```
minor release ships → QA sweep runs → findings report → triage
  → regressions + crashes → fix/ PR → patch release
  → discoveries → backlog for next minor
  → new edge cases → research agent finds more sites like it
```

The 1.0.0 gate requires the golden dataset to have 15+ sites across all coverage tags with zero regressions in the final sweep.

---

## Design Principle

The output must be honest. If Qulib has not collected enough data to assess a deployment, it must say so — not report 100% confidence. False confidence is the worst possible failure mode for a QA tool.
