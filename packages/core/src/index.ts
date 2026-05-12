export { analyzeApp } from './analyze.js';
export { detectAuth } from './tools/auth-detector.js';
export { exploreAuth } from './tools/auth-explorer.js';
export { addUserProvider, removeUserProvider, listUserProviders } from './tools/user-providers.js';
export { resolveMaxOutputTokensPerLlmCall } from './schemas/config.schema.js';
export type { AnalyzeOptions, AnalyzeResult, AnalyzeStatus } from './analyze.js';
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
} from './schemas/index.js';
