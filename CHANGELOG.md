# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for **0.3.1 and earlier** were reconstructed from git tags (`v0.1.1` … `v0.2.2`) and release commits on `main`.

## [Unreleased]

### Added

- **Clean-twin false-positive guard for the golden eval (precision half):** every golden case previously only scored recall — does qulib detect the seeded defect. `evals/golden/<suite>/*.json` cases can now declare `cleanTwinOf: "<seeded-case-id>"`, marking themselves as the defect-free twin of a seeded-defect case (derived by removing the seeded defect, never a new fixture). The runner cross-references every twin against its own result and emits a new `EvalRunSummary.falsePositiveRate` / `EvalLedgerEntry.falsePositiveRate` metric (`undefined`, never `0`, when a suite has no twins). Any nonzero false-positive rate is a hard deduction — it forces the suite's outcome to `FAIL`, which flows through the existing rollup into `npm run eval` and the `npm run eval:check` CI merge gate unchanged. Reference pair shipped for `prompt-leakage`: `clean-header.json` / `clean-route.json` twin `leaky-header` / `leaky-inline-script`. See `packages/core/evals/README.md` § "Clean-twin false-positive guard".
- **Chrome DevTools Recorder journey interchange — closes the journey → NeutralScenario bridge gap:** `importRecorderFlow` (new `@qulib/core` export) converts a Chrome DevTools Recorder export (`{ title, steps: [{ type, ... }] }` — DevTools → Recorder panel → "Export as JSON") into the existing `NeutralScenario` model that `analyzeApp`'s crawl, every recipe, and `scaffoldTests`/every `TestAdapter` already produce and consume — a converted scenario flows through `scaffoldTests(url, { scenarios })` identically to a crawl- or recipe-derived one. `navigate` seeds the scenario's `targetPath`; `click`/`change`/`keyDown` map to `click`/`type` steps; `waitForElement` maps to `assert-visible`/`assert-hidden`; a step's `assertedEvents` (e.g. `navigation`) becomes an extra assertion step. Each step's `selectors` fallback chain is resolved by the new `pickResilientSelector` export, which prefers `aria/`/`text/`-prefixed selectors over brittle `css`/`xpath` ones. Parsing tolerates any step type it does not know how to map (`hover`, `scroll`, `waitForExpression`, `setViewport`, a future unrecognized `type`) — skip with a warning, never throw; only a structurally malformed flow throws. The `qulib_scaffold_tests` MCP tool gains an optional `journeys` input (format auto-detected per entry via the new `isRecorderFlow` export — a Recorder export or an already-shaped `NeutralScenario`) so a caller can scaffold straight from a recorded flow instead of crawling. See `packages/core/README.md` § "Journey interchange (Chrome DevTools Recorder)".
- **New `'select'` `TestStep` action:** additive to the action union — renders `cy.get(t).select(v)` (Cypress) / `page.locator(t).selectOption(v)` (Playwright). Lets a reviewer opt a Recorder-converted or hand-authored step into real `<select>` semantics instead of `.type()`.

### Fixed

- **Recorder honesty pass — assert-count, change/select disambiguation, empty-scenario rejection (round-2 hardening of the journey interchange above, all in `packages/core/src/tools/journeys/recorder-import.ts` + `packages/mcp/src/journey-input.ts`):**
  - `waitForElement` steps carrying a Recorder element-COUNT assertion (`count`/`operator`, e.g. "wait until >= 3 matching elements exist") were silently downgraded to a single-element `assert-visible`, discarding the count semantics with zero warning even though `TestStep` already has an `assert-count` action the Cypress adapter already renders. Now converts to `assert-count`; any `operator` other than `>=` (the only one the Cypress adapter renders faithfully) emits a warning rather than silently mis-rendering.
  - A `change` step targeting a real `<select>` is indistinguishable in Recorder JSON from a text input, but was unconditionally converted to `type` — the generated `cy.get(t).type(value)` throws at runtime against a `<select>` even though the scenario is schema-valid and the spec compiles. Every `change` step now carries a warning naming the possible-`<select>` ambiguity and pointing at the new `'select'` action to opt in after review; the converter never silently guesses.
  - A Recorder flow whose every step is unmappable (`hover`/`scroll`/`waitForExpression`/unknown, or no usable selector) previously still converted to a schema-valid zero-step `NeutralScenario` that scaffolded into a stub-only "successful" spec, silently incrementing `scenarioCount`/`testCount`. `importRecorderFlow` now also returns `rejected: boolean`; the MCP `journey-input.ts` wiring excludes a rejected journey from the scaffold input entirely and reports it in a new, distinct `rejectedJourneys` response field on `qulib_scaffold_tests` — never counted as a successful conversion. `scaffoldTests` was also tightened to treat "caller supplied `scenarios` (even `[]`)" as "do not crawl", so an all-rejected `journeys[]` input still honors the documented "journeys supplied ⇒ never crawl" contract instead of silently falling back to a live crawl.
- **Recorder round-3 hardening — exhaustive step-type x adapter fidelity (closes the "same class of bug in another step type" whack-a-mole from rounds 1-2):**
  - **New framework-neutral `'key-press'` `TestStep` action (additive to the action union):** a Recorder `keyDown` step previously converted straight to a `'type'` step carrying Cypress-only `{key}` special-sequence syntax (e.g. `value: "{enter}"`) baked in at conversion time — wrong under Playwright (`.fill()` would write the LITERAL string `"{enter}"` instead of pressing a key) and wrong under Cypress itself for any key outside its small special-sequence whitelist (`{tab}` throws at real runtime even though the generated spec compiles). `keyDown` now converts to `'key-press'`, carrying the RAW `KeyboardEvent.key` value Recorder recorded; each adapter renders it in its own idiom at RENDER time — `cypress-e2e-adapter.ts` renders real `.type("{token}")` syntax only for keys in a new `cypress-special-keys.ts` whitelist (re-derived from Cypress's own documented special-character-sequence table) and falls back to a safe, non-throwing comment naming the exact key + risk for anything outside it (e.g. "Tab"); `playwright-adapter.ts` renders every key faithfully via `page.locator(t).press(key)`, since Playwright's key names match Recorder's `KeyboardEvent.key` values directly and are not limited to a fixed whitelist. A key Cypress cannot render is warned about BY NAME at conversion time (`recorder-import.ts`), naming both the exact key and the `cypress-e2e` adapter.
  - **Broadened the `change`-step warning (previously named only `<select>`):** `.type()`/`.fill()` also throw at runtime against a checkbox or radio input, not just a `<select>` — Recorder's `change` step is identical for all three. The warning now names `<select>`, checkbox, AND radio, and both frameworks (`cy.get(t).type(v)` / `page.locator(t).fill(v)`) that share the failure — a warning that trains a reviewer to rule out only ONE of several real risks was worse than none.
  - **`assertedEvents` entries whose `type` is not `"navigation"` now warn by name** instead of silently no-op'ing — this previously contradicted the module's own "unmappable signals are skipped WITH A WARNING" contract (e.g. Recorder's `resourceLoad`/`click` asserted-event types vanished with zero trace).
  - **`waitForElement`'s non-`>=` operator warning now names BOTH adapters**, not just Cypress — `playwright-adapter.ts` has the exact same `>=`-only limitation for `assert-count` (`toBeGreaterThanOrEqual`), so naming only Cypress was the same false-reassurance-warning bug as the `change`-step fix above, just hiding in a different step type.
  - **`setViewport` now warns** instead of a fully silent no-op: its recorded dimensions are informational only — they are never threaded into the generated project config (`cypress.config.ts`/`playwright.config.ts` both use a fixed default viewport) — so silently dropping them without a trace understated a real (if minor) fidelity gap.
  - **Honest Playwright support:** `qulib_scaffold_tests`'s MCP tool description and `framework` field description previously claimed "playwright is accepted but not yet implemented (returns an error)" — false; `createAdapter('playwright')` (`adapter-factory.ts`) and `scaffoldTests` (`buildPlaywrightProjectConfig`) have always fully implemented it, and the `key-press` fix above closes the one real Recorder-path fidelity gap Playwright had. Both descriptions now say cypress-e2e and playwright are fully implemented.
  - See the exhaustive Recorder-step-type x adapter fidelity table in `packages/core/src/tools/journeys/__tests__/recorder-import.test.ts` — every cell is either rendered faithfully (with a test asserting the exact adapter output) or names its exact warning (with a test asserting the warning fires).
- **Clean-twin near-duplicate guard (`packages/core/evals/runner/load-cases.ts`):** `cleanTwinOf` previously only checked that the referenced id exists and is not self-referential — a structurally unrelated twin could still pad the `falsePositiveRate` denominator with zero real coverage. The loader now also rejects a twin whose `input` falls below a calibrated token-similarity floor against its seeded case's `input`, thrown loudly at load time. See `packages/core/evals/README.md` § "Clean-twin false-positive guard".
- **Recorder round-4 hardening — last-mile fidelity/vocabulary-parity cells (`recorder-import.ts`, `cypress-special-keys.ts`, `cypress-e2e-adapter.ts`, `context-builder.ts`):**
  - **Orphan `keyUp` no longer an unconditional silent drop:** this module's own prior comment claimed "`keyUp` is always paired with a `keyDown`, nothing lost" — an unenforced assumption, not a guarantee, and exactly the silent-drop class the round-3 `assertedEvents` fix closed. `importRecorderFlow` now tracks which keys had a `keyDown` actually CONVERTED earlier in the same flow: a `keyUp` matching a still-pending prior `keyDown` for that key is truly redundant and stays silent; a `keyUp` with no matching prior `keyDown` (a trimmed/hand-edited export, a chord's second-key release, or any Recorder-shaped JSON not produced by an unedited Recorder session) is now warned about by index + key instead of vanishing.
  - **Single printable characters now render faithfully in Cypress (closes an inverse facade):** the round-3 `keyDown` fidelity warning + `cypress-e2e-adapter.ts`'s safe-comment fallback previously fired for ANY key outside the `{token}` special-sequence whitelist — but a single printable character (a letter, digit, punctuation mark, or space) renders FAITHFULLY via a plain unbraced `cy.get(t).type("a")`, firing a real keydown/keypress/input/keyup sequence. A common single-key shortcut recording (e.g. Gmail's `c`/`j`/`k`) was wrongly getting a broken comment and a false "cannot render" warning instead of the working code. New shared `isSingleTypeableCharacter` export in `cypress-special-keys.ts`: `cypress-e2e-adapter.ts`'s `key-press` case now renders a single printable character unbraced (never through the `{token}` path, never the comment fallback), and `recorder-import.ts`'s fidelity warning now fires ONLY for a key that is genuinely un-typeable in Cypress — outside BOTH the `{token}` whitelist AND the single-printable-character case (e.g. `Tab`, `F1`, `Shift`). Playwright's `.press()` was already faithful for every key and is unchanged.
  - **LLM prompt action vocabulary now matches `TestStepSchema` exactly (closes a producer/schema drift):** `key-press` and `select` were added to `TestStepSchema` and both adapters in round 3 but never to the gap-driven scenario generator's LLM prompt (`context-builder.ts`) — a producer that could not even ADVERTISE those actions undercut the "exhaustive" framing as much as an adapter that could not render one. `buildGapPrompt`'s documented action union is now derived directly from `TestStepSchema.shape.action.options` (zod's own enum-values accessor) rather than a hand-copied literal list, so the two can never drift apart again.
  - See the updated `packages/core/README.md` § "Journey interchange (Chrome DevTools Recorder)" → "Honesty guardrails" for the user-facing description of both fidelity fixes.
- **Recorder round-5 hardening — closes a round-4 regression + two minor gaps (`cypress-special-keys.ts`, `cypress-e2e-adapter.ts`, `playwright-adapter.ts`, new `adapters/comment-safety.ts`):**
  - **REGRESSION FIX — a literal `"{"` keypress no longer renders an unescaped, throwing `cy.type("{")`:** round-4's "single printable character is always faithful" branch rendered `cy.get(t).type("{")` verbatim for a `keyDown` with `key: "{"` — but Cypress's `.type()` treats an unescaped `"{"` as the OPENING of a `{token}` special-sequence, so that call compiles fine and then THROWS at real Cypress runtime with zero warning, exactly the "compiles then crashes silently" facade this whole line of fixes exists to close. Round-3 was conservatively correct here (warned + commented for `"{"`); round-4's generalization broke it. `cypress-e2e-adapter.ts`'s `key-press` case now escapes a literal `"{"` to Cypress's own documented form, `"{{}"`, via the new `escapeCypressTypeLiteral` export in `cypress-special-keys.ts`, before emitting the `.type(...)` call. Per Cypress's own special-character-sequence table, no other single printable character needs escaping — `"}"` alone (with no preceding unescaped `"{"`) is never treated as special and renders literally, unchanged.
  - **Astral-plane characters (emoji, etc.) no longer mis-routed to the warned/comment path:** `isSingleTypeableCharacter` gated on `key.length === 1` — a UTF-16 CODE-UNIT count — so a single astral-plane character (one Unicode code point, but a two-code-unit surrogate pair in UTF-16, e.g. an emoji reaction shortcut) was mis-classified as "not a single character" and routed to the un-typeable warned/commented path even though Cypress's `.type()` renders it faithfully. Fails safe (an over-warn, not a broken spec) but still wrong. Now uses `[...key].length === 1` (code-point iteration via the spread operator), so a genuine single keypress — including a surrogate-pair emoji — is correctly recognized as faithfully renderable.
  - **Newline-safe generated `//` comments (pre-existing since the original journey-interchange feature, not a round-4 regression, but a real risk given qulib generates EXECUTABLE specs from external input):** several "safe comment" fallbacks in `cypress-e2e-adapter.ts` and `playwright-adapter.ts` interpolated raw string fields (`TestStep.description`, a `key-press` step's raw key, `NeutralScenario.description`/`id`/`targetPath`/recipe tag) directly into a single-line `// ...` comment. A `//` comment terminates at the first line break — so a raw newline embedded in one of these fields (from a hand-edited or non-Recorder-produced flow) would silently end the comment early and turn the rest of that field's text into LIVE, UNCOMMENTED code in the generated spec. New `sanitizeForComment` export (`adapters/comment-safety.ts`) strips CR/LF and the two Unicode line-terminator code points (U+2028/U+2029) from any text headed into a bare `//` comment, collapsing a multi-line input to one safe comment line. Every raw-text `//` comment interpolation in both adapters now routes through it; the pre-existing `JSON.stringify(...)` code-STRING interpolations elsewhere in both adapters were already safe (a raw newline inside `JSON.stringify` output is already escaped to the two-character `\n` sequence, which cannot terminate anything) and are unchanged.
  - See `packages/core/README.md` § "Journey interchange (Chrome DevTools Recorder)" → "Honesty guardrails" for the user-facing description of all three fixes.
- **Recorder round-6 hardening — closes the interpolation-facade class STRUCTURALLY instead of point-patching the next site (`cypress-special-keys.ts`, `cypress-e2e-adapter.ts`, `api-adapter.ts`, new `adapters/__tests__/type-and-comment-choke-point-guard.test.ts`):**
  - **The `'type'` `TestStep` action — the COMMON path, any recorded `change`-event value — is now Cypress-DSL-escaped:** rounds 2-5 only ever escaped a literal `"{"` when it was the WHOLE key-press value; the far more common `'type'` action (any recorded text) interpolated the raw value straight into `cy.get(t).type(v)` with no escaping at all. Reproduced two failure modes through the real `importRecorderFlow` → `CypressE2EAdapter` pipeline: a value like `"template: {editor}"` throws `CypressError: Special character sequence: {editor} is not recognized` at real runtime; a value like `"press {enter} to search"` (ordinary prose) silently types "press ", fires a REAL Enter keypress (submitting a form / navigating), then types " to search" — no error, just silently wrong test behavior. New `escapeCypressType` export in `cypress-special-keys.ts` escapes EVERY `"{"` occurrence anywhere in a string (not just a whole-string equality check) to Cypress's own documented `"{{}"` form; the `'type'` action and the single-char key-press path both now route through this ONE function (`escapeCypressTypeLiteral` is kept only as a deprecated backward-compatible alias — there is one escaper now, not two).
  - **`api-adapter.ts` — the THIRD adapter round-5 missed — now sanitizes its `//` comments:** round-5 wired `sanitizeForComment` into `cypress-e2e-adapter.ts` and `playwright-adapter.ts` only; `api-adapter.ts` interpolated `step.description`/`scenario.description`/`scenario.id`/`scenario.targetPath` directly into bare `//` comments, unsanitized — the same newline-terminates-comment code-injection risk. All six comment interpolation sites in `api-adapter.ts` now route through `sanitizeForComment`.
  - **New STRUCTURAL guard test, not another one-off regression test:** rounds 2-5 each added a targeted regression test for the ONE site just fixed, and each round the reviewer found the same bug class at the next untouched site. `adapters/__tests__/type-and-comment-choke-point-guard.test.ts` source-scans `cypress-e2e-adapter.ts`, `playwright-adapter.ts`, and `api-adapter.ts` and FAILS the build if it finds ANY `.type(${expr})` call whose `expr` does not route through `escapeCypressType(...)`/`toCypressTypeToken(...)`, or ANY `//` comment template that interpolates a raw, free-text `scenario`/`step` field without `sanitizeForComment(...)` — including a site nobody has written yet. Two self-tests feed each scanner a synthetic bad snippet and assert it is caught, proving the guard has teeth rather than only ever running green against already-fixed source.
  - **Fixed a silent test-harness gap that would have hidden regressions in this exact area:** `packages/core/src/adapters/__tests__/cypress-e2e-adapter.test.ts` (the dedicated `select`/`key-press` regression suite added in rounds 2-4) was never listed in `package.json`'s `test` script — `npm test` silently never ran it. Added it, and the new guard test file, to the script.
  - See `packages/core/README.md` § "Journey interchange (Chrome DevTools Recorder)" → "Honesty guardrails" for the user-facing description.
- **Recorder round-7 hardening — the round-6 guard was itself still whack-a-mole; made it match the SHAPE, not a list of field names (`api-adapter.ts`, `cypress-e2e-adapter.ts`, `playwright-adapter.ts`, `adapters/__tests__/type-and-comment-choke-point-guard.test.ts`):**
  - **`api-adapter.ts`'s `renderEndpointTest`/`scaffoldApiTests` — a site round-5/6 never touched — interpolated raw fields straight into `//` comments, unsanitized:** `ep.summary` (free text lifted from a caller-supplied OpenAPI spec), `ep.sourceFile`, `ep.sourceTier`, `ep.confidence`, and `apiSurface.repoPath`. Same newline-terminates-comment injection class as every prior round. All five sites now route through `sanitizeForComment`.
  - **The round-6 guard's comment scanner enumerated a fixed list of KNOWN field names** (`scenario.description`/`scenario.id`/`scenario.targetPath`/`step.description`) — so `ep.summary`, a genuinely new field at an untouched site, was invisible to it by construction; the guard itself was the whack-a-mole. The scanner is now **field-NAME-agnostic**: it fails on ANY `${...}` interpolation inside a bare `//`-comment template that is not itself a call to `sanitizeForComment(...)`, regardless of what the expression is named — a small, explicit, documented allowlist covers only the two shapes that can never carry a line terminator (a bare numeric literal, a `.length` property access). A new self-test proves this by feeding the scanner a field name (`widget.provenanceNote`) that has never appeared anywhere in this codebase or in any prior round's fix, and asserting it is still caught.
  - **The `.type()` scanner** was already shape-based (checks for the `escapeCypressType`/`toCypressTypeToken` call, never a field name); rewritten to find the interpolated expression's bounds by brace-depth counting instead of a `[^}]*` regex, so an expression that itself contains a brace can no longer desync the scan.
  - **`cypress-e2e-adapter.ts`/`playwright-adapter.ts` restructured to drop a pattern the new guard correctly refuses to special-case:** both previously built an already-sanitized `recipeComment` string and then spliced it into a SECOND `//`-comment template as a bare `${recipeComment}` hole. That value was safe, but the guard has no way to prove a bare identifier is safe at the shape level — and "trust this variable name" is exactly the judgment call a mechanical gate must not make. The recipe note is now emitted as its own standalone, directly-sanitized `//` line instead, producing byte-identical output with no double-interpolation to reason about.
  - **Re-scanned all three adapters with the new agnostic guard — zero further violations** beyond the api-adapter.ts sites and the `step.action` comment site (a closed zod enum, previously exempted by name in round-6's guard; now routed through `sanitizeForComment` too since the round-7 guard makes no such exemption).
  - See `packages/core/README.md` § "Journey interchange (Chrome DevTools Recorder)" → "Honesty guardrails" for the user-facing description.
- **Recorder round-8 hardening (FINAL) — replaces the SOURCE-TEXT guard with a BEHAVIORAL, output-based one; closes the `+`-concatenation bypass class the source-scanner is structurally blind to, and a real leak that class hid (`cypress-e2e-adapter.ts`, new `adapters/__tests__/behavioral-injection-guard.test.ts`):**
  - **The round-6/7 source-text scanner is a SHAPE assumption, not a behavior check — and round-8 review + an independent verifier both found the predicted hole:** `type-and-comment-choke-point-guard.test.ts` only ever inspects a `${...}` hole when it sits inside a SINGLE backtick template literal whose own content starts with `//`. A comment built any other way — `+`-concatenating a `//`-prefixed literal to a SECOND literal that does not itself start with `//` (a template split across multiple pieces, a block comment, a `.should()`/`.trigger()` string argument) — is invisible to it, because that second literal is never recognized as "comment-shaped" on its own even though it is concatenated onto the first at runtime and becomes part of the SAME logical `//` comment line in the generated file.
  - **New authoritative gate: `adapters/__tests__/behavioral-injection-guard.test.ts` — shape-independent by construction.** For every adapter (`cypress-e2e`, `playwright`, `api`) and every public spec-emitting entrypoint (`render`/`renderAll` on all three, plus `ApiAdapter.scaffoldApiTests`’s non-empty AND zero-endpoints branches), it sets EVERY raw externally-derived string field (`NeutralScenario.id/title/description/targetPath`, the `recipe-` tag suffix, every `TestStep.target/value/description` across all 12 actions with and without a target present, `DiscoveredEndpoint.path/sourceFile/summary`, `ApiSurface.repoPath`) to a sentinel embedding a raw CR, LF, U+2028 LINE SEPARATOR, and U+2029 PARAGRAPH SEPARATOR around a uniquely-tagged live-code marker (`INJECTED_MARKER_STATEMENT_<field>()`) plus a Cypress `{enter}` special-sequence token. It then runs the REAL adapter and parses the REAL generated output with the TypeScript compiler (`typescript`, already a direct `@qulib/core` dependency), asserting the marker never resolves to a live `Identifier`/`CallExpression` AST node anywhere in the output (only a collapsed comment or a `JSON.stringify`-escaped string literal may contain it) and that no `.type(...)` string argument carries an un-escaped Cypress `{`. This checks what the generated file IS, not how the source that produced it was shaped — immune to the next reformatting of the same bug.
  - **The behavioral guard immediately caught a REAL leak the source-scanner had never seen, in already-shipped code:** `cypress-e2e-adapter.ts`'s `key-press` "outside Cypress's whitelist" warning comment is built from THREE backtick literals joined by `+`; only the first starts with `//`, so the round-7 scanner never inspected the second/third, where `${t}` (the selector) and two `${JSON.stringify(key)}` calls sat unsanitized. `JSON.stringify` is safe for a REAL generated string literal (it escapes a raw newline to the two-character `\n` sequence) but this text is comment DECORATION, not an actual string literal in the output — and critically, `JSON.stringify` does NOT escape U+2028/U+2029 at all (they became legal raw content inside a genuine JS string literal as of ES2019, so it has no reason to), so a `step.value`/`step.target` containing either code point sailed straight through and terminated the `//` comment in the generated file exactly like a raw CR/LF would, leaking the rest of the warning text as live, uncommented code. Fixed by routing both `key` and `step.target` through `sanitizeForComment` FIRST, before `JSON.stringify`, at all four sites in that comment.
  - **The source-text scanner is KEPT as a fast, cheap lint** — it still fails fast on the shapes it can see — but the behavioral guard is now the AUTHORITATIVE gate against this injection class, and includes a "prove the gate has teeth" self-test that feeds it a synthetic reproduction of the exact `+`-concatenation bypass (never routed through any real adapter) and asserts it is caught by OUTPUT shape alone.
  - See `packages/core/README.md` § "Journey interchange (Chrome DevTools Recorder)" → "Honesty guardrails" for the user-facing description.

---

## [0.14.0] — 2026-07-02

### Added

- **Per-session rate limit on the LLM-as-judge tools (cost/DoS hardening):** `qulib_score_bug_report` and `qulib_score_decisions` now apply a lightweight, dependency-free, in-process per-session call limiter before any scoring work. Per-field Zod length caps already stop single-call abuse, but a programmatic/direct MCP client could fire either judge tool in a tight loop and drain the deployer's Anthropic API quota. The default budget is 60 calls/minute per session, configurable via `QULIB_JUDGE_MAX_CALLS_PER_MIN` (set to `0` to disable). When exceeded, the handler returns a structured `QULIB_RATE_LIMITED` tool error with a retry hint (no exception, no stack trace) instead of invoking the LLM. Uses a fixed-window counter keyed by MCP session id (stdio shares a single window). Flagged MEDIUM in two security reviews.

### Security

- **MCP error responses no longer leak server stack traces by default:** `toolError` details previously echoed `err.stack`, which discloses the server's absolute filesystem paths. Stack details are now suppressed unless `QULIB_EXPOSE_ERROR_DETAIL=1` is set (opt-in for local debugging), applied pattern-wide across all MCP tool handlers via the new `safeErrorDetail()` helper.
- **LLM-as-judge prompt hardening (defense-in-depth):** the fixed rubric / security instructions for `qulib_score_bug_report` and `qulib_score_decisions` now live in the Anthropic `system:` role, so untrusted learner-report / fork-log text (which stays in the `user:` turn) cannot override the rubric, scoring scale, or output format. Adds an optional `system` field to the LLM provider interface; the bug-report judge also gains the delimiter-token neutralizer for parity with the decision and spec-conformance judges.

### Changed

- **chore(ci):** add cancel-in-progress concurrency to `ci`, `security`, and `qulib-action-selftest` workflows.
- **Honest LLM fallback note:** `qulib score-decisions`, `qulib score-bug-report`, and `qulib validate` now print a one-line note to **stderr** when the LLM judge was requested (a key is present, and where applicable `--enable-llm-judge` was passed) but every result came back deterministic — i.e. the LLM call failed (out of API credits, network, or model). The legitimate "no `ANTHROPIC_API_KEY` → deterministic" case is unchanged and is **not** warned about. `--json` stdout stays pure (the note goes to stderr).

---

## [0.13.0] — 2026-06-27

### Added

- **`qulib validate` CLI + `qulib_validate_spec` MCP tool — spec-grounded validation:** Grade whether a deployed app's OBSERVED behavior conforms to a SUPPLIED spec (PRD / requirements file). Not "does it crash" — "does it match intent." `--spec <file>` parses a text/markdown requirements file; `--report <file>` or `--url` supplies the observed evidence. Without `--enable-llm-judge` (or no `ANTHROPIC_API_KEY`), all requirements return `conforms=unknown` and `verdict=insufficient-evidence` — honest, never fabricating verdicts. With the LLM judge enabled, each requirement is graded individually by the pinned haiku judge; both requirement text and observed summary are treated as untrusted input: wrapped with `delimitUntrusted()` and run through the delimiter-neutralizer (collapse `<<<` / `>>>` runs to `‹‹‹` / `›››`) before entering the prompt, preventing prompt-injection escape from the untrusted block. `--fail-on-violation` exits 1 on `violates` or `partial`; `insufficient-evidence` is not a violation. `--json` keeps stdout pure JSON (gate line to stderr). The MCP tool (`qulib_validate_spec`) follows the same security posture — input errors return a clean tool error without leaking a stack trace.
- **`qulib score-decisions`** — exposes the existing `scoreDecisions()` LLM-judge tool in the CLI. Reads a JSONL forks file (one `DecisionFork` per line) and emits per-fork `decisionQuality` (0..1), `seniorCorrect`, rationale, and aggregate means. Options: `--forks <file.jsonl>` (required), `--json`, `--enable-llm-judge`, `--min-quality <n>` (CI gate: exits non-zero when `aggregate.meanDecisionQuality < n`, prints `GATE: PASS|FAIL — <reason>`; gate line goes to stderr in `--json` mode).
- **`qulib score-bug-report`** — exposes the existing `scoreBugReport()` LLM-judge tool in the CLI. Reads a JSON file (`{ "report": {...}, "target": {...} }`) and emits `matched`, `matchConfidence`, a 4-part rubric (coverage/severity/repro/evidence, each 0–25), and feedback. Options: `--input <file.json>` (required), `--json`. Path is validated (regular file, ≤1 MiB); bad input prints a friendly one-line error with no raw ZodError stack. Falls back to deterministic scoring when `ANTHROPIC_API_KEY` is not set.

---

## [0.12.0] — 2026-06-27

### Added

- **CI release gate** on `qulib confidence`: `--fail-on <verdict>` exits non-zero when the verdict is at or worse than the threshold (`caution` | `hold` | `block`), and `--min-score <n>` exits non-zero when the 0–100 confidence score is below `n` (a `null` score — nothing evaluable — always fails). Prints a `GATE: PASS|FAIL — <reason>` line; in `--json` mode the gate line goes to stderr so stdout stays pure JSON. This wires the "should we ship?" verdict straight into a pipeline. The pure `evaluateConfidenceGate()` is exported for programmatic use.

---

## [0.11.0] — 2026-06-27

### Added

- **`qulib_score_bug_report`** — LLM-as-judge that grades a bug report against a planted-bug target: `matched` verdict, `matchConfidence`, a 4-part rubric (coverage / severity / repro / evidence), and actionable feedback. Falls back to deterministic scoring when no `ANTHROPIC_API_KEY` is set. The learner report is untrusted input and is prompt-injection hardened. Read-only.
- **`qulib_score_decisions`** — pivotal-decision evaluation: scores whether an autonomous agent made the senior-correct call at decision forks (gate block/pass, stop/continue, escalate/proceed) from a JSONL forks file. Returns per-fork `decisionQuality` (0–1), `seniorCorrect`, rationale, and aggregate means. Deterministic baseline by default; optional LLM refinement. `forksPath` is traversal-validated within `QULIB_FORKS_ALLOWED_ROOT` (default: process cwd).
- **Open-core boundary** documented in the README: the tool is fully open and local; calibrated benchmarks + cross-project signal + the hosted service are the gated tier.

### Security

- Decision-scoring path hardening (two adversarial review passes): reject a forks allowed-root of `/` and any symlink resolving to it (path-containment / LFI bypass), and neutralize forged untrusted-block delimiter tokens in fork text before the judge prompt (prompt-injection escape).

---

## [0.10.1] — 2026-06-27

### Fixed

- **Release confidence honesty notes:** Present-but-excluded evidence sources (`not_applicable`, `unknown`, null score) are now narrated before uncollected model sources so `maxListLength` truncation no longer drops notes that name collected sources.

---

## [0.10.0] — 2026-06-13

### Added

- **Per-page coverage heatmap in Markdown reports:** `report.md` now includes a `## Per-page coverage heatmap` section — a sorted table of scanned pages × coverage dimensions (`untested-route`, `a11y`, `console-error`, `broken-link`, `coverage`, `untested-api-endpoint`, `auth-surface`). Each cell shows the worst-severity gap for that page × dimension using an emoji intensity scale (🚨 critical · 🔴 high · 🟠 medium · 🟡 low · `·` none). Rows are sorted worst-first so the pages most in need of attention appear at the top. When no gaps are present the section is omitted entirely (no noise on clean runs). The two pure functions `buildPageHeatmap()` and `renderHeatmapSection()` — plus the `HEATMAP_DIMENSIONS` constant and `DIMENSION_LABELS` map — are exported from `@qulib/core` for programmatic use. Four golden-fixture test cases cover: empty gaps, multi-page mixed severities, a single page with all 7 dimensions populated, and worst-first sort order.

- **`qulib analyze-diff` — structured diff between two analyze_app outputs:** A new `qulib analyze-diff --from <report.json> --to <report.json>` command that compares two serialized `qulib analyze` outputs and produces a structured diff: added findings, removed findings, severity changes, and a confidence score delta. Emits Markdown by default (human-readable, suitable for CI job summaries and PR comments); `--json` emits a schema-valid `AnalyzeDiffResult` for scripted use. `--label-from` and `--label-to` attach human provenance labels to the report. The diff is a pure function of the two inputs — no disk state, no network, no LLM. Reuses the existing `BaselineDelta` schema and `compareBaselines()` logic; no second format is introduced. Golden eval cases added to `npm run eval` (new `analyze-diff` suite). `analyzeRunDiff()`, `formatAnalyzeDiffMarkdown()`, and `loadGapAnalysisFile()` exported from `@qulib/core`.

- **`qulib baseline` CLI — save, list, and compare (headline feature for 0.10):** Exposes the existing file-backed baseline store as a first-class CLI. `qulib baseline save --url <url> --from-report output/report.json` snapshots any `qulib analyze` run; `qulib baseline list --url <url>` shows all saved snapshots newest-first; `qulib baseline compare --url <url>` diffs the two most-recent snapshots and reports per-dimension drift — new gaps, resolved gaps, severity changes, and a confidence delta. Each changed item carries `path`, `category`, and `severity` so CI can attribute regressions to the exact dimension. `--from <id> --to <id>` lets you compare any two snapshots by explicit id. `--json` on all three commands emits machine-readable output for CI pipelines. Baselines are stored under `.qulib-baselines/` (local, gitignored); `--dir` overrides the storage root.

- **Naming convergence — 0.10 non-breaking aliases:** Confidence is the product; naming now converges on that truth without breaking any existing integration. Three legacy MCP tool names predate the `qulib_` prefix convention; they are now aliased under canonical forms: `qulib_analyze_app` (was `analyze_app`), `qulib_explore_auth` (was `explore_auth`), `qulib_detect_auth` (was `detect_auth`). Legacy names keep working unchanged. Two CLI commands gain aliases for integrations that prefer the full concept name: `qulib release-confidence` (alias for `qulib confidence`) and `qulib automation-score` (alias for `qulib score-automation`). All help text for the legacy names is annotated with the canonical form; all canonical help text notes the legacy alias. No deprecation warnings are emitted at runtime (notes in docs only). Removal is planned for 1.0. The `qulib_scaffold_tests` description is corrected: the `playwright` framework option is experimental and not yet implemented (it throws at runtime); the description no longer advertises it as working. The `explorer: 'cypress'` config field description now explicitly states it is not yet implemented and reserved for future use.

### Changed

- **MCP `qulib_scaffold_tests` description:** corrected to not advertise Playwright as a supported scaffold framework. The `cypress-e2e` default remains the only implemented option; `playwright` is now documented as experimental/unreleased.
- **Config schema `explorer` field:** description updated to note that `'cypress'` is reserved for future Cypress-driven exploration and throws at runtime. Always use `'playwright'` in production.

---

## [0.9.0] — 2026-06-10

This release promotes all work merged since v0.8.2 (PRs #92–#113). The headline fix is a broken installed CLI (any `npx @qulib/core` quickstart failed on published v0.8.2); the headline feature is the Release Confidence Layer — qulib can now answer "should we ship?" with a fused, multi-signal verdict.

### Fixed

- **Installed CLI bin shim (PR #109 — headline fix):** `npx @qulib/core analyze` and every other CLI command crashed with `ERR_MODULE_NOT_FOUND` on any published install of v0.8.2. The bin shim was pointing at the TypeScript source (`src/`) and running it via `npx tsx`, but `src/` is excluded from the published tarball and `tsx` is a devDependency. The shim now points at the compiled `dist/cli/index.js` and runs it with plain `node`. A companion fix ensures every packed or published tarball is guaranteed to contain a fresh `dist/` build (via a `prepack` script), and the config loader falls back gracefully when `qulib.config.ts` is not available under plain `node`.
- **CLI default-config fallback (PR #113):** Running `qulib analyze` from any directory without a `qulib.config.ts` file previously crashed with a config-not-found error. The CLI now starts with sensible built-in defaults when no config file is present, so the quickstart (`npx @qulib/core analyze --url https://example.com --ephemeral`) works with zero configuration. An explicit `--config` pointing at a missing file still produces a hard error.
- **`typescript` promoted to a runtime dependency:** `validate-specs.ts` (added in PR #102) imports the TypeScript compiler at module load time to validate generated specs. Because `typescript` was listed as a devDependency, the installed package was missing it and every CLI entry point crashed with `ERR_MODULE_NOT_FOUND` on a fresh install. Moving it to `dependencies` restores the correct runtime behaviour without changing any compile-time semantics.

### Added

- **Release Confidence Layer — `computeReleaseConfidence()` (PRs #95, #96, #97):** A new core function that folds multiple evidence sources (live-app scan, automation maturity, API coverage, CI results, PR metadata) into a single `ReleaseConfidence` output with a `ship` / `caution` / `hold` / `block` verdict. Includes `buildConfidenceInputFromQulib()` to adapt existing qulib outputs into evidence items (auth-required → unknown; blocked → blocking; honesty rules preserved), evidence collectors `ciResultsToEvidence()` and `prMetadataToEvidence()`, and a notquality dogfood example demonstrating a real 76/100 CAUTION verdict from live signals.
- **`qulib_score_confidence` MCP tool (PR #95):** A single MCP call that runs the full confidence pipeline — `analyzeApp` → `computeAutomationMaturity` → `computeApiCoverage` → confidence aggregation — and returns a schema-valid `ReleaseConfidence` with verdict. This is the flagship tool for AI agents that need a single authoritative "should we ship?" answer.
- **`qulib confidence` CLI command (PR #95):** Runs the same confidence pipeline from the command line. `--json` emits the full `ReleaseConfidence` envelope on stdout for CI or scripted use.
- **`qulib scaffold` and `qulib score-automation` CLIs (PR #92):** First-class command-line wrappers for the scaffold and automation-maturity APIs. `scaffold` supports the `cypress-e2e` and `playwright` adapters with `--json` for stdout output; `score-automation` renders `not_applicable` / `unknown` dimensions honestly with an applicable-dimensions-only normalized score.
- **Scaffold dry-run spec validation (PR #102):** `scaffoldTests()` now optionally transpiles every generated spec through the TypeScript compiler before returning it, surfacing generator bugs at scaffold time rather than when a developer first runs the suite. The CLI gains `--validate-specs` to make a validation failure a hard non-zero exit.
- **Reusable GitHub Actions analyze gate (PR #100):** A composite action (`.github/actions/qulib-analyze`) and a reusable workflow (`.github/workflows/qulib-analyze.yml`) that run `qulib analyze --agent-summary`, upload the JSON artifact, write a job summary, and map the gate verdict (`fail` / `warn` / `never`) to a CI exit code. Drop-in CI integration for any repo.
- **Evidence golden eval suite (PR #101):** A new `evidence` eval suite added to `npm run eval` that exercises the CI-results and PR-metadata adapters and the full confidence fusion path through `computeReleaseConfidence`. Closes the eval-coverage gap left after v0.8.2 (doctrine rule 11 — everything ships wrapped in evaluation).
- **Recipe toolshed (PR #93):** Four reusable `NeutralScenario` builders (`auth`, `a11y`, `nav`, `seed`) behind a `RecipeId` enum. `ScaffoldOptions` gains an additive `recipes?: RecipeId[]` parameter with recipe-aware rendering in both the Cypress and Playwright adapters.
- **Baseline monitor (PR #94):** A file-backed baseline store (`save` / `load` / `list` / `delete`) and `compareBaselines()` delta detection that identifies new, resolved, and severity-changed gaps between two snapshots. Full public surface exported from `@qulib/core`.
- **Publish guard (PR #99):** `prepublishOnly` build scripts added to root, `@qulib/core`, and `@qulib/mcp` so a local `npm publish` attempt always builds from a clean state rather than shipping stale or missing `dist/`. The pre-release gate script gains a pack-then-install smoke step that packs core into a tarball, installs it in a fresh directory, and asserts both `qulib --version` and `qulib --help` exit cleanly.

### Changed

- **New public exports from `@qulib/core`:** `computeReleaseConfidence`, `buildConfidenceInputFromQulib`, `ciResultsToEvidence`, `prMetadataToEvidence`, `compareBaselines` and related baseline store helpers, `RecipeId` / `RecipeIdSchema`, and the confidence / views schema types. All additions are additive — existing consumers are unaffected.
- **Multi-tenant eval ledger (PR #98):** Every `evals/ledger.jsonl` entry now carries a `tenantId` (from `TAP_TENANT_ID` env or `'default'`). Pre-existing entries read back as `legacy`.

### Chore

- **Repo hygiene (PR #110):** Removed four broken proposal workflow files (`.github/workflows/proposal-*.yml`) that called reusable workflows in a private repo and had 15/15 startup failures. Updated `CLAUDE.md` version references and `docs/source-map.md` to reflect shipped features.
- **Fresh-clone test reliability (PR #111):** Browser-dependent test suites (`analyze.fixtures.test.ts` and the fixture-server sub-suite in `scaffold.test.ts`) now detect Playwright Chromium availability at runtime and emit a clear skip message when the binary is absent or `PLAYWRIGHT_SKIP=1` is set. Pure-unit tests in those suites remain unconditional. CI coverage is unchanged.
- **Docs truth-up (PR #112):** READMEs for root, `@qulib/core`, and `@qulib/mcp` now accurately describe all seven MCP tools (led by `qulib_score_confidence`), all CLI commands including `scaffold`, `score-automation`, and `confidence`, and the correct quickstart (`npx @qulib/core confidence`). CI snippet refs pinned from `@v1` to `@v0.9.0`.

## [0.8.2] — 2026-06-01

### Added
- **@qulib/core:** repo-first API toolshed — `discoverApiSurface` (tiered, evidence-only discovery across OpenAPI/Swagger specs + Next/Express/Fastify/Hono/Nest routes), `computeApiCoverage` (new `api-test-coverage` dimension; the six existing dimensions rebalanced to sum 1.0; `untested-api-endpoint` gap category), and an `ApiAdapter` for supertest test generation.
- **@qulib/mcp:** `qulib_score_api` — repo → API discovery → contextual coverage score.

### Notes
- Backward-compatible: `computeAutomationMaturity(repo)` without an API surface is unchanged; existing scores are stable.

## [0.7.0] — 2026-05-30

### Added
- **@qulib/core:** `scaffoldTests(url, options?)` — crawls a URL via `analyzeApp`, renders
  `NeutralScenario[]` through the adapter layer, and returns `GeneratedTest[]` + `ProjectConfig`
  (ready-to-write `cypress.config.ts` / `playwright.config.ts` + `package.json` deps +
  support files). Framework: `cypress-e2e` (default) or `playwright`.
- **@qulib/core:** `CypressE2EAdapter.render()` fully implemented — handles all 10 `TestStep`
  action types: `navigate`, `click`, `type`, `assert-visible`, `assert-hidden`, `assert-text`,
  `assert-disabled`, `assert-count`, `wait`, `api-call`.
- **@qulib/mcp:** `qulib_scaffold_tests` tool — accepts `url` + optional `framework` +
  `maxPagesToScan`; returns `generatedTests` (array of `{filename, code, outputPath}`) and
  `projectConfig` so an agent can write the files directly to a repo with no manual test-writing.
- **@qulib/core exports:** `scaffoldTests`, `ScaffoldOptions`, `ScaffoldResult`, `ProjectConfig`
  re-exported from `@qulib/core` root.

## [0.6.0] — 2026-05-27

### Added
- **@qulib/core:** `toAgentSummary(result, policy?)` — a pure, no-I/O helper that projects an `AnalyzeResult` into a small versioned JSON shape (`schemaVersion: 1`) with `gate: 'pass' | 'warn' | 'fail'`, `coverageStatus`, `topRisks`, `recommendedNextChecks`, `honestyNotes`, `costSummary`, and `deterministicFollowUps`. Designed for orchestrators (CI gates, AI agents) that need a single small payload to decide whether a scan is good enough to ship. Conservative defaults — critical gaps, blocked status, or `auth-required` mode never silently pass.
- **@qulib/core CLI:** `qulib analyze --agent-summary` — emits the agent-summary JSON on stdout and writes nothing to disk. Mutually exclusive with `--ephemeral`.
- **@qulib/mcp:** `analyze_app` now accepts `agentSummary: true` to return the compact gate JSON instead of the summary-first envelope. Overrides `includeFullReport`.
- **docs:** `docs/agent-summary-output.md` — public spec for the shape, gate-derivation rules, policy overrides, and the `schemaVersion: 1` stability contract. Also adds the QLIB-001 PRD, implementation chunk plan, and design note.

## [0.5.3] — 2026-05-27

### Fixed
- **@qulib/core:** `detect-auth` no longer derives credential field names from placeholder example values. An email input with `placeholder="you@example.com"` and no `name` attribute previously produced a field name like `"youexamplecom"`; the fallback chain now prefers stable identifiers (`name` → `id` → `autocomplete` → input `type`) and guards placeholder/aria-label fallbacks against values containing `@` or `://`.

### Changed
- Example provider references in docs and tests updated to use notquality.com as the canonical demo target — qulib's own primary test surface.

## [0.5.2] — 2026-05-14

### Fixed
- **@qulib/core:** `detect-auth` now skips click-probe candidates that navigate to a non-login path after click (e.g. a marketing CTA that happens to lead to a sign-up form). Only paths whose post-click URL contains `/login`, `/sign-in`, `/auth`, `/sso`, or `/oauth` are treated as click-to-reveal auth forms. Eliminates false-positive automatable paths from homepage CTA buttons.
- **@qulib/core:** LLM scenario generation now receives each gap's real UUID in the prompt (prefixed `id:xxxx`) instead of a positional counter. Fixes `sourceGapIds` in generated scenarios returning `["1"]`, `["2"]` instead of actual gap UUIDs.

## [0.5.1] — 2026-05-14

### Fixed

- **@qulib/core:** `detect-auth` now probes `[role="button"]` elements in addition to `<button>` tags, and waits up to 5 s for a password field after navigation (was 2 s), so custom SSO providers that navigate to a dedicated login page are correctly detected.
- **@qulib/core:** `explore-auth` now click-probes user-local provider buttons (registered via `qulib auth providers add`) before classifying them as non-automatable OAuth. When clicking reveals a form, the path is returned as `automatable: true` with discovered field names and types.
- **@qulib/core:** `qulib auth login` now accepts `form-multi` paths (3+ fields such as username/password/district) and triggers click-reveal navigation for `user-local` source paths, completing the `qulib auth providers add` → `qulib auth login --auth-path <id>` workflow.

## [0.5.0] — 2026-05-14

### Added

- **PR #30** — local HTML fixtures + deterministic fixture server for offline integration baselines (`packages/core/fixtures/*`, `fixture-server.ts`, `analyze.fixtures.test.ts`).
- **PR #32** — offline CI smoke path using fixtures (`cli-smoke-fixture.ts`) plus a dedicated unit+fixture test job.
- **PR #33** — SKIP semantics now include actionable guidance on non-applicable/unknown automation maturity dimensions, with guidance surfaced in MCP compact summaries.
- **PR #31** — Claude 4 LLM scenario generation hardening: model default update, markdown fence stripping before JSON parse, and `--skip-auth-detection` CLI option.

### Changed

- `smoke-test-cli` CI workflow now runs offline against the local fixture server instead of a live `https://example.com` dependency.
- Core and MCP docs now include copy-paste walkthroughs for public/auth-blocked/authenticated flows, MCP tool mapping, and host env setup/troubleshooting.

### Fixed

- LLM scenario generation no longer fails silently on Claude 4 API keys due to a stale default model and fenced JSON parse path.

### Internal

- v0.5.0 **Runtime QA Intelligence Baseline** — Phase 1 complete.

## [0.4.3] — 2026-05-13

### Fixed

- **@qulib/core:** `qulib analyze` now validates the provided `--auth-storage-state` file **before** crawling. Invalid, missing, wrong-origin, or expired storage state produces an honest `status: 'blocked'` result with `releaseConfidence: 0`, `coverageScore: null`, and a structured `storage-state-invalid` gap explaining how to recover, instead of a misleading `releaseConfidence: 80`-style outcome from crawling 401 pages. The browser is never launched when the file is missing, unreadable, not JSON, or empty — those preflights are pure file checks.
- **@qulib/core:** `validateStorageState` now returns a stable reason code (`missing-file` · `unreadable-file` · `invalid-json` · `no-auth-cookies` · `wrong-origin` · `expired-or-unauthorized` · `unknown`) alongside the human-readable reason, so MCP clients and reports can branch on a fixed enum instead of free-text matching. Origin matching is strict — scheme + host + port must match exactly; subdomain, port, and protocol differences are all rejected.
- **@qulib/core:** `qulib auth login` now refuses to save a storage state when the browser ends the login flow on an origin different from `--base-url` (federated/SSO redirect that never returned to the app). Previously the storage state was saved on the IdP domain with only a soft warning, which caused later `analyze` runs to fail with 401s and (before the validator) misleading release confidence. The new failure message names both the expected and final origins and points the user at `qulib auth init` as the fallback.
- **@qulib/core:** Hardened CLI debug logging — `[qulib] Active config:` now redacts the form-login username as well as the password, and replaces the storage-state file path with `<provided>`. Recovery text in the `auth-block` and `storage-state-invalid` gaps now strips query strings and fragments from echoed URLs so a `?token=…` in `--url` cannot land in `report.md`, `report.json`, or `decision-log.json`.
- **@qulib/core:** New telemetry event `auth.storage-state.validated` (kind only) carrying `{ targetOrigin, valid, reasonCode, storageStateProvided }` — no file path, no cookies, no storage state contents. The existing `scan.blocked` event also carries the `reasonCode` when blocking on storage state validation.

### Changed

- **@qulib/core:** `evaluateStorageStateValidity` and `validateStorageState` now return `StorageStateValidationResult` (`{ valid, reasonCode, reason }`); the old `{ valid, reason }` fields are preserved so existing consumers keep working. A new `preflightStorageStateFile(path)` helper is exported for callers that want a fast file-shape check without launching a browser. `StorageStateInvalidReason` and `StorageStateValidationResult` are exported from `@qulib/core`.
- **@qulib/core:** New `buildStorageStateInvalidGap({ url, reasonCode, reason })` helper exported next to `buildAuthBlockGap`, used by `analyzeApp` and available to embedders building their own report renderers.

### Tests

- **@qulib/core:** Extended `auth-detector.test.ts` to assert every reason code on `evaluateStorageStateValidity` and `preflightStorageStateFile`, including strict-origin cases (`www`-subdomain, http-vs-https, differing port), unparseable final URLs, missing files, invalid JSON, empty storage state (cookies and localStorage both empty), localStorage-only storage state (still valid), and a POSIX-only `unreadable-file` case skipped on Windows/root.
- **@qulib/core:** New `analyze.storage-state-invalid.test.ts` wiring test asserts `analyzeApp` short-circuits to `status: 'blocked'` with `releaseConfidence: 0`, a `storage-state-invalid` gap, a `storage-state-invalid` decision-log entry, and an `auth.storage-state.validated` telemetry event — all without launching Playwright (uses a missing storage state path so the preflight short-circuits).
- **@qulib/core:** Extended `auth-block-gap.test.ts` with a per-reason-code recovery-text assertion for `buildStorageStateInvalidGap`.

### Docs

- **@qulib/core:** README "Scanning authenticated apps" section now documents the storage-state validator, the seven stable reason codes, the strict-origin rule, and the new `auth login` refusal-to-save behavior for federated flows that never return to the app origin.

## [0.4.2] — 2026-05-13

### Fixed

- **@qulib/core:** `qulib --version` now reads from `packages/core/package.json` instead of returning the hardcoded `0.1.0` left over from the initial Commander scaffold.
- **@qulib/core:** Automation maturity scoring no longer awards silent partial credit for absent capabilities. `component-test-ratio` is `not_applicable` when no Cypress is detected (previously defaulted to `50`). `auth-test-coverage` is `not_applicable` when the repo shows no auth routes, auth-named test files, or auth path coverage (previously hard-coded `25`). `test-id-hygiene` is `unknown` when no interactive TSX files were scanned (previously `100`); when applicable, it now scores on the missing-id **ratio** instead of a raw count.
- **@qulib/core:** `analyzeApp` reports now honor `HarnessConfig.outputDir`. Previously the `act` phase hard-coded `<cwd>/output` for `report.json` / `report.md` even when `outputDir` was set, despite the [0.4.0] entry claiming output directory support.
- **@qulib/core:** `qulib auth init` creates the parent directory of `--out` before saving the storage state (parity with `qulib auth login`). Previously a missing intermediate directory failed silently at write time.
- **@qulib/core:** Telemetry events no longer carry full URLs with query strings or fragments. `scan.started`, `phase.observe.started`, and the observe-phase decision log entry pass URLs through `redactUrlForTelemetry`, so secrets embedded in `?token=…` cannot leak via `QULIB_TELEMETRY_STDERR=1`. The exported helper accepts only `http:` and `https:` URLs and emits `protocol://host/pathname` (any `user:pass@` userinfo is stripped from the host). For all other inputs — non-URL strings, `mailto:`, `data:`, `file:`, `javascript:`, and other schemes the WHATWG URL parser accepts but that may carry secret-shaped right-hand sides — it returns the literal string `'[redacted-non-url]'` rather than echoing the input.
- **@qulib/mcp:** MCP server registration version follows the package version instead of being pinned at `0.4.1`.
- **@qulib/mcp:** `analyze_app` compact response replaces the full `repoInventory` (which contained unbounded `testFiles` and `missingTestIds` arrays) with a bounded `repoInventorySummary` of counts + framework verdict. The full `repoInventory` is still returned when `includeFullReport: true`.

### Changed

- **@qulib/core:** `AutomationMaturityDimension` schema gained optional `applicability` (`applicable` | `not_applicable` | `unknown`) and `reason` fields; `AutomationMaturity` gained an optional `scoreFormula` describing the normalization. The overall score is now computed as `round( Σ score·weight / Σ weight )` across applicable dimensions only, so absent or unknown signals cannot drag the headline number down. Changes are additive; existing consumers that don't read the new fields keep working.
- **@qulib/core:** `RepoAnalysis` gained an optional `interactiveTsxFilesScanned` counter that powers the honest test-id hygiene ratio.
- **@qulib/core:** New `resolveReportDir(outputDir?)` helper exported next to `resolveScanStateBaseDir`. When `HarnessConfig.outputDir` is set, both scan state and reports share that directory (state and report file names do not overlap); when unset, reports default to `<cwd>/output` and state defaults to `<cwd>/.scan-state` (legacy behavior).
- **@qulib/core:** New `redactUrlForTelemetry(url)` helper exported from the public API for embedding apps that build their own `TelemetrySink`.

### Tests

- **@qulib/core:** Added `automation-maturity.test.ts` covering the `applicable` / `not_applicable` / `unknown` branches for each dimension and the applicable-only overall normalization.
- **@qulib/core:** Added `cli-version.test.ts` asserting `qulib --version` matches `packages/core/package.json`.
- **@qulib/core:** Added `state-manager.test.ts` covering `resolveReportDir` defaults and the shared-dir contract when `outputDir` is set.
- **@qulib/core:** Added `redact-url.test.ts` covering query/fragment stripping and graceful fallback for non-URL inputs.
- **@qulib/mcp:** Extended `compact-analyze-payload.test.ts` to assert the compact payload never carries the raw `testFiles` or `missingTestIds` arrays and that `includeFullReport: true` still ships the full `repoInventory`.

### Docs

- **@qulib/mcp:** README tools list now documents `qulib_score_automation`, including the `applicability` field on each dimension and the applicable-only normalization. Compact vs full response table updated to call out the new `repoInventorySummary`.
- **@qulib/mcp:** Code comment on the MCP `auth` schemas documents the intentional flat shape vs core's nested `AuthConfigSchema` and the 1:1 translation contract.

## [0.4.1] — 2026-05-13

### Added

- **@qulib/core:** Optional `authOptions` on `DetectedAuth` (each entry is an `AuthPath`); `detectAuth` probes up to four non–IdP `<button>` labels for click-to-reveal username/password flows (and visible `<select>` fields such as District), then restores the login URL between probes.

### Fixed

- **@qulib/core:** `detectAuth` matches OAuth IdP buttons against `BUILT_IN_OAUTH_PROVIDERS` (including Clever, ClassLink, and other built-ins) instead of a short hard-coded list; single-word labels that match a built-in provider name are accepted; SSO-shaped buttons that do not match any built-in pattern are still surfaced as `provider: 'unknown'` in `oauthButtons`.
- **@qulib/core:** Click-to-reveal `authOptions` credential fields now include every visible text/email/password input and `select` (with labels from associated `<label>`, placeholder, aria-label, or name); auth-surface analysis no longer flags “OAuth-only” when `authOptions` includes a `form-login` path (emits a low-severity informational gap instead).

## [0.4.0] — 2026-05-12

### Added

- **@qulib/core:** `LlmProvider` abstraction with `AnthropicProvider` and `createProvider()`; `HarnessConfig` fields `llmProvider`, `llmModel`, `outputDir`, and `scoringWeights`.
- **@qulib/core:** Telemetry hooks (`TelemetrySink`, `emitTelemetry`, `NoopTelemetrySink`) and optional `telemetry` / `telemetrySessionId` on scan artifact options; phase and LLM lifecycle events.
- **@qulib/core:** Repo `framework` detection and `automationMaturity` scoring on `RepoAnalysis`; exports `scanRepo`, `computeAutomationMaturity`, `resolveScanStateBaseDir`.
- **@qulib/mcp:** `qulib_score_automation` tool; structured `QULIB_*` tool errors; optional `QULIB_TELEMETRY_STDERR=1` NDJSON telemetry on stderr; `automationMaturitySummary` in compact `analyze_app` payloads when repo data includes maturity.

### Changed

- **@qulib/core:** `callLLM` delegates to the provider registry; `computeQualityScoreFromGaps` honors optional severity weights (defaults unchanged).
- **@qulib/core:** `StateManager` and decision log paths respect `config.outputDir` (default remains `.scan-state` under cwd).
- **@qulib/mcp:** Migrated to `McpServer` + `registerTool`; server metadata includes description and version aligned with the package.

### Fixed

- **@qulib/mcp:** Deprecated low-level `Server` usage removed in favor of the supported MCP SDK high-level API.

## [0.3.1] — 2026-05-12

### Fixed

- **@qulib/core / @qulib/mcp:** Normalize `bin` paths for reliable npm installs on all platforms ([#21](https://github.com/TapeshN/qulib/pull/21)).

## [0.3.0] — 2026-05-12

### Added

- **@qulib/core:** Cost intelligence for LLM usage (token summaries, budget warnings, deterministic maturity hints, conversion recommendations).
- **@qulib/core:** Auth-wall handling with public-surface analysis, coverage score behavior, and flatter gap reporting for blocked/partial scans.
- **@qulib/mcp:** Stderr progress logger and optional `AnalyzeProgressSink` for `analyze_app`.
- **@qulib/core:** `npm run smoke` script for ephemeral `example.com` analyze.

### Changed

- LLM budget field naming clarified (`llmMaxOutputTokensPerCall` vs legacy `llmTokenBudget`); MCP default responses stay summary-first; cost doctor and docs updates.

### Fixed

- **@qulib/mcp:** Build `@qulib/core` before `tsc`; stricter typing for progress logging.

### Chore

- Live `analyzeApp` integration tests and coverage-score TODO follow-ups.

## [0.2.2] — 2026-05-12

### Added

- **@qulib/core / MCP:** `explore_auth` (multi-path auth exploration, curated + heuristic providers, user-local `~/.qulib/providers.json` registry) ([#15](https://github.com/TapeshN/qulib/pull/15)).

## [0.2.1] — 2026-05-11

### Fixed

- Clear error when Playwright Chromium is not installed; auth detector waits for hydration ([#13](https://github.com/TapeshN/qulib/pull/13)).

## [0.2.0] — 2026-05-11

### Added

- **CLI:** `detect-auth` / auth detection pipeline and **`qulib auth init`** for OAuth/SSO-style flows (storage state capture) ([#10](https://github.com/TapeshN/qulib/pull/10)).
- Manual testing checklist for CLI, auth, and MCP (linked from README).

## [0.1.1] — 2026-05-11

### Fixed

- **Explorer:** Same-site link discovery handles `www` vs apex hostnames ([#8](https://github.com/TapeshN/qulib/pull/8)).

### Chore

- Community onboarding (issue/PR templates, code of conduct, contributing).
- Root `package.json` repository metadata; publish-readiness README and dry-run verification.
