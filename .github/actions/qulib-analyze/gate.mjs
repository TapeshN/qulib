#!/usr/bin/env node
/**
 * Gate decision for the qulib reusable analyze action.
 *
 * qulib's CLI (`@qulib/core analyze --agent-summary`) prints a stable
 * agent-summary JSON to stdout and *always exits 0* — the pass/warn/fail
 * verdict lives in the `gate` field, not the process exit code. CI gating is
 * therefore the consumer's job: this script reads that JSON and turns the
 * `gate` into a CI exit code, honouring a `fail-on` policy.
 *
 * Pure stdlib (no deps) so it runs from a checkout of the published action
 * without an install step.
 *
 * Usage:
 *   node gate.mjs <agent-summary.json> <fail-on>
 *     fail-on ∈ { fail (default), warn, never }
 *
 * Exit codes:
 *   0  gate satisfied the policy (build passes)
 *   1  gate violated the policy (build fails the qulib check)
 *   2  usage / parse error (the JSON was not a valid agent summary)
 *
 * Side effects (when running under GitHub Actions):
 *   - appends `gate`, `release_confidence`, `coverage_status` to $GITHUB_OUTPUT
 *   - appends a human-readable block to $GITHUB_STEP_SUMMARY
 */
import { readFileSync, appendFileSync } from 'node:fs';

const GATE_RANK = { pass: 0, warn: 1, fail: 2 };
const FAIL_ON_RANK = { never: 3, fail: 2, warn: 1 };

function fail(msg, code = 2) {
  process.stderr.write(`[qulib-gate] ${msg}\n`);
  process.exit(code);
}

const [, , jsonPath, failOnRaw] = process.argv;
if (!jsonPath) fail('missing path to agent-summary JSON');

const failOn = (failOnRaw || 'fail').trim().toLowerCase();
if (!(failOn in FAIL_ON_RANK)) {
  fail(`invalid fail-on "${failOn}" — expected one of: fail, warn, never`);
}

let summary;
try {
  summary = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (err) {
  fail(`could not read/parse agent-summary JSON at ${jsonPath}: ${err.message}`);
}

const gate = summary?.gate;
if (!(gate in GATE_RANK)) {
  fail(`agent-summary JSON has no valid "gate" field (got: ${JSON.stringify(gate)})`);
}

const confidence =
  summary.releaseConfidence === null || summary.releaseConfidence === undefined
    ? 'n/a'
    : String(summary.releaseConfidence);
const coverage = summary.coverageStatus ?? 'unknown';

// Decide: does this gate violate the fail-on policy?
// We fail the build when the observed gate is at or above the fail-on floor.
const blocked = GATE_RANK[gate] >= FAIL_ON_RANK[failOn];

// --- GitHub Actions outputs ---
const ghOutput = process.env.GITHUB_OUTPUT;
if (ghOutput) {
  appendFileSync(
    ghOutput,
    `gate=${gate}\n` +
      `release_confidence=${confidence}\n` +
      `coverage_status=${coverage}\n` +
      `blocked=${blocked}\n`
  );
}

// --- Job summary (Markdown) ---
const icon = { pass: '✅', warn: '⚠️', fail: '❌' }[gate];
const verdict = blocked ? '❌ **FAILED**' : '✅ **passed**';
const risks = Array.isArray(summary.topRisks) ? summary.topRisks : [];
const notes = Array.isArray(summary.honestyNotes) ? summary.honestyNotes : [];
const nextChecks = Array.isArray(summary.recommendedNextChecks)
  ? summary.recommendedNextChecks
  : [];

const lines = [];
lines.push('## qulib analyze gate');
lines.push('');
lines.push(`| Field | Value |`);
lines.push(`| --- | --- |`);
lines.push(`| Gate | ${icon} \`${gate}\` |`);
lines.push(`| Release confidence | \`${confidence}\` |`);
lines.push(`| Coverage | \`${coverage}\` |`);
lines.push(`| Policy (\`fail-on\`) | \`${failOn}\` |`);
lines.push(`| CI result | ${verdict} |`);
lines.push('');
if (risks.length) {
  lines.push('### Top risks');
  for (const r of risks) lines.push(`- ${r}`);
  lines.push('');
}
if (nextChecks.length) {
  lines.push('### Recommended next checks');
  for (const c of nextChecks) lines.push(`- ${c}`);
  lines.push('');
}
if (notes.length) {
  lines.push('### Honesty notes');
  for (const n of notes) lines.push(`- ${n}`);
  lines.push('');
}

const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary) {
  appendFileSync(stepSummary, lines.join('\n') + '\n');
}

// Always echo a one-line verdict to the log.
process.stdout.write(
  `[qulib-gate] gate=${gate} confidence=${confidence} coverage=${coverage} ` +
    `fail-on=${failOn} -> ${blocked ? 'FAIL' : 'pass'}\n`
);

process.exit(blocked ? 1 : 0);
