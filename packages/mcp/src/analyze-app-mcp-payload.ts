import type { AnalyzeResult } from '@qulib/core';
import { toAgentSummary } from '@qulib/core';
import { summarizeAnalyzeResult } from './summarize-analyze-result.js';

export interface AnalyzeAppMcpPayloadOptions {
  includeFullReport?: boolean;
  /** When true, returns only `toAgentSummary(result)` JSON (QLIB-001). Ignores `includeFullReport`. */
  agentSummary?: boolean;
}

/**
 * Single place for analyze_app response shaping: default summary-first,
 * optional full report, or compact agent gate summary.
 */
export function buildAnalyzeAppMcpPayload(
  result: AnalyzeResult,
  input: AnalyzeAppMcpPayloadOptions
): unknown {
  if (input.agentSummary === true) {
    return toAgentSummary(result);
  }
  return summarizeAnalyzeResult(result, input.includeFullReport === true);
}
