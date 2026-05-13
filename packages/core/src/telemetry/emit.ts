import type { TelemetryEvent, TelemetryEventKind, TelemetrySink } from './telemetry.interface.js';

export function emitTelemetry(
  sink: TelemetrySink | undefined,
  kind: TelemetryEventKind,
  sessionId: string,
  metadata: TelemetryEvent['metadata'],
  durationMs?: number
): void {
  if (!sink) return;
  sink.emit({
    kind,
    timestamp: new Date().toISOString(),
    sessionId,
    metadata,
    ...(durationMs !== undefined && { durationMs }),
  });
}

/**
 * Strip the query string and fragment from a URL before emitting it in telemetry.
 *
 * Telemetry must not carry credentials, share tokens, or any other secret-shaped
 * material that callers may embed in query strings (e.g. `?token=...`, `?key=...`).
 * Returns `origin + pathname` only for valid `http:` / `https:` URLs, and additionally
 * strips any `user:pass@` userinfo from the origin.
 *
 * If the input is not a valid `http(s)` URL, this helper returns the literal string
 * `'[redacted-non-url]'` rather than echoing the original input. Two reasons:
 *
 *  1. `new URL(...)` parses many `scheme:rest` shapes that are not real URLs
 *     (e.g. `mailto:`, custom `user:pass@host`, `data:`). Those still produce a
 *     non-empty `origin + pathname` and would echo the right-hand side back.
 *  2. The exported helper makes no assumption about caller provenance: a non-URL
 *     string passed in may itself be secret-shaped (a raw token, a path with
 *     embedded credentials, etc.), so the only safe fallback is to discard the
 *     value entirely.
 *
 * Telemetry never throws on malformed input.
 */
export function redactUrlForTelemetry(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '[redacted-non-url]';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '[redacted-non-url]';
  }
  // Strip any user:pass@ from the origin. `URL.origin` already omits userinfo,
  // but rebuilding from `protocol + host` makes the intent explicit and removes
  // any chance of credentials leaking through future Node URL changes.
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}
