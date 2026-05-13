import type { Gap } from '../../schemas/gap-analysis.schema.js';
import type { StorageStateInvalidReason } from './detector.js';

function safeOriginAndPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function buildAuthBlockGap(url: string): Gap {
  const host = safeHost(url);
  const safeUrl = safeOriginAndPath(url);
  return {
    id: 'auth-block',
    path: '/',
    severity: 'critical',
    category: 'coverage',
    reason: `Scan blocked by authentication. No authenticated pages were evaluated for ${host}.`,
    description: 'Scan blocked by authentication. 0 authenticated pages were evaluated.',
    recommendation: `Run \`qulib auth init --base-url ${safeUrl}\` to capture a storage state, then re-run with --auth storage-state.`,
  };
}

export function buildStorageStateInvalidGap(input: {
  url: string;
  reasonCode: StorageStateInvalidReason;
  reason: string;
}): Gap {
  const host = safeHost(input.url);
  const safeUrl = safeOriginAndPath(input.url);
  const recoveryByCode: Record<StorageStateInvalidReason, string> = {
    'missing-file': `Storage state file was not found. Run \`qulib auth login --base-url ${safeUrl} --out <path>\` (or \`qulib auth init\`) to capture a fresh state, then re-run \`qulib analyze --url ${safeUrl} --auth-storage-state <path>\`.`,
    'unreadable-file': `Storage state file exists but could not be read. Check file permissions, then re-run \`qulib auth login\` if needed.`,
    'invalid-json': `Storage state file is not valid JSON. Run \`qulib auth login --base-url ${safeUrl} --out <path>\` again to regenerate it.`,
    'wrong-origin': `Storage state belongs to a different origin than ${host}. Re-run \`qulib auth login --base-url ${safeUrl}\` against this target and pass the new file to \`qulib analyze\`.`,
    'expired-or-unauthorized': `The session in the storage state has expired or is unauthorized. Run \`qulib auth login --base-url ${safeUrl}\` to capture a fresh state, then re-run \`qulib analyze --url ${safeUrl} --auth-storage-state <path>\`.`,
    'no-auth-cookies': `Storage state file contains no cookies or localStorage entries — it is effectively empty. Run \`qulib auth login --base-url ${safeUrl}\` to capture a real session.`,
    unknown: `Storage state could not be validated. Try \`qulib auth login --base-url ${safeUrl}\` again, and verify the file was saved on the same origin.`,
  };
  return {
    id: 'storage-state-invalid',
    path: '/',
    severity: 'critical',
    category: 'coverage',
    reason: `Authenticated scan could not continue because the provided storage state is invalid for ${host}. Reason: ${input.reasonCode} — ${input.reason}.`,
    description: `Storage state validation failed before crawling. The session was checked against ${host} and rejected with reason code "${input.reasonCode}".`,
    recommendation: recoveryByCode[input.reasonCode],
  };
}
