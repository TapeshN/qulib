/**
 * BEHAVIORAL, OUTPUT-based injection guard (round-8, FINAL — supersedes the
 * source-text scanner as the AUTHORITATIVE gate).
 *
 * `type-and-comment-choke-point-guard.test.ts` (rounds 6-7) is a SOURCE-TEXT
 * scanner: it walks the adapter `.ts` files char-by-char, finds every
 * backtick template literal, and flags a `${...}` hole inside one whose
 * content starts with `//` unless the hole is a `sanitizeForComment(...)`
 * call. That is still a SHAPE assumption about how the vulnerable code is
 * WRITTEN, not a check of what it PRODUCES — and round-8 review + an
 * independent verifier both found the exact hole this predicts: a comment
 * built by `+`-concatenating a `//` literal to an interpolated expression
 * (`` `  // ` + `${expr}` + `\n` ``, a template split across two literals, a
 * block `/* ... *\/` comment, a `.should()`/`.trigger()` string argument, or
 * any future shape that never puts the hole INSIDE one backtick literal
 * starting with `//`) is INVISIBLE to `extractTemplateLiterals` — it isn't a
 * single backtick template at all, so the scanner never even looks at it.
 * The shipped adapters don't currently use that shape, but a scanner that
 * can be defeated by reformatting the SAME bug gives false confidence, not
 * real protection.
 *
 * This file replaces that reasoning with a BEHAVIORAL check: it doesn't care
 * how any adapter's source constructs a string. For every adapter and every
 * public spec-emitting entrypoint, it feeds in a NeutralScenario / ApiSurface
 * where EVERY raw, externally-derived string field is set to a SENTINEL that
 * simultaneously embeds:
 *   - a raw CR, LF, U+2028 (LINE SEPARATOR), and U+2029 (PARAGRAPH SEPARATOR)
 *     — every code point ECMAScript treats as a line terminator, so any of
 *     them can prematurely end a `//` comment REGARDLESS of how that comment
 *     was assembled in source (backtick template, `+`-concatenation, or
 *     anything else);
 *   - a distinctive, uniquely-tagged "live code" marker
 *     (`INJECTED_MARKER_STATEMENT_<field>();`) that only APPEARS as a real
 *     AST CallExpression/Identifier if the surrounding comment/string context
 *     was actually broken;
 *   - a Cypress `.type()` special-sequence token (`{enter}`) to probe the
 *     SEPARATE `escapeCypressType` choke-point in the same pass.
 *
 * It then runs the REAL adapter, parses the REAL generated output with the
 * TypeScript compiler (`typescript`, already a direct dependency of
 * `@qulib/core` — see `package.json`), and asserts two properties of the
 * OUTPUT, not the source:
 *   1. The marker never resolves to a live `Identifier` node anywhere in the
 *      parsed AST (it may only ever appear inside a collapsed `//` comment,
 *      which isn't part of the AST at all, or inside a `StringLiteral`
 *      node's decoded `.text`, which `JSON.stringify` already makes safe).
 *   2. No `.type(...)` call's string-literal argument contains a raw,
 *      un-escaped `{` (checked structurally: every `{` in the decoded string
 *      must be immediately followed by `{` and `}` — Cypress's own doubled-
 *      brace escape — or the check fails).
 *
 * This is shape-independent by construction: it doesn't matter whether a
 * future adapter builds its comment via a backtick template, `+`-
 * concatenation, `.join()`, a block comment, or something not invented yet —
 * if ANY of those shapes lets a line terminator leak the marker into live
 * code, the AST walk catches it, because it only looks at what the compiler
 * says the OUTPUT actually is.
 *
 * A "prove the gate has teeth" section at the bottom feeds the two behavioral
 * checkers a SYNTHETIC output string reproducing the exact `+`-concatenation
 * bypass class the source-scanner missed (never routed through any adapter
 * — a raw string built the way a vulnerable adapter COULD build it) and
 * asserts it is caught. See `feedback_gate_bypass_audit`: a safety gate must
 * be red-teamed with a real payload, not just run green against
 * already-fixed code.
 *
 * The source-scan guard (`type-and-comment-choke-point-guard.test.ts`) is
 * KEPT as a fast, cheap lint that fails fast on the exact shapes it can see
 * — but THIS file is the authoritative gate against the injection class
 * itself, because it is immune to the next reformatting of the same bug.
 *
 * -----------------------------------------------------------------------
 * Full field / entrypoint inventory this file exercises (FINDING 2 ask —
 * "state the full list of entrypoints + fields the behavioral test covers"):
 *
 * Entrypoints:
 *   - CypressE2EAdapter.render / .renderAll
 *   - PlaywrightAdapter.render / .renderAll
 *   - ApiAdapter.render / .renderAll
 *   - ApiAdapter.scaffoldApiTests (non-empty endpoints AND the
 *     zero-endpoints branch, which has its own separate comment template)
 *
 * Fields (every raw, externally-derived string field each entrypoint's
 * input type exposes — closed zod enums / TS union-literal fields such as
 * `TestStep.action`, `DiscoveredEndpoint.method/sourceTier/confidence` are
 * NOT free text — a real caller cannot supply arbitrary text for them, so
 * they carry no injection surface and are intentionally out of scope, same
 * call the round-7 guard's allowlist already made):
 *   - NeutralScenario.id
 *   - NeutralScenario.title
 *   - NeutralScenario.description
 *   - NeutralScenario.targetPath
 *   - NeutralScenario.tags (the `recipe-<tag>` free-text suffix)
 *   - TestStep.target (for every one of the 12 TestStep actions, with AND
 *     without a target present, to hit both the code-emission and the
 *     comment-fallback branch)
 *   - TestStep.value (ditto — including the `key-press` action, where this
 *     field doubles as the raw keyboard key)
 *   - TestStep.description (ditto)
 *   - DiscoveredEndpoint.path
 *   - DiscoveredEndpoint.sourceFile
 *   - DiscoveredEndpoint.summary (present AND absent — it's optional)
 *   - ApiSurface.repoPath
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { CypressE2EAdapter } from '../cypress-e2e-adapter.js';
import { PlaywrightAdapter } from '../playwright-adapter.js';
import { ApiAdapter } from '../api-adapter.js';
import type { NeutralScenario, TestStep } from '../../schemas/gap-analysis.schema.js';
import type { ApiSurface, DiscoveredEndpoint } from '../../tools/repo/api-surface.js';
import { sanitizeForComment } from '../comment-safety.js';

// ---------------------------------------------------------------------------
// The sentinel — one value that probes all three risk classes at once.
// ---------------------------------------------------------------------------

const MARKER = 'INJECTED_MARKER_STATEMENT';

/**
 * Builds a per-field-tagged sentinel string. `tag` must be a valid JS
 * identifier fragment (alnum + underscore) so that IF this text ever leaks
 * into live source, it parses as a clean, uniquely-named CallExpression —
 * letting a failing assertion name exactly which field leaked.
 *
 * Embeds every ECMAScript line-terminator code point — CR, LF, U+2028 LINE
 * SEPARATOR, U+2029 PARAGRAPH SEPARATOR (any one of which can end a `//`
 * comment early, no matter how that comment's source was assembled) —
 * around a uniquely-tagged live-code marker, plus a Cypress `.type()`
 * special-sequence token, all in one string.
 */
function sentinel(tag: string): string {
  return (
    `${tag}-before\r\n` +
    `${MARKER}_${tag}();\r` +
    `\u2028\u2029\n` +
    `${tag}-after {enter} end`
  );
}

// ---------------------------------------------------------------------------
// Behavioral checkers — operate on the OUTPUT string only. No knowledge of
// how any adapter's source constructs that output.
// ---------------------------------------------------------------------------

interface Offense {
  detail: string;
}

/**
 * Parses `code` with the real TypeScript parser and walks the resulting AST
 * (not the raw source text, not the comment trivia) for any `Identifier`
 * node whose text contains the marker. A marker that stayed safely inside a
 * `//` comment (trivia — never becomes a node) or inside a `StringLiteral`'s
 * decoded text (its `.text`, not tokenized into identifiers) can never
 * produce this. A marker that escaped either context — because an embedded
 * line terminator broke a comment early, no matter HOW that comment's
 * source was assembled — becomes real, parseable statements, and shows up
 * here as a live `Identifier`.
 */
function findLiveMarkerLeaks(code: string): Offense[] {
  const sourceFile = ts.createSourceFile('generated.ts', code, ts.ScriptTarget.ES2020, true);
  const offenses: Offense[] = [];

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text.includes(MARKER)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      offenses.push({
        detail: `live Identifier "${node.text}" at generated-output line ${line + 1}`,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return offenses;
}

/** True iff every `{` in `text` is part of Cypress's doubled-brace escape `{{}`. */
function everyBraceIsCypressEscaped(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      if (text[i + 1] === '{' && text[i + 2] === '}') {
        i += 3;
        continue;
      }
      return false;
    }
    i++;
  }
  return true;
}

/**
 * Parses `code` and finds every `<expr>.type(<stringArg>)` call — Cypress's
 * `.type()` DSL — asserting the DECODED string argument (TS already resolves
 * escape sequences for us via `StringLiteral.text`) never contains a raw,
 * un-escaped `{` token-open. Structural, not name-based: it doesn't matter
 * which adapter or call site produced the `.type()` call.
 */
function findUnescapedCypressTypeArgs(code: string): Offense[] {
  const sourceFile = ts.createSourceFile('generated.ts', code, ts.ScriptTarget.ES2020, true);
  const offenses: Offense[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'type' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const arg = node.arguments[0] as ts.StringLiteral;
      if (!everyBraceIsCypressEscaped(arg.text)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        offenses.push({
          detail: `.type(${JSON.stringify(arg.text)}) with an unescaped "{" at generated-output line ${line + 1}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return offenses;
}

function assertBehaviorallySafe(code: string, context: string): void {
  const leaks = findLiveMarkerLeaks(code);
  assert.equal(
    leaks.length,
    0,
    `${context}: the injection sentinel leaked into LIVE, PARSEABLE code — an embedded line ` +
      `terminator escaped whatever context was supposed to contain it (comment or string), ` +
      `regardless of how that context was constructed in source. Offenses:\n` +
      leaks.map((o) => `  - ${o.detail}`).join('\n') +
      `\n--- generated output ---\n${code}`
  );

  const unescaped = findUnescapedCypressTypeArgs(code);
  assert.equal(
    unescaped.length,
    0,
    `${context}: a raw, un-escaped Cypress "{" special-sequence opener reached a .type() ` +
      `argument. Offenses:\n${unescaped.map((o) => `  - ${o.detail}`).join('\n')}\n` +
      `--- generated output ---\n${code}`
  );
}

// ---------------------------------------------------------------------------
// Sentinel fixtures — every raw string field, every TestStep action, with
// AND without a target present (to hit both the code-emission branch and the
// comment-fallback branch of every action).
// ---------------------------------------------------------------------------

const ACTIONS: TestStep['action'][] = [
  'navigate',
  'click',
  'type',
  'select',
  'key-press',
  'assert-visible',
  'assert-hidden',
  'assert-text',
  'assert-disabled',
  'assert-count',
  'wait',
  'api-call',
];

function sentinelStep(action: TestStep['action'], tag: string, withFields: boolean): TestStep {
  if (!withFields) {
    return { action, description: sentinel(`${tag}_description`) };
  }
  return {
    action,
    target: sentinel(`${tag}_target`),
    value: sentinel(`${tag}_value`),
    description: sentinel(`${tag}_description`),
  };
}

function sentinelSteps(): TestStep[] {
  const steps: TestStep[] = [];
  for (const action of ACTIONS) {
    steps.push(sentinelStep(action, `${action}_full`, true));
    steps.push(sentinelStep(action, `${action}_bare`, false));
  }
  return steps;
}

function sentinelScenario(): NeutralScenario {
  return {
    id: sentinel('scenario_id'),
    title: sentinel('scenario_title'),
    description: sentinel('scenario_description'),
    targetPath: sentinel('scenario_targetPath'),
    steps: sentinelSteps(),
    tags: [`recipe-${sentinel('recipe_tag')}`],
    recommendations: [],
    sourceGapIds: [],
  };
}

function sentinelEndpoint(tag: string, withSummary: boolean): DiscoveredEndpoint {
  return {
    method: 'POST',
    path: sentinel(`${tag}_path`),
    sourceFile: sentinel(`${tag}_sourceFile`),
    sourceTier: 'openapi',
    confidence: 'high',
    ...(withSummary ? { summary: sentinel(`${tag}_summary`) } : {}),
  };
}

function sentinelApiSurface(endpoints: DiscoveredEndpoint[]): ApiSurface {
  return {
    discoveredAt: new Date().toISOString(),
    repoPath: sentinel('apiSurface_repoPath'),
    endpoints,
    openApiSpecsFound: endpoints.length,
    tier3Enabled: false,
  };
}

// ---------------------------------------------------------------------------
// CypressE2EAdapter
// ---------------------------------------------------------------------------

test('behavioral guard: CypressE2EAdapter.render never lets the sentinel leak into live code or an unescaped .type()', () => {
  const { code } = new CypressE2EAdapter().render(sentinelScenario());
  assertBehaviorallySafe(code, 'CypressE2EAdapter.render');
});

test('behavioral guard: CypressE2EAdapter.renderAll never lets the sentinel leak (multi-scenario batch)', () => {
  const results = new CypressE2EAdapter().renderAll([sentinelScenario(), sentinelScenario()]);
  for (const [i, { code }] of results.entries()) {
    assertBehaviorallySafe(code, `CypressE2EAdapter.renderAll[${i}]`);
  }
});

// ---------------------------------------------------------------------------
// PlaywrightAdapter
// ---------------------------------------------------------------------------

test('behavioral guard: PlaywrightAdapter.render never lets the sentinel leak into live code', () => {
  const { code } = new PlaywrightAdapter().render(sentinelScenario());
  assertBehaviorallySafe(code, 'PlaywrightAdapter.render');
});

test('behavioral guard: PlaywrightAdapter.renderAll never lets the sentinel leak (multi-scenario batch)', () => {
  const results = new PlaywrightAdapter().renderAll([sentinelScenario(), sentinelScenario()]);
  for (const [i, { code }] of results.entries()) {
    assertBehaviorallySafe(code, `PlaywrightAdapter.renderAll[${i}]`);
  }
});

// ---------------------------------------------------------------------------
// ApiAdapter — render()/renderAll() (NeutralScenario path)
// ---------------------------------------------------------------------------

test('behavioral guard: ApiAdapter.render never lets the sentinel leak into live code', () => {
  const { code } = new ApiAdapter().render(sentinelScenario());
  assertBehaviorallySafe(code, 'ApiAdapter.render');
});

test('behavioral guard: ApiAdapter.renderAll never lets the sentinel leak (multi-scenario batch)', () => {
  const results = new ApiAdapter().renderAll([sentinelScenario(), sentinelScenario()]);
  for (const [i, { code }] of results.entries()) {
    assertBehaviorallySafe(code, `ApiAdapter.renderAll[${i}]`);
  }
});

// ---------------------------------------------------------------------------
// ApiAdapter — scaffoldApiTests() (repo-first ApiSurface path — a SEPARATE
// entrypoint with its own comment templates, both the non-empty AND the
// zero-endpoints branch)
// ---------------------------------------------------------------------------

test('behavioral guard: ApiAdapter.scaffoldApiTests never lets the sentinel leak (endpoints present, summary present and absent)', () => {
  const surface = sentinelApiSurface([
    sentinelEndpoint('ep1', true),
    sentinelEndpoint('ep2', false),
  ]);
  const { code } = new ApiAdapter().scaffoldApiTests(surface);
  assertBehaviorallySafe(code, 'ApiAdapter.scaffoldApiTests (with endpoints)');
});

test('behavioral guard: ApiAdapter.scaffoldApiTests never lets the sentinel leak (zero-endpoints branch — its own separate comment template)', () => {
  const surface = sentinelApiSurface([]);
  const { code } = new ApiAdapter().scaffoldApiTests(surface);
  assertBehaviorallySafe(code, 'ApiAdapter.scaffoldApiTests (zero endpoints)');
});

// ---------------------------------------------------------------------------
// "Prove the gate has teeth" — red-team the checkers themselves against a
// SYNTHETIC reproduction of the exact `+`-concatenation bypass class the
// round-7 source-scanner missed. This output was never produced by any real
// adapter; it simulates what a vulnerable adapter COULD emit if it built a
// comment via `'  // ' + expr + '\n'` instead of a single backtick template
// starting with `//` — the shape the source-scanner is blind to. The
// behavioral checkers below don't look at how this string was built, only
// at what it IS, so they catch it anyway.
// ---------------------------------------------------------------------------

test('behavioral guard SELF-TEST: findLiveMarkerLeaks catches the +-concatenation comment bypass (the class the source-scanner is blind to)', () => {
  // Reproduces: `'  // ' + description + '\n'` — NOT a single backtick
  // template starting with `//`, so `type-and-comment-choke-point-guard`'s
  // `extractTemplateLiterals` never sees this as an in-scope comment
  // template at all. The behavioral checker doesn't care — it only looks at
  // the OUTPUT.
  const description = 'user does a thing\nINJECTED_MARKER_STATEMENT_selftest();\n';
  const bypassOutput = '  // ' + description + '\n' + 'describe("x", () => { it("y", () => {}); });';

  const leaks = findLiveMarkerLeaks(bypassOutput);
  assert.equal(leaks.length, 1, 'the behavioral checker must catch the +-concatenation bypass by OUTPUT shape');
  assert.match(leaks[0]?.detail ?? '', /INJECTED_MARKER_STATEMENT_selftest/);
});

test('behavioral guard SELF-TEST: findLiveMarkerLeaks does NOT false-positive when the marker stays inside a real comment or a JSON.stringify string', () => {
  const safeOutput = [
    `// ${sanitizeForComment(sentinel('safe'))}`,
    `const x = ${JSON.stringify(sentinel('safe_string'))};`,
    `describe("x", () => {});`,
  ].join('\n');
  assert.equal(findLiveMarkerLeaks(safeOutput).length, 0);
});

test('behavioral guard SELF-TEST: findUnescapedCypressTypeArgs catches a raw, unescaped .type("press {enter} to search")', () => {
  const bypassOutput = 'cy.get("#search").type("press {enter} to search");';
  const offenses = findUnescapedCypressTypeArgs(bypassOutput);
  assert.equal(offenses.length, 1, 'the behavioral checker must catch an unescaped "{" reaching .type()');
});

test('behavioral guard SELF-TEST: findUnescapedCypressTypeArgs does NOT false-positive on a correctly-escaped .type() call', () => {
  const safeOutput = 'cy.get("#search").type("press {{}enter} to search");';
  assert.equal(findUnescapedCypressTypeArgs(safeOutput).length, 0);
});
