export type TelemetryEventKind =
  | 'scan.started'
  | 'scan.completed'
  | 'scan.blocked'
  | 'phase.observe.started'
  | 'phase.observe.completed'
  | 'phase.think.started'
  | 'phase.think.completed'
  | 'phase.act.started'
  | 'phase.act.completed'
  | 'llm.call.started'
  | 'llm.call.completed'
  | 'llm.call.failed'
  | 'gap.detected'
  | 'auth.detected'
  | 'repo.scanned';

export interface TelemetryEvent {
  kind: TelemetryEventKind;
  timestamp: string;
  sessionId: string;
  durationMs?: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
}

export const NoopTelemetrySink: TelemetrySink = {
  emit: () => {},
};
