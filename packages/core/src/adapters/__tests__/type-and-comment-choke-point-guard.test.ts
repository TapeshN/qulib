/**
 * STRUCTURAL guard (round-6, made field-NAME-agnostic in round-7) — closes
 * the "interpolation facade" class rather than point-patching the next site
 * a reviewer happens to find.
 *
 * ROUND-8 STATUS: this is a SOURCE-TEXT scanner — it only inspects a
 * `${...}` hole when it sits inside a single backtick template literal
 * whose own content starts with `//`. That is still a SHAPE assumption
 * about how the vulnerable code is written, and round-8 found the predicted
 * gap: a comment built by `+`-concatenating a `//`-prefixed literal to a
 * SECOND literal that does not itself start with `//` is invisible to this
 * scanner, even though the two pieces become the same logical comment line
 * at runtime. `../__tests__/behavioral-injection-guard.test.ts` closes that
 * gap with an OUTPUT-based check (parses the real generated file with the
 * TypeScript compiler) and is now the AUTHORITATIVE gate for this injection
 * class. This file is KEPT as a fast, cheap lint that still fails fast on
 * every shape it CAN see — it is not redundant, just no longer sufficient
 * on its own.
 *
 * Rounds 2-5 fixed this class of bug ONE SITE at a time: change/select,
 * keyDown, a printable-character keyDown, then a single-char "{" key-press.
 * Round-6 tried to close the class STRUCTURALLY with a source-scanning
 * guard — but its comment-interpolation scanner (`findUnsanitizedComment
 * Interpolations`) enumerated a fixed list of KNOWN field names
 * (`scenario.description`, `scenario.id`, `scenario.targetPath`,
 * `step.description`). That is still whack-a-mole wearing a structural
 * costume: `renderEndpointTest`/`scaffoldApiTests` in api-adapter.ts
 * interpolate a DIFFERENT set of raw fields — `ep.summary` (free text lifted
 * straight out of a caller-supplied OpenAPI spec), `ep.sourceFile`,
 * `ep.sourceTier`, `ep.confidence`, `apiSurface.repoPath` — into bare `//`
 * comments with NO sanitizeForComment, at a site round-5/6 never touched.
 * `ep.summary` was not on the guard's list, so it sailed through BOTH the
 * fix and the guard (round-7, FINDING 1).
 *
 * ROUND-7 FIX: stop enumerating field NAMES; match the SHAPE instead. The
 * comment scanner below (`findUnsanitizedCommentInterpolations`) now fails
 * on ANY `${...}` interpolation inside a bare `//`-comment template line
 * that is not itself a call to `sanitizeForComment(...)` — regardless of
 * what the interpolated expression is named. A future field on
 * NeutralScenario, TestStep, DiscoveredEndpoint, ApiSurface, or a type this
 * guard has never heard of, added at a site nobody has written yet, is
 * caught automatically — the guard never looks at the name, only at
 * whether the hole is routed through the one sanctioned choke-point. A
 * tiny, explicit, documented allowlist covers the two provably-safe
 * non-string shapes that actually appear in this codebase and can NEVER
 * carry a line terminator (a bare numeric literal, a `.length` property
 * access) — see `PROVABLY_SAFE_EXPRESSION` below. Growing that allowlist
 * defeats the point of a shape-based guard (see `feedback_safety_gate_
 * false_positive_tradeoff`: a safety gate should over-block, not
 * accumulate exceptions), so any addition to it must be provably incapable
 * of carrying a line terminator, not merely "safe in practice today."
 *
 * The `.type()` scanner (`findUnescapedCypressTypeCalls`) was already
 * shape-based in round-6 — it checks whether the interpolated expression
 * calls `escapeCypressType`/`toCypressTypeToken`, never a field name — so
 * it needed no name-list removal. It IS rewritten here to use a
 * brace-depth-aware expression scan instead of a `[^}]*` regex, so it
 * doesn't mis-parse an interpolated expression that itself contains a
 * brace (e.g. an object literal or a nested template).
 *
 * The "prove the gate has teeth" tests at the bottom feed each scanner a
 * synthetic snippet that reproduces the exact bug class and assert it is
 * CAUGHT — a gate that only ever runs green against already-fixed code is
 * not verified (see `feedback_gate_bypass_audit`: red-team a safety gate
 * with a real payload before trusting it). One of them uses a field name
 * that has NEVER appeared anywhere in this codebase or in any prior round's
 * fix, to prove the guard catches an unknown shape, not a remembered name.
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

interface Offense {
  line: number;
  snippet: string;
}

function formatOffenders(offenders: Offense[], file: string): string {
  return offenders
    .map((o) => `  ${file}:${o.line}: ${o.snippet}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Shared tokenizer — walks the TypeScript SOURCE (not the generated output)
// char-by-char, skipping over `//` line comments and `'...'`/`"..."` string
// literals in the SOURCE, and extracting every backtick template literal it
// finds along with each `${...}` expression inside it. Expression bounds are
// found by brace-DEPTH counting rather than a `[^}]*`/`[^`]*` regex, so a
// `${...}` hole that itself contains a `{`/`}` (an object literal, a nested
// template, a ternary with block bodies) is still parsed correctly instead
// of the scan stopping at the first inner `}`.
// ---------------------------------------------------------------------------

interface TemplateLiteral {
  /** 1-indexed line the opening backtick starts on. */
  line: number;
  /** Reconstructed literal content (backticks stripped, `${expr}` kept literally, for the `^\s*\/\// test). */
  content: string;
  /** Every interpolated expression's raw text, in order. */
  expressions: string[];
}

function extractTemplateLiterals(source: string): TemplateLiteral[] {
  const literals: TemplateLiteral[] = [];
  const n = source.length;
  let i = 0;

  const lineAt = (index: number): number => source.slice(0, index).split('\n').length;

  while (i < n) {
    const ch = source[i];

    // Skip a `//` line comment in the SOURCE file itself (not a generated
    // `//` inside a backtick template — those are handled below).
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }

    // Skip a `/* ... */` block comment in the SOURCE file.
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }

    // Skip a single- or double-quoted string literal in the SOURCE file.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    if (ch === '`') {
      const startLine = lineAt(i);
      i++;
      let content = '';
      const expressions: string[] = [];
      while (i < n) {
        const c = source[i];
        if (c === '\\') {
          content += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (c === '`') {
          i++;
          break;
        }
        if (c === '$' && source[i + 1] === '{') {
          let depth = 1;
          let j = i + 2;
          const exprStart = j;
          while (j < n && depth > 0) {
            if (source[j] === '{') depth++;
            else if (source[j] === '}') {
              depth--;
              if (depth === 0) break;
            }
            j++;
          }
          const exprText = source.slice(exprStart, j);
          expressions.push(exprText);
          content += '${' + exprText + '}';
          i = j + 1;
          continue;
        }
        content += c;
        i++;
      }
      literals.push({ line: startLine, content, expressions });
      continue;
    }

    i++;
  }

  return literals;
}

// ---------------------------------------------------------------------------
// Scanner 1 — every Cypress `.type(${expr})` call must route through the
// escapeCypressType / toCypressTypeToken choke-point. Shape-based since
// round-6 (checks for the sanctioned function CALL, not a field name);
// rewritten here to find the expression bound by brace-depth counting
// instead of a `[^}]*` regex, so a braced expression inside the hole can't
// desync the scan.
// ---------------------------------------------------------------------------

function findUnescapedCypressTypeCalls(source: string): Offense[] {
  const offenders: Offense[] = [];
  const n = source.length;
  const marker = '.type(${';
  let searchFrom = 0;

  while (searchFrom < n) {
    const idx = source.indexOf(marker, searchFrom);
    if (idx === -1) break;

    let depth = 1;
    let j = idx + marker.length;
    const exprStart = j;
    while (j < n && depth > 0) {
      if (source[j] === '{') depth++;
      else if (source[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    const expr = source.slice(exprStart, j);
    // Confirm the hole is immediately closed by `})` (a real `.type(${...})`
    // call, not a coincidental `.type(${` substring inside a longer string).
    const closesTypeCall = source.slice(j, j + 2) === '})';
    const routedThroughChokePoint = /\b(escapeCypressType|toCypressTypeToken)\(/.test(expr);
    if (closesTypeCall && !routedThroughChokePoint) {
      offenders.push({
        line: source.slice(0, idx).split('\n').length,
        snippet: source.slice(idx, j + 2),
      });
    }
    searchFrom = idx + marker.length;
  }

  return offenders;
}

// ---------------------------------------------------------------------------
// Scanner 2 (ROUND-7, field-NAME-agnostic) — every `//`-comment template
// interpolation must route through sanitizeForComment(...), no matter what
// the interpolated expression is named. See the file header for the full
// rationale and the allowlist's justification.
// ---------------------------------------------------------------------------

// Provably incapable of carrying a line terminator: a bare numeric literal,
// or a `.length` property-access chain (array/string `.length` is always a
// number). Nothing else is exempt — a raw field, a bare identifier (even
// one holding an already-sanitized string, per FINDING 3's `recipeComment`
// lesson — see cypress-e2e-adapter.ts/playwright-adapter.ts's round-7
// restructure), or any function call OTHER than sanitizeForComment(...)
// must route through the choke-point directly.
const PROVABLY_SAFE_EXPRESSION = /^(\d+|[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*\.length)$/;

function isRoutedThroughChokePointOrProvablySafe(expr: string): boolean {
  const trimmed = expr.trim();
  if (/^sanitizeForComment\(/.test(trimmed)) return true;
  return PROVABLY_SAFE_EXPRESSION.test(trimmed);
}

function findUnsanitizedCommentInterpolations(source: string): Offense[] {
  const offenders: Offense[] = [];
  for (const literal of extractTemplateLiterals(source)) {
    // Only a template whose rendered content is a bare `//` LINE comment is
    // in scope — as opposed to a template that produces real CODE, e.g.
    // `cy.get(${t})` or `it(${JSON.stringify(x)}, ...)`, which is a DISTINCT
    // risk class already made safe by JSON.stringify (see comment-safety.ts's
    // own doc comment for why that split matters).
    if (!/^\s*\/\//.test(literal.content)) continue;
    for (const expr of literal.expressions) {
      if (!isRoutedThroughChokePointOrProvablySafe(expr)) {
        offenders.push({
          line: literal.line,
          snippet: `\${${expr}}  (in \`${literal.content.replace(/\n/g, '\\n').slice(0, 100)}\`)`,
        });
      }
    }
  }
  return offenders;
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

  test(`choke-point guard: ${file} has no // comment that interpolates ANY expression without routing through sanitizeForComment (shape, not field names)`, () => {
    const source = readAdapterSource(file);
    const offenders = findUnsanitizedCommentInterpolations(source);
    assert.equal(
      offenders.length,
      0,
      `${file} has // comment line(s) with a \${...} interpolation that is not a sanitizeForComment(...) ` +
        `call (and not the tiny provably-safe numeric/.length allowlist) — an embedded newline in that ` +
        `expression's value would silently terminate the comment and turn the rest of the line into live, ` +
        `uncommented code. This scanner is FIELD-NAME-AGNOSTIC — it doesn't matter what the expression is ` +
        `called, only that it isn't routed through the choke-point. Offending line(s):\n${formatOffenders(offenders, file)}`
    );
  });
}

// ---------------------------------------------------------------------------
// "Prove the gate has teeth"
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

test('choke-point guard SELF-TEST: findUnsanitizedCommentInterpolations catches a BRAND-NEW, never-before-seen field name (proves it is shape-based, not a remembered name list)', () => {
  // `widget.provenanceNote` has never appeared anywhere in this codebase, in
  // any prior round's fix, or in the OLD (round-6) name-enumerated guard's
  // UNSAFE_FREE_TEXT_FIELDS list. If the scanner only worked by recognizing
  // known names, this would slip through exactly like `ep.summary` did in
  // round-7's FINDING 1. It must be caught anyway, purely by SHAPE — an
  // un-sanitized `${...}` in a `//`-comment template.
  const badSnippet = [
    'function renderWidgetComment(widget) {',
    '  return `  // ${widget.provenanceNote}`;',
    '}',
  ].join('\n');
  const offenders = findUnsanitizedCommentInterpolations(badSnippet);
  assert.equal(
    offenders.length,
    1,
    'the scanner must catch an unsanitized interpolation of a field name it has never seen before'
  );
  assert.equal(offenders[0]?.line, 2);
  assert.match(offenders[0]?.snippet ?? '', /widget\.provenanceNote/);
});

test('choke-point guard SELF-TEST: findUnsanitizedCommentInterpolations does NOT false-positive on a sanitized comment, a JSON.stringify(...) code interpolation, or the numeric/.length allowlist', () => {
  const goodSnippet = [
    'const code = [',
    '  `// ${sanitizeForComment(scenario.description)}`,',
    '  `it(${JSON.stringify(scenario.description)}, () => {`,', // JSON.stringify is a DISTINCT, already-safe risk class — must NOT be flagged (not a comment line)
    '  `// ${endpoints.length} endpoint(s) discovered`,', // bare numeric .length — provably safe
    '  `// ${3} literal`,', // bare numeric literal — provably safe
    '].join("\\n");',
  ].join('\n');
  assert.equal(findUnsanitizedCommentInterpolations(goodSnippet).length, 0);
});

test('choke-point guard SELF-TEST: findUnsanitizedCommentInterpolations still catches a bare, already-safe-looking IDENTIFIER spliced into a comment (the recipeComment lesson)', () => {
  // A locally-computed variable that HAPPENS to already hold sanitized text
  // is still flagged — the guard has no way to prove that at the SHAPE
  // level, and "trust the variable name" is exactly the kind of judgment
  // call a mechanical gate must not make. This is why cypress-e2e-adapter.ts
  // and playwright-adapter.ts were restructured in round-7 to emit the
  // recipe note as its own standalone, directly-sanitized `//` line instead
  // of splicing a pre-built `recipeComment` string into a second template.
  const badSnippet = [
    'const recipeComment = recipeTag ? `\\n// recipe: ${sanitizeForComment(recipeTag)}` : "";',
    'const code = [',
    '  `// qulib-generated — scenario: ${sanitizeForComment(scenario.id)}${recipeComment}`,',
    '].join("\\n");',
  ].join('\n');
  const offenders = findUnsanitizedCommentInterpolations(badSnippet);
  assert.equal(offenders.length, 1, 'a bare identifier spliced into a comment template must still be flagged');
  assert.match(offenders[0]?.snippet ?? '', /recipeComment/);
});
