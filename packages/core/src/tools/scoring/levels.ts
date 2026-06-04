/**
 * Shared score-to-level ladder used by qulib scorers.
 *
 * Used by `computeAutomationMaturity` and `computeReleaseConfidence` so
 * the L1–L5 numeric bands are consistent across all qulib scorers.
 * Each scorer can provide its own label suffix if needed; this function
 * provides the canonical L1–L5 numeric thresholds and default labels.
 *
 * L1 < 20 | L2 < 40 | L3 < 60 | L4 < 80 | L5 ≥ 80
 */
export function scoreLevel(overall: number): { level: number; label: string } {
  if (overall < 20) return { level: 1, label: 'L1 — nascent automation' };
  if (overall < 40) return { level: 2, label: 'L2 — emerging coverage' };
  if (overall < 60) return { level: 3, label: 'L3 — building maturity' };
  if (overall < 80) return { level: 4, label: 'L4 — strong automation' };
  return { level: 5, label: 'L5 — advanced QA automation' };
}
