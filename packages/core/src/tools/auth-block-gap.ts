import type { Gap } from '../schemas/gap-analysis.schema.js';

export function buildAuthBlockGap(url: string): Gap {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();
  return {
    id: 'auth-block',
    path: '/',
    severity: 'critical',
    category: 'coverage',
    reason: `Scan blocked by authentication. No authenticated pages were evaluated for ${host}.`,
    description: 'Scan blocked by authentication. 0 authenticated pages were evaluated.',
    recommendation: `Run \`qulib auth init --base-url ${url}\` to capture a storage state, then re-run with --auth storage-state.`,
  };
}
