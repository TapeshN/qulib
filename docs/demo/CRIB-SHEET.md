# qulib Friday Demo — Crib Sheet
## "Should We Ship?" — 5-minute script

> Everything runs from `@qulib/core@0.9.0` and `@qulib/mcp@0.9.0` (published Thursday).
> MCP pre-registered in Claude Code before taking the stage.
> Fallback JSONs in this directory — narrate one if a live step fails twice, never debug on stage.

---

## Setup (before you walk on stage)

```
# Register qulib in Claude Code — one-liner, do this during rehearsal:
claude mcp add qulib -- npx -y @qulib/mcp

# Confirm it registered:
# Claude Code → /mcp → should list 7 qulib tools
```

Pre-stage checklist:
- `notquality` repo checked out at `~/demo/notquality`
- Claude Code open, qulib MCP registered (7 tools visible)
- Browser tab with Thursday's green Actions run open (NOT a live run)
- Fallback JSONs staged in a terminal: `cat ~/path/to/analyze-notquality.json`
- Hotspot active, terminal font size 20+

---

## [0:00 – 0:30] Hook — prove this is a real npm package

**Say:** "Every release meeting ends with one question — should we ship? qulib answers it with evidence, not vibes."

**Command:**
```
npx -y @qulib/core@0.9.0 --version
```

**Expected output:** `0.9.0`

**Measured local timing:** < 5s (npx cold-start; package is ~2MB)

**Failure drill:** If `npx` fails or hangs — say "let me show you what 0.9.0 outputs" and run:
```
cat docs/demo/analyze-notquality.json | jq '.status, .detectedAuth.type'
```

---

## [0:30 – 2:00] Evidence pass — analyze notquality.com

**Say:** "Real deployed app, auth walls, fifty intentional bugs. Watch what it finds — and what it tells you it *couldn't* verify."

**Command:**
```
npx -y @qulib/core@0.9.0 analyze --url https://notquality.com
```

**Expected output shape:**
```
status: partial
detectedAuth: { type: "oauth", provider: "github" }
gaps: [
  { severity: "critical", category: "coverage",
    reason: "Scan blocked by authentication…" },
  { severity: "medium", category: "auth-surface",
    reason: "OAuth-only entry with no password fallback…" }
]
decisionLog: [ "exploration-complete", "auth-required", … ]
```

**Key beat to land:** Point to the `status: partial` + the `auth-required` decision log entry.
"It doesn't pretend it scanned everything. False confidence is a QA tool's worst failure mode."

**Measured local timing:** ~22s (Playwright crawl + auth detection)

**Failure drill (if live command fails twice):** Open `docs/demo/analyze-notquality.json` and narrate:
- `status: partial` — partial scan
- `detectedAuth.type: oauth` — caught the GitHub OAuth wall
- Three gaps: `critical` auth-block, `medium` no-fallback-login, `low` no-recovery-link
- `releaseConfidence: 0` — honestly zero because the protected surface was not seen

---

## [2:00 – 3:30] The verdict — confidence command (flagship)

**Say:** "Now the actual product. One command fuses all the evidence — live-app quality, repo test maturity, API coverage — into a single falsifiable verdict."

**Command:**
```
cd ~/demo/notquality
npx -y @qulib/core@0.9.0 confidence --url https://notquality.com --repo .
```

**Expected output shape:**
```
[qulib] Release confidence for https://notquality.com
  verdict: block  —  L5 — advanced QA automation (score 92/100, level 5/5)
  blockers:
    • 'live-app-quality' is a hard blocker: Auth wall prevented scanning…
  contributions:
    - live-app-quality [unknown] [BLOCKER]: n/a  excluded
    - accessibility [unknown]: n/a  excluded
    - crawl-coverage [unknown]: n/a  excluded
    - test-automation [applicable]: 86/100  ew=50.0%
    - api-coverage [applicable]: 100/100  ew=50.0%
  honesty notes:
    • 'live-app-quality' source could not produce a reliable score: Auth wall…
```

**Key beat to land:**
"score 92/100 from the repo side — great test automation — but the verdict is `block` because
we cannot honestly score the live app without authenticated access. The tool blocks itself when
it would be lying. That's the product."

**Measured local timing:** ~18s (analyze + repo scan in parallel)

**Failure drill (if live command fails twice):** Open `docs/demo/confidence-notquality.json` and narrate:
- `verdict: block` with `confidenceScore: 92` — strong repo side, blocked by auth wall
- `contributions[test-automation].score: 86` — L5 automation maturity (advanced)
- `contributions[api-coverage].score: 100` — all 20 API endpoints traced
- `blockers[0]` — live-app-quality hard blocker: auth wall honesty note

---

## [3:30 – 4:30] The agent path — Claude Code MCP demo

**Say:** "Same verdict, agent path. Any MCP host gets all seven tools from one install."

**Action:** Switch to Claude Code. Type:
```
Should we ship notquality.com? Use qulib.
```

**Expected behavior:** Claude calls `qulib_score_confidence`, narrates the `block` verdict with
per-source evidence weights and honesty notes. No extra setup — the MCP registered with one line.

**MCP registration one-liner (slide or fallback):**
```
claude mcp add qulib -- npx -y @qulib/mcp
```

**Failure drill:** If Claude Code / MCP is unavailable — say "the MCP registration is one command"
and show the one-liner above. The JSON output from beat 3 already proves the same verdict.

---

## [4:30 – 5:00] The habit — GitHub Actions gate

**Say:** "The same verdict as a merge gate — six lines of YAML, pinned to v0.9.0."

**Action:** Switch to the pre-open browser tab showing Thursday's green `qulib-action selftest`
Actions run. Do NOT trigger a live CI run.

**YAML snippet to show (on screen or slide):**
```yaml
jobs:
  qa:
    uses: TapeshN/qulib/.github/workflows/qulib-analyze.yml@v0.9.0
    with:
      url: https://your-app.example.com
      fail-on: warn
```

**Close:** "Install one-liner: `npx -y @qulib/core@0.9.0 analyze --url <your-app>`. Ship evidence, not vibes."

---

## Fallback file map

| Beat | Fallback file | Key fields to narrate |
|------|--------------|----------------------|
| Evidence pass (analyze) | `docs/demo/analyze-notquality.json` | `status`, `detectedAuth.type`, `gaps[].severity`, `decisionLog` |
| Verdict (confidence) | `docs/demo/confidence-notquality.json` | `verdict`, `confidenceScore`, `blockers`, `contributions[].score` |
| Simple app baseline | `docs/demo/analyze-example.json` | `status: complete`, `releaseConfidence: 100` — contrast with partial |

---

## Timing summary (measured locally on current main / same code as 0.9.0)

> Note: `npx -y @qulib/core@0.9.0` requires Thursday's publish. Local runs below use the
> same built code via `node packages/core/bin/qulib.js` — identical behavior, same timings.

| Command | Measured wall-clock |
|---------|-------------------|
| `qulib analyze --url https://notquality.com` | 22s |
| `qulib analyze --url https://example.com` | 3s |
| `qulib confidence --url https://notquality.com --repo .` | 18s |

Total live demo commands: ~40s of active execution, well within the 5-minute window.

---

## Things that must be true on Friday morning

- [ ] `npm view @qulib/core version` returns `0.9.0` (Thursday publish done)
- [ ] `npm view @qulib/mcp version` returns `0.9.0`
- [ ] Claude Code MCP shows 7 qulib tools after `claude mcp add qulib -- npx -y @qulib/mcp`
- [ ] Browser tab has Thursday's green `qulib-action selftest` Actions run preloaded
- [ ] Fallback JSONs are on conference laptop (copy this `docs/demo/` directory)
- [ ] `~/demo/notquality` repo checkout exists on conference laptop
- [ ] Rehearsed twice end-to-end over hotspot; any step that fails twice is cut and replaced by its fallback JSON
