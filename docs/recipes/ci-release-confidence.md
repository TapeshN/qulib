# Gate your release on qulib confidence in CI

Stop shipping on vibes. Qulib's `confidence` command fuses live-app quality, test-automation maturity, and API coverage into a single scored verdict — `ship` / `caution` / `hold` / `block` — backed by a 0–100 score and an explicit risk list.

This recipe shows how to drop that verdict into a GitHub Actions release gate so your pipeline fails when the evidence says to wait.

---

## Why this is different from the `qulib-analyze` action

Qulib has two CI surfaces that answer different questions:

| Surface | Command | Verdict vocabulary | Best for |
|---------|---------|-------------------|----------|
| [`qulib-analyze` action](../../.github/actions/qulib-analyze/) | `qulib analyze --agent-summary` | `pass` / `warn` / `fail` | Coarse deploy gate: did the crawl find critical gaps? |
| **This recipe** | `qulib confidence --json` | `ship` / `caution` / `hold` / `block` (0–100 score) | Scored release decision: fuse all signals, apply a numeric threshold |

The analyze action is a boolean gate. The confidence command is a scored verdict — it combines multiple evidence dimensions, weights them, and produces a numeric confidence score you can threshold however your team needs.

Use the analyze action to block obviously broken deploys. Use the confidence recipe for a scored release decision (staging→production promotion, release candidate sign-off, etc.).

---

## Prerequisites

- Node.js 20+ in CI
- A deployed URL reachable from the GitHub Actions runner
- `@qulib/core` (installed via `npx` — no pre-install step needed)
- Playwright Chromium — qulib crawls with Playwright; the workflow below installs it automatically (~2–3 minutes added to your job)

---

## The complete workflow

Copy this into `.github/workflows/release-gate.yml` and set the `APP_URL` variable at the top:

```yaml
name: Release confidence gate

on:
  workflow_dispatch:
  push:
    branches: [main]

env:
  APP_URL: https://your-app.example.com   # <- change this
  QULIB_VERSION: 0.10.0                   # pin for reproducible CI
  SCORE_THRESHOLD: 70                     # fail if score < this (0–100)
  FAIL_ON_CAUTION: false                  # set to true for a stricter gate

jobs:
  release-gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Playwright Chromium
        run: npx --yes playwright@latest install --with-deps chromium

      - name: Run qulib confidence
        run: |
          npx --yes @qulib/core@${{ env.QULIB_VERSION }} confidence \
            --url "${{ env.APP_URL }}" \
            --repo . \
            --json > qulib-confidence.json
        continue-on-error: true  # CLI always exits 0; gate reads the JSON below

      - name: Evaluate verdict
        id: gate
        run: |
          node - <<'EOF'
          const fs = require('fs');
          const result = JSON.parse(fs.readFileSync('qulib-confidence.json', 'utf8'));

          const verdict = result.verdict;
          const score   = result.confidenceScore;
          const risks   = (result.topRisks || []).slice(0, 5).join('\n  ');
          const blockers = (result.blockers || []).join('\n  ');

          const THRESHOLD      = parseInt(process.env.SCORE_THRESHOLD || '70', 10);
          const FAIL_ON_CAUTION = process.env.FAIL_ON_CAUTION === 'true';

          console.log(`verdict:          ${verdict}`);
          console.log(`confidence score: ${score ?? 'null (nothing evaluable)'}`);
          if (risks)    console.log(`top risks:\n  ${risks}`);
          if (blockers) console.log(`blockers:\n  ${blockers}`);

          // Write outputs for downstream steps.
          const out = process.env.GITHUB_OUTPUT || '/dev/null';
          fs.appendFileSync(out, `verdict=${verdict}\n`);
          fs.appendFileSync(out, `score=${score ?? 'null'}\n`);

          // Gate logic — in order of severity:
          if (verdict === 'block') {
            console.error(`\nGATE FAILED: verdict=block — a hard-blocking signal was detected.`);
            if (blockers) console.error(`Blockers:\n  ${blockers}`);
            process.exit(1);
          }
          if (verdict === 'hold') {
            console.error(`\nGATE FAILED: verdict=hold — confidence ${score}/100 is below the hold floor (30).`);
            process.exit(1);
          }
          if (score !== null && score < THRESHOLD) {
            console.error(`\nGATE FAILED: confidence score ${score}/100 is below your threshold (${THRESHOLD}).`);
            process.exit(1);
          }
          if (FAIL_ON_CAUTION && verdict === 'caution') {
            console.error(`\nGATE FAILED: verdict=caution and FAIL_ON_CAUTION=true.`);
            process.exit(1);
          }

          console.log(`\nGATE PASSED: verdict=${verdict}, score=${score}/100`);
          EOF
        env:
          SCORE_THRESHOLD: ${{ env.SCORE_THRESHOLD }}
          FAIL_ON_CAUTION: ${{ env.FAIL_ON_CAUTION }}

      - name: Write job summary
        if: always()
        run: |
          node - <<'EOF'
          const fs = require('fs');
          const r = JSON.parse(fs.readFileSync('qulib-confidence.json', 'utf8'));
          const verdict = r.verdict;
          const score   = r.confidenceScore ?? 'n/a';
          const icon    = { ship: '✅', caution: '⚠️', hold: '🔶', block: '❌' }[verdict] || '❓';
          const risks   = (r.topRisks || []).map(x => `- ${x}`).join('\n') || '_none_';
          const notes   = (r.honestyNotes || []).map(x => `- ${x}`).join('\n') || '_none_';

          const md = [
            '## qulib release confidence',
            `| | |`,
            `|---|---|`,
            `| Verdict | ${icon} **${verdict}** |`,
            `| Confidence score | ${score}/100 |`,
            `| Threshold | ${process.env.SCORE_THRESHOLD}/100 |`,
            '',
            '### Top risks',
            risks,
            '',
            '### Honesty notes',
            notes,
          ].join('\n');

          fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
          EOF
        env:
          SCORE_THRESHOLD: ${{ env.SCORE_THRESHOLD }}

      - name: Upload confidence report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qulib-confidence
          path: qulib-confidence.json
          retention-days: 30
```

---

## Why the gate script is required

The `qulib confidence --json` command always exits 0, regardless of verdict. The verdict and score live in the JSON output — the CLI never fails the process. This is intentional: the CLI's job is to report honestly; the job of failing CI belongs to your gate policy.

The "Evaluate verdict" step above reads the JSON and applies your policy:

1. `block` → always fails (a hard-blocking signal was detected — a failed crawl, auth wall, or explicit blocker item).
2. `hold` → always fails (confidence is below the absolute floor of 30).
3. Score below your `SCORE_THRESHOLD` → fails (configurable; 70 is a sensible default).
4. `caution` with `FAIL_ON_CAUTION=true` → fails (opt-in stricter gate).
5. Everything else → passes.

---

## The verdict ladder

| Verdict | Score range | What it means | Default CI outcome |
|---------|------------|---------------|-------------------|
| `ship` | ≥ 80 | Strong confidence, no blockers, all required sources evaluated | PASS |
| `caution` | 30–79 | Known risks or an unknown signal on a required source | PASS (default) |
| `hold` | < 30 | Confidence is too low to make a release decision | FAIL |
| `block` | any | A hard-blocking item was detected | FAIL |

`block` is not about the score — it fires when qulib finds something that makes the number irrelevant: a crawl blocked by auth (`auth-required`), an explicit blocker evidence item, or no evaluable evidence at all. When the crawl never ran, a high score would be a lie; qulib refuses to produce one.

---

## Tuning the gate

### Change the threshold

Set `SCORE_THRESHOLD` in the `env` block. 70 is a reasonable starting point; teams with thin automation coverage often start at 50 and raise it as their test suite matures.

### Handle `caution` differently

`caution` (score 30–79) means "we have concerns but not a hard block." The default policy passes it so you can ship with a documented risk. Set `FAIL_ON_CAUTION: true` to treat any `caution` verdict as a blocker — useful for production promotion gates where you require high confidence.

### Authenticated scans

If your staging environment requires authentication, qulib can use a Playwright storage-state file. Write the secret to a file (never inline it) and pass `--storage-state`:

```yaml
- name: Write auth storage state
  run: echo '${{ secrets.QULIB_STORAGE_STATE }}' > /tmp/qulib-auth.json

- name: Run qulib confidence (authenticated)
  run: |
    npx --yes @qulib/core@${{ env.QULIB_VERSION }} confidence \
      --url "${{ env.APP_URL }}" \
      --repo . \
      --storage-state /tmp/qulib-auth.json \
      --json > qulib-confidence.json
  continue-on-error: true
```

Never write secrets directly into the workflow YAML.

### Repo-only gate (no live URL)

If you want to gate on automation maturity and API coverage without a live crawl, omit `--url`:

```yaml
run: |
  npx --yes @qulib/core@${{ env.QULIB_VERSION }} confidence \
    --repo . \
    --json > qulib-confidence.json
```

The verdict will reflect test-automation maturity and API surface coverage only. The Playwright install step is still harmless but can be skipped.

---

## Comparison: this recipe vs `qulib-analyze` action

| | `qulib-analyze` action | This recipe (`qulib confidence`) |
|---|---|---|
| Command | `qulib analyze --agent-summary` | `qulib confidence --json` |
| Verdict vocabulary | `pass` / `warn` / `fail` | `ship` / `caution` / `hold` / `block` |
| Score | release confidence 0–100 (in output) | 0–100 (explicit, gates on it) |
| Gate mechanism | `gate` field in JSON → action exit code | explicit Node.js script you own |
| Evidence sources | live-app crawl only | crawl + automation maturity + API coverage |
| Best for | coarse gate: "is this obviously broken?" | scored release decision: "are we confident enough to ship?" |
| Setup | drop-in composite action | copy-paste workflow |

Both surfaces are complementary. Many teams run both: the analyze action on every PR (fast coarse gate) and the confidence recipe on release branches (deeper scored verdict before staging→production promotion).

---

## Further reading

- [CI integration — analyze action](../../README.md#ci-integration-github-actions) — the existing coarse gate
- [Orchestrator integration](../orchestrator-integration.md) — feeding qulib verdicts into an AI agent loop
- [Release confidence — scoring details](../../README.md#confidence-layer-p3) — how the score is computed and what each verdict means
