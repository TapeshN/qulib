# Qulib

**Release confidence for deployed web apps — the one question: should we ship?**

Qulib fuses live-app quality evidence, automation maturity, and API coverage into a single scored verdict: **ship / caution / hold / block**. It prefers **honest uncertainty** over fake confidence: if auth blocks the crawl, coverage is thin, or data is incomplete, the report says so.

**Design line:** AI should explore unknown gaps; **deterministic checks** (crawl, axe, links, console) should scale. Cost Intelligence tracks LLM usage so repeated reasoning can graduate into checks you own in CI.

On npm: **`@qulib/core`** (engine + CLI `qulib`) and **`@qulib/mcp`** (MCP server for AI agents).

[![npm @qulib/core](https://img.shields.io/npm/v/@qulib/core?label=%40qulib%2Fcore)](https://www.npmjs.com/package/@qulib/core)
[![npm @qulib/mcp](https://img.shields.io/npm/v/@qulib/mcp?label=%40qulib%2Fmcp)](https://www.npmjs.com/package/@qulib/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

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

## Quick start (CLI)

**Release confidence — the flagship command:**

```bash
npx @qulib/core confidence --url https://example.com
# or equivalently: npx @qulib/core release-confidence --url https://example.com
```

Returns a verdict (`ship` / `caution` / `hold` / `block`) with a 0–100 score, top risks, and recommended next checks.

Add `--repo` to also score test-automation maturity and API coverage:

```bash
npx @qulib/core confidence --url https://example.com --repo .
```

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
          qulib-version: 0.9.0 # pin a version for reproducible CI
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
- If **fewer than `minPagesForConfidence`** pages were scanned, confidence is **capped at 40** and a **`low-coverage`** warning is set—thin coverage must not read as “ready”.
- **`auth-required`** early exit sets confidence **0** with no gap inventory: the deployment was not actually exercised.

Details: [packages/core/README.md](./packages/core/README.md).

---

## Confidence Layer (P3)

> **Qulib turns delivery signals into release confidence.** The one question: *”Given everything we know right now, should we ship this?”*

The Confidence Layer (`v1`, P3) fuses qulib's own evidence collectors into a single scored verdict:

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

1. **Release Confidence** — the fused score + verdict (available now; the `computeReleaseConfidence` output)
2. **Delivery Traffic** — time-series of verdicts per subject (schema + `diffConfidence` helper; persistence P4)
3. **Inbox** — human-judgment items: blockers, unknown signals, approvals needed (schema + `deriveInbox`; queue P4)
4. **Replay** — provenance trace: how each score was computed and by which tool (`buildReplay`)
5. **Audit Trail** — tamper-evident append-only ledger entry per verdict (`toAuditEntry`; sink P4)

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

## Documentation

- [Core (CLI, API, Cost Intelligence)](./packages/core/README.md)
- [MCP server](./packages/mcp/README.md)
- [Source map](./docs/source-map.md) — new contributors: start here to navigate the codebase
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Manual testing checklist](./docs/manual-testing-checklist.md)

---

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## License

MIT — see [LICENSE](LICENSE)
