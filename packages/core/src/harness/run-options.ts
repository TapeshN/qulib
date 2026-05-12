import type { DecisionLogEntry } from '../schemas/decision-log.schema.js';
import type { AnalyzeProgressSink } from './progress-log.js';

export type RunArtifactsOptions = {
  writeArtifacts: boolean;
  decisionMemory?: DecisionLogEntry[];
  progressLog?: AnalyzeProgressSink;
};
