export { analyzeApp } from './analyze.js';
export {
  slugifyUrl,
  defaultBaselineRoot,
  saveBaseline,
  loadBaseline,
  listBaselines,
  deleteBaseline,
  compareBaselines,
} from './baseline/baseline.js';
export type {
  BaselineGap,
  BaselineSnapshot,
  BaselineDeltaItem,
  BaselineDelta,
} from './baseline/baseline.schema.js';
export { toAgentSummary } from './agent-summary.js';
export type {
  AgentSummary,
  AgentSummaryPolicy,
  AgentGate,
  CoverageStatus,
  AgentSummaryCostSummary,
} from './agent-summary.js';
export {
  detectAuth,
  validateStorageState,
  evaluateStorageStateValidity,
  preflightStorageStateFile,
  waitForReturnToOrigin,
} from './tools/auth/detect.js';
export type {
  StorageStateInvalidReason,
  StorageStateValidationResult,
} from './tools/auth/detect.js';
export { exploreAuth } from './tools/auth/explore.js';
export { addUserProvider, removeUserProvider, listUserProviders } from './tools/auth/custom-providers.js';
export { scanRepo } from './tools/repo/scan.js';
export { discoverApiSurface, discoverApiSurfaceWithRepo } from './tools/repo/api-surface.js';
export type { ApiSurface, DiscoveredEndpoint, DiscoverApiSurfaceOptions } from './tools/repo/api-surface.js';
export { computeAutomationMaturity } from './tools/scoring/automation-maturity.js';
export { computeApiCoverage } from './tools/scoring/api-coverage.js';
export type { ApiCoverageResult, ApiEndpointCoverage } from './tools/scoring/api-coverage.js';
export { scaffoldTests } from './scaffold-tests.js';
export type { ScaffoldOptions, ScaffoldResult, ProjectConfig } from './scaffold-tests.js';
export { expandRecipes, buildAuthScenarios, buildA11yScenarios, buildNavScenarios, buildSeedScenarios } from './recipes/index.js';
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
  RecipeId,
  RecipeConfig,
} from './schemas/index.js';
export { RecipeIdSchema } from './schemas/index.js';
