# Qulib

**Release confidence for deployed web apps — the one question: should we ship?**

Qulib fuses live-app quality evidence, automation maturity, and API coverage into a single scored verdict: **ship / caution / hold / block**. It prefers **honest uncertainty** over fake confidence: if auth blocks the crawl, coverage is thin, or data is incomplete, the report says so.

**Design line:** AI should explore unknown gaps; **deterministic checks** (crawl, axe, links, console) should scale. Cost Intelligence tracks LLM usage so repeated reasoning can graduate into checks you own in CI.

On npm: **`@qulib/core`** (engine + CLI `qulib`) and **`@qulib/mcp`** (MCP server for AI agents).

[![npm @qulib/core](https://img.shields.io/npm/v/@qulib/core?label=%40qulib%2Fcore)](https://www.npmjs.com/package/@qulib/core)
[![npm @qulib/mcp](https://img.shields.io/npm/v/@qulib/mcp?label=%40qulib%2Fmcp)](https://www.npmjs.com/package/@qulib/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/TapeshN/qulib/actions/workflows/ci.yml/badge.svg)](https://github.com/TapeshN/qulib/actions/workflows/ci.yml)

**Status:** [`@qulib/core`](https://www.npmjs.com/package/@qulib/core) and [`@qulib/mcp`](https://www.npmjs.com/package/@qulib/mcp) **v0.12.0** are published on npm — the release-confidence verdict now **gates CI** (`--fail-on` / `--min-score` exit codes), alongside the LLM-as-judge tools `qulib_score_bug_report` and `qulib_score_decisions`. See [`roadmap.json`](./roadmap.json) for shipped capabilities and the trust / release-confidence path to v1.0.0.

---

## What Qulib does

- Crawls deployed apps (anonymous or authenticated via Playwright)
- Runs **axe-core** accessibility checks (WCAG 2 A/AA)
- Detects broken links, console errors, navigation failures
- Computes **release confidence** (0–100) with a **coverage floor** when too few pages were scanned
- Emits **JSON** and **Markdown** reports (or **ephemeral** JSON on stdout)
- **Auth-aware:** optional `detect-auth`, `explore-auth`, form-login, and storage-state flows
- **Cost Intelligence** (optional block on gap analysis): token usage, budget warnings vs per-call output ceiling, prompt fingerprints, maturity hints, conversion recommendations

---

## Packages

| Package | Purpose |
|---------|---------|
| [`@qulib/core`](./packages/core) | Analyzer engine and CLI (`qulib`) |
| [`@qulib/mcp`](./packages/mcp) | MCP server exposing Qulib to AI clients |

---

## Open-core — what's MIT, what's hosted

Qulib is **genuinely open**, not a teaser. `@qulib/core` and `@qulib/mcp` are MIT-licensed, run **locally**, and need **no Qulib account** — bring your own `ANTHROPIC_API_KEY` for the optional LLM paths and every tool works. The verdict engine, the schemas, the deterministic collectors, the judge harness, and the MCP server are all here, complete, with **nothing gated behind a paywall and no crippled code paths**.

What is **not** in this repo, by design, is the part you can't meaningfully open-source: the **calibrated benchmark packs** (continuously-tuned weights and rubrics), the **cross-project signal** that sharpens the judges over time, and the **hosted service** (managed runs, history, team, CI-gate-as-a-service). The open tool ships an honest **baseline** rubric — useful standalone and clearly labelled as baseline; the hosted tier is the calibrated, networked upgrade. **We gate on data and service, never on crippled code.**

---

## Quick start (CLI)

**Release confidence — the flagship command:**

```bash
npx @qulib/core confidence --url https://example.com
# or equivalently: npx @qulib/core release-confidence --url https://example.com
```

Returns a verdict (`ship` / `caution` / `hold` / `block`) with a 0–100 score, top risks, and recommended next checks.

**Sample output:**

```json
{
  "verdict": "caution",
  "confidenceScore": 54,
  "level": 3,
  "label": "L3 — moderate confidence, known risks",
  "topRisks": [
    "Low crawl coverage (2 pages scanned)",
    "No CI integration detected"
  ],
  "recommendedNextChecks": [
    "Add a CI pipeline that runs qulib on each deploy",
    "Increase crawl depth or provide auth credentials"
  ],
  "honestyNotes": [
    "API coverage: not_applicable (no API endpoints found — excluded from score)"
  ]
}
```

Add `--repo` to also score test-automation maturity and API coverage:

```bash
npx @qulib/core confidence --url https://example.com --repo .
```

**Gate a release in CI** — turn the verdict into a pass/fail exit code:

```bash
# Block the deploy unless the verdict is better than `hold`, or score is ≥ 70.
npx @qulib/core confidence --url "$DEPLOY_URL" --repo . --fail-on hold --min-score 70
# exit 0 → ship;  exit 1 → gate failed (prints "GATE: FAIL — …").
```

- `--fail-on <verdict>` exits non-zero when the verdict is **at or worse than** the threshold (`caution` | `hold` | `block`).
- `--min-score <n>` exits non-zero when the 0–100 confidence score is below `n` (a `null` score — nothing evaluable — always fails).
- Combine with `--json` to capture the full report on stdout while the gate line goes to stderr. This is the "should we ship?" question wired straight into your pipeline.

**Analyze (full gap report):**

```bash
npx @qulib/core analyze --url https://example.com
```

**Scaffold a test suite:**

```bash
npx @qulib/core scaffold --url https://example.com --framework cypress-e2e
```

**Score automation maturity (repo only, no URL needed):**

```bash
npx @qulib/core score-automation --repo /path/to/repo
# or equivalently: npx @qulib/core automation-score --repo /path/to/repo
```

**Score pivotal-decision forks (LLM-judge tool — now in the CLI):**

```bash
npx @qulib/core score-decisions --forks agent-decisions.jsonl
# with a CI gate (exit non-zero when mean decision quality < 0.7):
npx @qulib/core score-decisions --forks agent-decisions.jsonl --min-quality 0.7
# enable LLM refinement (requires ANTHROPIC_API_KEY):
npx @qulib/core score-decisions --forks agent-decisions.jsonl --enable-llm-judge
# emit full JSON result to stdout (gate line goes to stderr):
npx @qulib/core score-decisions --forks agent-decisions.jsonl --json
```

The `--forks` file is a JSONL file, one `DecisionFork` object per line. Each fork requires:
`fork_id`, `fork_kind` (`gate_block_vs_pass` | `stop_vs_continue` | `escalate_vs_proceed`), `options`, `choice`, `constraint`, `settleable`, `source_event_id`, `ts`.

The `--min-quality <n>` gate (0..1) exits non-zero when `aggregate.meanDecisionQuality < n` and prints `[qulib] GATE: PASS|FAIL — <reason>`. In `--json` mode the gate line goes to stderr so stdout stays pure JSON.

**Score a learner bug report (LLM-judge tool — now in the CLI):**

```bash
npx @qulib/core score-bug-report --input bug-report.json
# emit full JSON result:
npx @qulib/core score-bug-report --input bug-report.json --json
```

The `--input` file is a JSON file with shape:

```json
{
  "report": {
    "title": "...",
    "description": "...",
    "steps": "...",
    "severity": "high"
  },
  "target": {
    "description": "...",
    "type": "validation",
    "severity": "high",
    "expectedBehavior": "..."
  }
}
```

`severity` must be one of `critical | high | medium | low`. Returns `matched`, `matchConfidence`, a 4-part rubric (`coverage / severity / repro / evidence`, each 0–25), and `feedback`. Falls back to deterministic scoring when `ANTHROPIC_API_KEY` is not set. Bad input prints a friendly one-line error — no raw stack.

From a clone (repo root):

```bash
npm run analyze -w @qulib/core -- --url https://example.com
```

**Smoke (no disk writes):**

```bash
npm run smoke
```

**Cost doctor** (after a normal analyze that wrote `output/report.json`):

```bash
npx @qulib/core cost doctor
```

---

## Quick start (MCP)

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

Ask your agent:

> Use Qulib to analyze https://example.com and tell me if it's ready to ship.

The agent will call **`qulib_score_confidence`** for the fused release verdict, or **`qulib_analyze_app`** for a detailed gap report. Default **`qulib_analyze_app`** responses are **summary-first** (top gaps, cost summary, next deterministic checks). Pass **`includeFullReport: true`** for the full `gapAnalysis` including all scenarios.

### MCP tool catalog

| Tool | What it tells you |
|------|-------------------|
| **`qulib_score_confidence`** | Fused **ship / caution / hold / block** verdict (0–100 score) from all evidence sources. Start here. |
| `qulib_analyze_app` | Live-app gaps — a11y, broken links, console errors, release confidence. |
| `qulib_score_automation` | Repo test-maturity from L1 (none) to L5 (advanced), across 6–7 scored dimensions. |
| `qulib_score_api` | API endpoint discovery + test coverage: are your routes exercised? |
| `qulib_scaffold_tests` | Ready-to-run Cypress spec + config, generated from a live crawl. |
| **`qulib_diff`** | Structured diff between two analyze outputs — added findings, resolved findings, severity changes, and a confidence delta. |
| **`qulib_detect_prompt_leakage`** | Scan a page surface for signals that AI system prompts or agent instructions are inadvertently exposed publicly. |
| **`qulib_score_bug_report`** | LLM-as-judge of a learner bug report against a planted-bug target — matched verdict, rubric (coverage/severity/repro/evidence), and feedback. Falls back to deterministic scoring without `ANTHROPIC_API_KEY`. |
| **`qulib_score_decisions`** | Pivotal-decision evaluation — scores senior-correctness at agent decision forks from a JSONL file. Deterministic by default; optional LLM refinement. |
| `qulib_explore_auth` | All sign-in paths (OAuth, SSO, forms, magic link) and what to collect before scanning. |
| `qulib_detect_auth` | Single-pass auth pattern guess with a recommendation. Lighter than `explore_auth`. |

Legacy names (`analyze_app`, `explore_auth`, `detect_auth`) are kept as aliases through v1.0.

---

## CI integration (GitHub Actions)

Gate your deploys on Qulib's **honest agent-summary verdict** (`pass` / `warn` / `fail`) with a drop-in action. There are two surfaces — pick whichever fits your CI:

### Option A — composite action (drop into an existing job)

```yaml
# .github/workflows/qa.yml
jobs:
  qa:
    runs-on: ubuntu-latest
    steps:
      - name: Qulib analyze gate
        uses: TapeshN/qulib/.github/actions/qulib-analyze@v1
        with:
          url: https://your-app.example.com
          fail-on: fail        # fail (default) | warn | never
          qulib-version: 0.10.0 # pin a version for reproducible CI
```

### Option B — reusable workflow (whole job in one line)

```yaml
# .github/workflows/qa.yml
jobs:
  qa:
    uses: TapeshN/qulib/.github/workflows/qulib-analyze.yml@v1
    with:
      url: https://your-app.example.com
      fail-on: warn
    # secrets:
    #   auth-storage-state: ${{ secrets.QULIB_STORAGE_STATE }}
```

### How the gate decides

The action runs `@qulib/core analyze --url <url> --agent-summary`, which emits the stable agent-summary JSON. The CLI itself **always exits 0** — the verdict lives in the `gate` field — so the action reads `gate` and turns it into a CI exit code:

| `gate` | `fail-on: fail` (default) | `fail-on: warn` | `fail-on: never` |
|---|---|---|---|
| `pass` | ✅ pass | ✅ pass | ✅ pass |
| `warn` | ✅ pass | ❌ **fail** | ✅ pass |
| `fail` | ❌ **fail** | ❌ **fail** | ✅ pass |

A `fail` gate means a **critical gap**, a **blocked scan**, **null/too-low confidence**, or an **auth-required surface** that was never exercised — Qulib never silently passes an unevaluated deployment.

Every run **uploads the agent-summary JSON as an artifact** (`qulib-agent-summary`) and writes a **job summary** table with the gate, release confidence, top risks, and honesty notes.

### Inputs (composite action)

| Input | Default | Description |
|---|---|---|
| `url` | *(required)* | Base URL of the deployed app to analyze. |
| `fail-on` | `fail` | Gate policy: `fail`, `warn`, or `never`. |
| `qulib-version` | `latest` | npm version/dist-tag of `@qulib/core` run via `npx`. Pin for reproducibility. |
| `repo` | `""` | Optional path to the app repo for repo-aware analysis. |
| `config` | `""` | Path to a qulib config file relative to the working dir. |
| `auth-storage-state` | `""` | Path to a Playwright storage-state JSON for authenticated scans (write a secret to a file first — never inline it). |
| `extra-args` | `""` | Extra raw flags appended to `qulib analyze` (advanced). |
| `node-version` | `20` | Node.js version to set up. |
| `install-browser` | `true` | Install Playwright Chromium (Qulib crawls with Playwright). |
| `output-path` | `qulib-agent-summary.json` | Where to write the raw agent-summary JSON. |

### Outputs (composite action)

| Output | Description |
|---|---|
| `gate` | The verdict: `pass` \| `warn` \| `fail`. |
| `release-confidence` | Release confidence `0–100`, or `n/a` when null. |
| `coverage-status` | Coverage status enum (`ok` \| `thin` \| `blocked-by-auth` \| …). |
| `blocked` | `true` if the gate violated the `fail-on` policy (the job was failed). |
| `summary-path` | Path to the written agent-summary JSON artifact. |

> The composite action lives at [`.github/actions/qulib-analyze`](./.github/actions/qulib-analyze) and the reusable workflow at [`.github/workflows/qulib-analyze.yml`](./.github/workflows/qulib-analyze.yml). Reference them at a stable tag (e.g. `@v1`) for reproducible CI.

---

## Release confidence (short)

- Score starts from **100** and is reduced by **high / medium / low** gaps (see [`gaps.ts`](./packages/core/src/tools/scoring/gaps.ts)).
- If **fewer than `minPagesForConfidence`** pages were scanned, confidence is **capped at 40** and a **`low-coverage`** warning is set—thin coverage must not read as "ready".
- **`auth-required`** early exit sets confidence **0** with no gap inventory: the deployment was not actually exercised.

Details: [packages/core/README.md](./packages/core/README.md).

---

## Confidence Layer

> **Qulib turns delivery signals into release confidence.** The one question: *"Given everything we know right now, should we ship this?"*

The Confidence Layer fuses qulib's own evidence collectors into a single scored verdict:

| Verdict | Meaning |
|---|---|
| **ship** | Confidence ≥ 80, no blockers, all required sources evaluated |
| **caution** | Confidence 30–79, or an unknown signal on a required source |
| **hold** | Confidence < 30 |
| **block** | A hard-blocking evidence item, or nothing evaluable |

**CLI:**
```bash
qulib confidence --url https://example.com [--repo /path/to/repo] [--json]
```

**MCP tool:** `qulib_score_confidence` — composes `qulib_analyze_app` / `qulib_score_automation` / `qulib_score_api` into one fused verdict.

### The 5 views (data model)

| View | Status | Notes |
|---|---|---|
| **Release Confidence** | **Shipped** | Fused score + verdict via `computeReleaseConfidence` / `qulib_score_confidence` |
| **Replay** | **Shipped** | Provenance trace — how each score was computed and by which tool (`buildReplay`) |
| **Delivery Traffic** | Planned | Time-series of verdicts per subject (`diffConfidence` helper exists; persistence planned for 1.0) |
| **Inbox** | Planned | Human-judgment queue for blockers and approvals (`deriveInbox` helper exists; workflow planned for 1.0) |
| **Audit Trail** | Planned | Tamper-evident ledger entry per verdict (`toAuditEntry` helper exists; sink planned for 1.0) |

The forward roadmap centers on **trust**: witnessed delivery state, durable provenance, and later **agent-action / skill gating** so orchestrators can safely act on ship verdicts. Details: [`roadmap.json`](./roadmap.json).

**Honesty over fake confidence:** sources that are `not_applicable`, `unknown`, or `null` are excluded from the denominator but reported in `contributions` and `honestyNotes`. An auth wall or empty corpus forces `verdict=block` — qulib never silently passes an unevaluated surface.

**Agent decisions are one evidence source.** The reserved `agent-evidence` kind in `EvidenceSourceKindSchema` lets external agentic decisions feed into the same aggregator in a future release without touching the math.

---

## Baseline and drift detection

Track quality trends across releases. Save a snapshot of any `qulib analyze` run, then compare a later run to detect new gaps, resolved gaps, and severity changes — per dimension.

### Save a baseline

```bash
# From a report.json written by `qulib analyze` (deterministic, no live crawl):
qulib baseline save --url https://example.com --from-report output/report.json

# With an optional human label:
qulib baseline save --url https://example.com --from-report output/report.json --label before-refactor

# Emit the saved snapshot as JSON:
qulib baseline save --url https://example.com --from-report output/report.json --json
```

Baselines are stored in `.qulib-baselines/` (local, gitignored). Pass `--dir <path>` to override.

### List saved baselines

```bash
qulib baseline list --url https://example.com
```

### Compare — detect drift

```bash
# Compare the two most-recent baselines for a URL:
qulib baseline compare --url https://example.com

# Compare two specific snapshots by id:
qulib baseline compare --from <prior-id> --to <current-id>

# Machine-readable output for CI:
qulib baseline compare --url https://example.com --json
```

The comparison report shows:

- **new gaps** — problems present now that weren't before
- **resolved gaps** — problems that have since been fixed
- **severity changes** — same gap, escalated or de-escalated severity
- **confidence delta** — the numeric drift between the two runs, with a direction word (`improved` / `regressed` / `unchanged`)

Each changed item carries its `path`, `category`, and `severity` so you know exactly which dimension regressed or improved — no guessing from an aggregate number.

### Typical CI workflow

```bash
# Step 1 — after a successful deploy, save a baseline:
qulib analyze --url https://staging.example.com
qulib baseline save --url https://staging.example.com --from-report output/report.json --label "v$(cat VERSION)"

# Step 2 — on the next deploy, compare:
qulib analyze --url https://staging.example.com
qulib baseline save --url https://staging.example.com --from-report output/report.json
qulib baseline compare --url https://staging.example.com --json
```

---

## Runnable examples

[`examples/confidence-from-report.ts`](./examples/confidence-from-report.ts) — shows how to call `computeReleaseConfidence()` from TypeScript against a saved report fixture. Run it with:

```bash
npx tsx examples/confidence-from-report.ts
```

A more complete dogfood example using real notquality.com signals is at [`packages/core/src/examples/notquality-dogfood/run.ts`](./packages/core/src/examples/notquality-dogfood/run.ts).

---

## Documentation

- [Core (CLI, API, Cost Intelligence)](./packages/core/README.md)
- [MCP server](./packages/mcp/README.md)
- [Public roadmap](./roadmap.json) — shipped tools and planned trust / release-confidence milestones
- [Source map](./docs/source-map.md) — new contributors: start here to navigate the codebase
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Manual testing checklist](./docs/manual-testing-checklist.md)
- [Recipe: Gate your release on qulib confidence in CI](./docs/recipes/ci-release-confidence.md) — copy-paste GitHub Actions workflow for a scored release gate

---

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## License

MIT — see [LICENSE](LICENSE)
