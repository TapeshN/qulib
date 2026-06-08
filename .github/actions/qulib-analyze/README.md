# `qulib-analyze` composite action

Run [`@qulib/core`](https://www.npmjs.com/package/@qulib/core) `analyze` against a deployed URL in CI and **gate the build** on Qulib's honest agent-summary verdict (`pass` / `warn` / `fail`).

```yaml
- uses: TapeshN/qulib/.github/actions/qulib-analyze@v1
  with:
    url: https://your-app.example.com
    fail-on: fail   # fail (default) | warn | never
```

## Why this exists

`qulib analyze --agent-summary` prints a stable agent-summary JSON whose `gate` field is the verdict — but the CLI **always exits 0**, leaving the pass/fail decision to the consumer. This action makes that decision for you: it captures the JSON, maps `gate` to a CI exit code under your `fail-on` policy, writes a job summary, and uploads the JSON as an artifact.

| `gate` | `fail-on: fail` | `fail-on: warn` | `fail-on: never` |
|---|---|---|---|
| `pass` | pass | pass | pass |
| `warn` | pass | **fail** | pass |
| `fail` | **fail** | **fail** | pass |

A `fail` gate means a critical gap, a blocked scan, null/too-low confidence, or an auth-required surface that was never exercised.

## Inputs / outputs

See the [main README CI section](../../../README.md#ci-integration-github-actions) for the full input/output tables.

## Files

- [`action.yml`](./action.yml) — composite action definition (inputs, outputs, steps).
- [`gate.mjs`](./gate.mjs) — pure-stdlib Node script that reads the agent-summary JSON and exits per the `fail-on` policy. It is self-tested in CI by [`.github/workflows/qulib-action-selftest.yml`](../../workflows/qulib-action-selftest.yml).
