# Agent classes for Qulib

Optional **taxonomy** for humans or external orchestrators working on the Qulib product. These are **not** runtime classes inside the Qulib npm packages; they describe **roles**, inputs/outputs, and handoffs so work stays scoped and honest to the product’s positioning.

**Orchestration** (who invokes whom, in what order) lives **outside** this repo—see [orchestrator-integration.md](./orchestrator-integration.md).

Notation: names like `Researcher<qulib>` mean “this role applied to the Qulib codebase/product.”

---

## `Researcher<qulib>`

| | |
|--|--|
| **Purpose** | Discover what Qulib should become next: UX of README/CLI/MCP, positioning, competitor landscape, misunderstanding risks around confidence scores. |
| **Inputs** | Public repo: README, docs, issue search, MCP README, sample outputs (redacted URLs if needed). |
| **Outputs** | **Research Findings Handoff** (structured notes, no code changes). |
| **Blocked** | Implementing features, editing production code “by the way,” claiming scan guarantees. |
| **Handoff** | Findings document → **`Supervisor<qulib>`**. |

---

## `Supervisor<qulib>`

| | |
|--|--|
| **Purpose** | Consolidate research into **initiative options**, impact/effort/risk, sequencing—**proposal packs** only. |
| **Inputs** | Research Findings Handoff; maintainer priorities. |
| **Outputs** | Proposal pack (e.g. Option A/B/C + recommendation). |
| **Blocked** | Approving or merging work; writing PRDs in final form (unless your process merges Supervisor + Planner). |
| **Handoff** | Proposal pack → **human decision** → **`Planner<qulib>`** when an initiative is approved. |

---

## `Planner<qulib>`

| | |
|--|--|
| **Purpose** | Turn an approved initiative into a **PRD**, work chunks, acceptance criteria, QA plan, Composer-ready tasks. |
| **Inputs** | Approved proposal; constraints (no schema break without migration, etc.). |
| **Outputs** | PRD doc(s), chunk files, AC, test plan. |
| **Blocked** | Large unreviewed code dumps; skipping honesty / coverage / auth semantics. |
| **Handoff** | PRD + chunks → **`Composer<qulib>`**; parallel **`Reporter<qulib:report-stream>`** for human-readable status if desired. |

---

## `Composer<qulib>`

| | |
|--|--|
| **Purpose** | Implement approved chunks: CLI, MCP, docs, report formats, tests, examples. |
| **Inputs** | Approved chunk specs; `COMPOSER_REFERENCE`-style internal notes if your org maintains them (external to Qulib or in `.cursor/` as you prefer). |
| **Outputs** | PR-ready code and doc updates. |
| **Blocked** | Changing **public report schema** without **migration notes**; publishing npm or bumping versions without maintainer approval; building from vague ideas; marketing language that **overclaims** scan completeness. |
| **Handoff** | Branch/PR → **`QA<qulib>`**. |

---

## `QA<qulib>`

| | |
|--|--|
| **Purpose** | Validate before merge/release: correctness, docs accuracy, honesty of user-facing language. |
| **Inputs** | PR diff; CLI/MCP examples; schema changelog if applicable. |
| **Outputs** | QA notes, pass/fail, required fixes. |
| **Checks** | Build/tests green; CLI smoke paths; MCP docs match tool payloads; schema changes documented; **low coverage** / **auth-required** never presented as “ready”; no overclaiming. |
| **Handoff** | QA sign-off → maintainer merge / release process. |

---

## `Accountant<qulib>`

| | |
|--|--|
| **Purpose** | Track **agent/orchestration cost** against shipped value (per PRD, chunk, feature class). Aligns with Qulib’s **Cost Intelligence** theme: prefer deterministic checks where LLM work repeats. |
| **Inputs** | Token/cost logs from your orchestrator; optional Qulib `costIntelligence` blocks from runs. |
| **Outputs** | Cost rollups, “determinize this next” candidates. |
| **Blocked** | Replacing product Cost Intelligence docs with private financial data in this repo. |
| **Handoff** | Metrics brief → **Supervisor** / **Planner** for prioritization. |

---

## `Reporter<qulib>`

| | |
|--|--|
| **Purpose** | Make streams of findings readable: executive summaries, initiative dashboards, cost vs time, model velocity. |
| **Instances (examples)** | `Reporter<qulib:cost-vs-time>`, `Reporter<qulib:model-velocity-vs-cost>`, `Reporter<qulib:workflow-efficiency>`, `Reporter<qulib:report-stream>` (aggregate research, QA, cost, proposals without noise). |
| **Inputs** | Artifacts from other roles. |
| **Outputs** | Digest docs or messages (format depends on orchestrator). |
| **Blocked** | Silent rewriting of technical facts; dropping honesty notes. |
| **Handoff** | Digests to humans or downstream automation. |

---

## Suggested workflow (external)

Research → Supervisor proposal → **Human chooses** → Planner (PRD + chunks) → Composer → QA → release.

---

## Related

- [agent-usage.md](./agent-usage.md)  
- [deterministic-opportunities.md](./deterministic-opportunities.md)  
- [prds/](./prds/)  
