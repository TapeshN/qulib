/**
 * Cypress's `.type()` special-character-sequence whitelist — the ONLY keys
 * `.type()` can express via `{token}` syntax. `.type("{tab}")` is not a
 * general "press this key" primitive: Cypress validates the token against
 * this exact table and throws `CypressError: {tab} is not a supported key`
 * (or the closest variant for the given Cypress version) for anything
 * outside it — "Tab" is the most common real-world miss, since Recorder
 * emits it constantly for form flows but Cypress has never supported it via
 * `.type()` (the documented workaround is `cy.realPress('Tab')` from the
 * `cypress-real-events` plugin, or a `.trigger('keydown', …)` custom command).
 *
 * Keyed by the `KeyboardEvent.key` value Chrome DevTools Recorder emits for
 * a `keyDown` step (e.g. "Enter", "ArrowDown") so a caller can look up
 * directly by Recorder's own `key` field; values are the bare Cypress token
 * (no surrounding braces — callers wrap with `toCypressTypeToken`).
 *
 * This is a single source of truth shared by two consumers that must never
 * drift apart: `tools/journeys/recorder-import.ts` (to decide whether a
 * `keyDown` step's key can be warned about at CONVERSION time) and
 * `cypress-e2e-adapter.ts` (to decide whether a `key-press` TestStep can be
 * rendered as real `.type("{token}")` syntax at RENDER time, vs. a safe
 * non-throwing comment for a key Cypress cannot express this way).
 *
 * Re-derived from Cypress's own public "Table of Special Character
 * Sequences" documentation for `.type()` — no proprietary or copied source.
 */
export const CYPRESS_SPECIAL_KEY_MAP: Readonly<Record<string, string>> = {
  Enter: 'enter',
  Escape: 'esc',
  Backspace: 'backspace',
  Delete: 'del',
  ArrowDown: 'downarrow',
  ArrowUp: 'uparrow',
  ArrowLeft: 'leftarrow',
  ArrowRight: 'rightarrow',
  Home: 'home',
  End: 'end',
  PageDown: 'pagedown',
  PageUp: 'pageup',
  Insert: 'insert',
};

/** True when Cypress's `.type()` can faithfully express this key via `{token}` syntax. */
export function isCypressTypeableKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CYPRESS_SPECIAL_KEY_MAP, key);
}

/** Highest code point in the C0 control block (space, code point 32, is the first printable one). */
const LAST_C0_CONTROL_CODE = 31;
/** DEL — the one printable-range code point (127) that is still a control character, not a glyph. */
const DEL_CODE = 127;

/**
 * True when `key` is a single printable character — a letter, digit,
 * punctuation mark, symbol, or space (ASCII or Unicode) — that Cypress's
 * `.type()` renders FAITHFULLY as a literal (unbraced) character, e.g.
 * `.type("a")`, `.type("1")`, `.type("?")`, `.type(" ")`. This is DISTINCT
 * from `isCypressTypeableKey`, which covers multi-character key NAMES
 * ("Enter", "Tab", …) expressed via `{token}` special-sequence syntax — a
 * single printable character is never one of Recorder's `{token}` names
 * (Recorder emits key NAMES like "Enter" for those, never the literal
 * string "e"), so the two predicates are mutually exclusive in practice.
 *
 * ROUND-5 FIX: this used to gate on `key.length === 1` — a UTF-16 code-UNIT
 * count. A single astral-plane character (e.g. an emoji like "😀") is ONE
 * code point but TWO UTF-16 code units (a surrogate pair), so `key.length`
 * is 2 for it — the old check mis-routed a genuine single keypress into the
 * warned/un-typeable path even though Cypress's `.type()` renders it
 * faithfully (fails safe — an over-warn, not a broken spec — but still
 * wrong). `[...key]` iterates by CODE POINT (respects surrogate pairs), so
 * `[...key].length === 1` correctly recognizes a single astral character as
 * one printable character. `KeyboardEvent.key` values for control keys such
 * as Backspace/Delete/Escape are always multi-character NAMES (code-point
 * length > 1), but this stays defensive against a hypothetical
 * single-code-point control code slipping through — hence the explicit
 * code-point-value check (C0 control block + DEL) below, rather than a bare
 * length check.
 */
export function isSingleTypeableCharacter(key: string): boolean {
  const codePoints = [...key];
  if (codePoints.length !== 1) return false;
  const codePoint = codePoints[0]?.codePointAt(0);
  if (codePoint === undefined) return false;
  return codePoint > LAST_C0_CONTROL_CODE && codePoint !== DEL_CODE;
}

/**
 * THE single choke-point for making an arbitrary string safe inside
 * Cypress's `.type()` DSL. Cypress's `.type()` treats `{` as the OPENING
 * delimiter of a `{token}` special-sequence (see `CYPRESS_SPECIAL_KEY_MAP`
 * above) — ANY unescaped `{` anywhere in a `.type()` argument makes Cypress
 * try to parse a token starting there. Per Cypress's own documented escape
 * (its "Table of Special Character Sequences" page), a literal `{` is
 * written as `"{{}"` — the doubled brace closes as its own one-character
 * token that types a single `{`.
 *
 * ROUND-6 FIX (closing the class STRUCTURALLY, not one site at a time):
 * rounds 2-5 only ever escaped a `{` when it was the ENTIRE key-press value
 * (`key === '{'`, one printable character). That left the much more common
 * "type" TestStep path — arbitrary recorded text interpolated verbatim into
 * `cy.get(t).type(v)` — completely unescaped, with two reproducible failure
 * modes: (a) THROW — a value like `"template: {editor}"` makes Cypress throw
 * `CypressError: Special character sequence: {editor} is not recognized` at
 * real runtime; (b) SILENT MISCONVERT, which is worse — ordinary text like
 * `"press {enter} to search"` gets Cypress to type "press ", fire a REAL
 * Enter keypress (submitting a form / navigating), then type " to search",
 * with no error at all. Both are the same underlying bug: escaping only a
 * whole-string equality check instead of every `{` occurrence ANYWHERE in
 * the string. `escapeCypressType` fixes that generally — it is now the ONE
 * function every `.type()` call site in this adapter must route through,
 * whether the value is a single key-press character or an arbitrary
 * multi-character recorded string. `escapeCypressTypeLiteral` below is kept
 * only as a thin backward-compatible alias so existing call sites/tests
 * naming it keep working — there is only ONE escaping algorithm now.
 *
 * No other character needs escaping. In particular `"}"` does NOT need
 * escaping: Cypress's parser only starts looking for a token when it sees
 * an UNESCAPED `{`, so a bare `}` with no preceding `{` is never treated as
 * closing (or otherwise special-casing) anything — it passes through
 * `.type()` as a plain literal character, matching Cypress's docs (only `{`
 * appears in the escape table, `}` does not).
 */
export function escapeCypressType(value: string): string {
  return value.replace(/\{/g, '{{}');
}

/**
 * @deprecated Thin alias for `escapeCypressType` — kept only so the
 * pre-round-6 name (and any code/tests still importing it) keeps working.
 * Do NOT add new call sites against this name; use `escapeCypressType`
 * directly so there is exactly ONE escaper name for reviewers/the guard
 * test to look for.
 */
export function escapeCypressTypeLiteral(key: string): string {
  return escapeCypressType(key);
}

/**
 * Render a keyboard key as Cypress `.type()` special-sequence syntax, e.g.
 * `"Enter"` -> `"{enter}"`. Caller MUST check `isCypressTypeableKey(key)`
 * first — this throws for a key outside the whitelist rather than emitting
 * a token Cypress would reject at runtime anyway.
 */
export function toCypressTypeToken(key: string): string {
  if (!isCypressTypeableKey(key)) {
    throw new Error(`"${key}" is not in Cypress's .type() special-sequence whitelist`);
  }
  return `{${CYPRESS_SPECIAL_KEY_MAP[key]}}`;
}
