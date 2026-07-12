/**
 * STRUCTURAL guard (round-6) — closes the "interpolation facade" class
 * rather than point-patching the next site a reviewer happens to find.
 *
 * Rounds 2-5 fixed this class of bug ONE SITE at a time: change/select,
 * keyDown, a printable-character keyDown, then a single-char "{" key-press.
 * Each round the reviewer found the SAME class at the NEXT untouched site
 * (round-6 found it at the 'type' action value — the COMMON path — and in
 * api-adapter.ts, the third adapter that round-5 never touched). Adding one
 * more targeted regression test per round does not end that pattern; a
 * NEW site added next month would sail through untested exactly like the
 * last five did.
 *
 * This file is the mechanical fix for the *pattern*, not the latest
 * instance: it source-scans the adapter files for the two shapes of
 * interpolation that have caused every round of this bug —
 *
 *   1. a Cypress `.type(${expr})` call whose `expr` does not route through
 *      `escapeCypressType(...)` or `toCypressTypeToken(...)` (the two
 *      sanctioned Cypress `.type()` value producers)
 *   2. a bare `` `// ...` `` comment template that interpolates a raw,
 *      free-text `scenario.description` / `scenario.id` /
 *      `scenario.targetPath` / `step.description` field without routing it
 *      through `sanitizeForComment(...)`
 *
 * and FAILS the moment either shape reappears anywhere in the scanned
 * files — including a site nobody has written yet. The two "prove the gate
 * has teeth" tests at the bottom feed each scanner a synthetic snippet that
 * reproduces the exact bug class and assert it is CAUGHT — a gate that
 * only ever runs green against already-fixed code is not verified (see
 * `feedback_gate_bypass_audit`: red-team a safety gate with a real payload
 * before trusting it).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADAPTERS_DIR = path.resolve(__dirname, '..');

function readAdapterSource(filename: string): string {
  return fs.readFileSync(path.join(ADAPTERS_DIR, filename), 'utf8');
}

// ---------------------------------------------------------------------------
// Scanner 1 — every Cypress `.type(${expr})` call must route through the
// escapeCypressType / toCypressTypeToken choke-point.
// ---------------------------------------------------------------------------

interface Offense {
  line: number;
  snippet: string;
}

function findUnescapedCypressTypeCalls(source: string): Offense[] {
  const offenders: Offense[] = [];
  // Matches `.type(${<expr>})` where <expr> has no literal `{`/`}` of its
  // own — true of every real call site in this codebase, which only ever
  // interpolates function-call expressions (JSON.stringify(...),
  // escapeCypressType(...), toCypressTypeToken(...), a bare variable) with
  // no object/brace literals inside the template hole.
  const re = /\.type\(\$\{([^}]*)\}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const expr = m[1] ?? '';
    const routedThroughChokePoint = expr.includes('escapeCypressType(') || expr.includes('toCypressTypeToken(');
    if (!routedThroughChokePoint) {
      offenders.push({ line: source.slice(0, m.index).split('\n').length, snippet: m[0] });
    }
  }
  return offenders;
}

// ---------------------------------------------------------------------------
// Scanner 2 — every `//` comment template that interpolates a raw,
// free-text scenario/step field must route it through sanitizeForComment.
// Scoped to the schema's actual free-text fields (z.string(), not
// z.enum(...)) — TestStep.description and NeutralScenario's
// description/id/targetPath. `step.action` is a closed zod enum (never
// carries a newline) and is deliberately NOT in this list.
// ---------------------------------------------------------------------------

const UNSAFE_FREE_TEXT_FIELDS = ['scenario\\.description', 'scenario\\.id', 'scenario\\.targetPath', 'step\\.description'];

function findUnsanitizedCommentInterpolations(source: string): Offense[] {
  const offenders: Offense[] = [];
  // Every backtick template literal in the file...
  const templateRe = /`([^`]*)`/g;
  let tm: RegExpExecArray | null;
  while ((tm = templateRe.exec(source))) {
    const content = tm[1] ?? '';
    // ...that we're being asked to render is a bare `//` LINE comment (as
    // opposed to a template that produces real code, e.g. `cy.get(${t})`,
    // which is a DISTINCT risk class already made safe by JSON.stringify —
    // see comment-safety.ts's own doc comment for why that split matters).
    if (!/^\s*\/\//.test(content)) continue;
    for (const field of UNSAFE_FREE_TEXT_FIELDS) {
      const fieldRe = new RegExp(`(?<!sanitizeForComment\\()\\b${field}\\b`, 'g');
      if (fieldRe.test(content)) {
        offenders.push({ line: source.slice(0, tm.index).split('\n').length, snippet: tm[0] });
      }
    }
  }
  return offenders;
}

function formatOffenders(offenders: Offense[], file: string): string {
  return offenders
    .map((o) => `  ${file}:${o.line}: ${o.snippet}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Real-file scans — the actual gate
// ---------------------------------------------------------------------------

const SCANNED_FILES = ['cypress-e2e-adapter.ts', 'playwright-adapter.ts', 'api-adapter.ts'];

for (const file of SCANNED_FILES) {
  test(`choke-point guard: ${file} has no .type() call that bypasses escapeCypressType/toCypressTypeToken`, () => {
    const source = readAdapterSource(file);
    const offenders = findUnescapedCypressTypeCalls(source);
    assert.equal(
      offenders.length,
      0,
      `${file} has .type() call(s) that do NOT route through escapeCypressType(...) or ` +
        `toCypressTypeToken(...) — this is the exact "raw {brace} into cy.type()" facade class ` +
        `(rounds 2-6). Offending line(s):\n${formatOffenders(offenders, file)}`
    );
  });

  test(`choke-point guard: ${file} has no // comment that interpolates a raw scenario/step field without sanitizeForComment`, () => {
    const source = readAdapterSource(file);
    const offenders = findUnsanitizedCommentInterpolations(source);
    assert.equal(
      offenders.length,
      0,
      `${file} has // comment line(s) that interpolate scenario.description / scenario.id / ` +
        `scenario.targetPath / step.description WITHOUT sanitizeForComment(...) — an embedded ` +
        `newline in that field silently terminates the comment and turns the rest of the line into ` +
        `live, uncommented code. Offending line(s):\n${formatOffenders(offenders, file)}`
    );
  });
}

// ---------------------------------------------------------------------------
// "Prove the gate has teeth" — feed each scanner a synthetic snippet that
// reproduces the exact bug class and assert it is CAUGHT. A guard that only
// ever runs against already-fixed source is unverified; these two tests
// fail LOUDLY if either scanner regresses to a no-op.
// ---------------------------------------------------------------------------

test('choke-point guard SELF-TEST: findUnescapedCypressTypeCalls catches a raw, unescaped .type(${step.value})', () => {
  const badSnippet = [
    'function renderStep(step) {',
    '  const t = JSON.stringify(step.target);',
    '  return `    cy.get(${t}).type(${JSON.stringify(step.value)});`;',
    '}',
  ].join('\n');
  const offenders = findUnescapedCypressTypeCalls(badSnippet);
  assert.equal(offenders.length, 1, 'the scanner must catch a .type() call with no escapeCypressType/toCypressTypeToken');
  assert.equal(offenders[0]?.line, 3);
});

test('choke-point guard SELF-TEST: findUnescapedCypressTypeCalls does NOT false-positive on a correctly-escaped call', () => {
  const goodSnippet = [
    'function renderStep(step) {',
    '  const t = JSON.stringify(step.target);',
    '  return `    cy.get(${t}).type(${JSON.stringify(escapeCypressType(step.value))});`;',
    '}',
  ].join('\n');
  assert.equal(findUnescapedCypressTypeCalls(goodSnippet).length, 0);
});

test('choke-point guard SELF-TEST: findUnsanitizedCommentInterpolations catches a raw // ${scenario.description}', () => {
  const badSnippet = [
    'const code = [',
    "  `// ${scenario.description}`,",
    "  `// qulib-generated — scenario: ${scenario.id}`,",
    '].join("\\n");',
  ].join('\n');
  const offenders = findUnsanitizedCommentInterpolations(badSnippet);
  assert.equal(offenders.length, 2, 'the scanner must catch BOTH unsanitized comment interpolations');
  assert.deepEqual(
    offenders.map((o) => o.line),
    [2, 3]
  );
});

test('choke-point guard SELF-TEST: findUnsanitizedCommentInterpolations does NOT false-positive on a sanitized comment or a JSON.stringify(...) code interpolation', () => {
  const goodSnippet = [
    'const code = [',
    '  `// ${sanitizeForComment(scenario.description)}`,',
    '  `it(${JSON.stringify(scenario.description)}, () => {`,', // JSON.stringify is a DISTINCT, already-safe risk class — must NOT be flagged
    '].join("\\n");',
  ].join('\n');
  assert.equal(findUnsanitizedCommentInterpolations(goodSnippet).length, 0);
});
