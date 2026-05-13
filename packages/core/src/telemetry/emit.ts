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
 * Returns `origin + pathname` only. If the input is not a valid URL, returns the
 * original string (telemetry should never throw on malformed inputs).
 */
export function redactUrlForTelemetry(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
