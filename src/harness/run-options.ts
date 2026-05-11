import type { DecisionLogEntry } from '../schemas/decision-log.schema.js';

export type RunArtifactsOptions = {
  writeArtifacts: boolean;
  decisionMemory?: DecisionLogEntry[];
};
