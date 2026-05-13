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
