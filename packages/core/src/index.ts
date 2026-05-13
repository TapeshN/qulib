export { analyzeApp } from './analyze.js';
export {
  detectAuth,
  validateStorageState,
  evaluateStorageStateValidity,
  preflightStorageStateFile,
  waitForReturnToOrigin,
} from './tools/auth-detector.js';
export type {
  StorageStateInvalidReason,
  StorageStateValidationResult,
} from './tools/auth-detector.js';
export { exploreAuth } from './tools/auth-explorer.js';
export { addUserProvider, removeUserProvider, listUserProviders } from './tools/user-providers.js';
export { scanRepo } from './tools/repo-scanner.js';
export { computeAutomationMaturity } from './tools/automation-maturity.js';
export { createProvider } from './llm/provider-registry.js';
export { resolveMaxOutputTokensPerLlmCall } from './schemas/config.schema.js';
export { resolveScanStateBaseDir, resolveReportDir } from './harness/state-manager.js';
export type { AnalyzeOptions, AnalyzeResult, AnalyzeStatus } from './analyze.js';
export type { AnalyzeProgressSink } from './harness/progress-log.js';
export type {
  TelemetrySink,
  TelemetryEvent,
  TelemetryEventKind,
} from './telemetry/telemetry.interface.js';
export { NoopTelemetrySink } from './telemetry/telemetry.interface.js';
export { redactUrlForTelemetry } from './telemetry/emit.js';
export type { LlmCallResult, LlmProvider } from './llm/provider.interface.js';
export type { CallLlmConfigSlice } from './llm/provider.js';
export type {
  HarnessConfig,
  AuthConfig,
  RouteInventory,
  GapAnalysis,
  RepoAnalysis,
  DetectedAuth,
  AuthExploration,
  AuthPath,
  AuthPathRequirements,
  CostIntelligence,
  LlmUsageRecord,
  RepeatedAiPattern,
  DeterministicMaturity,
  PublicSurface,
  AutomationMaturity,
  AutomationMaturityDimension,
  FrameworkDetectionResult,
  DetectedFrameworkPrimary,
} from './schemas/index.js';
