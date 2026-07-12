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
