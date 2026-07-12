/**
 * Sanitize raw, externally-derived text (a Recorder-converted `TestStep`'s
 * `description`/`key`, or a `NeutralScenario`'s `description`/`id`/
 * `targetPath`) before interpolating it into a generated `//` LINE comment.
 *
 * A `//` comment in Cypress/Playwright/TypeScript source terminates at the
 * first line terminator. If raw text carrying an embedded CR/LF (or the two
 * Unicode line-terminator code points V8 also treats as line breaks, U+2028
 * LINE SEPARATOR / U+2029 PARAGRAPH SEPARATOR) is interpolated straight into
 * a `// ...` fallback line, the comment silently ends at that character and
 * everything the source text carries AFTER it becomes LIVE, UNCOMMENTED code
 * in the generated spec — a real code-injection risk for any caller that
 * feeds `importRecorderFlow`/an adapter a hand-edited or non-Recorder-
 * produced (i.e. untrusted) flow, since Recorder's own export never embeds
 * newlines in these fields but nothing upstream enforces that.
 *
 * This is a DISTINCT risk class from the `JSON.stringify(...)` interpolations
 * used for actual CODE elsewhere in the adapters (e.g. `cy.get(${t})`,
 * `.type(${JSON.stringify(key)})`) — those are already safe, because
 * `JSON.stringify` escapes a raw newline to the two-character sequence
 * `\n` *inside* a string literal, which cannot terminate anything. This
 * helper exists only for text going into a bare, unquoted `//` comment,
 * which has no such escaping.
 *
 * Replaces every run of line-terminator characters with a single space, so a
 * multi-line input still collapses to exactly one safe comment line — no
 * text is dropped, only visually joined.
 */
const LINE_TERMINATORS = /[\r\n\u2028\u2029]+/g;

export function sanitizeForComment(text: string): string {
  return text.replace(LINE_TERMINATORS, ' ');
}
