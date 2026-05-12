export { analyzeApp } from './analyze.js';
export { detectAuth } from './tools/auth-detector.js';
export { exploreAuth } from './tools/auth-explorer.js';
export { addUserProvider, removeUserProvider, listUserProviders } from './tools/user-providers.js';
export type { AnalyzeOptions, AnalyzeResult } from './analyze.js';
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
} from './schemas/index.js';
