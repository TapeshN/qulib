import type { AuthPath } from '../schemas/config.schema.js';

export function assertExactlyOneCredentialSource(credentials?: string, credentialsFile?: string): void {
  const hasC = Boolean(credentials && String(credentials).trim().length > 0);
  const hasF = Boolean(credentialsFile && String(credentialsFile).trim().length > 0);
  if (hasC && hasF) {
    throw new Error('Provide either --credentials or --credentials-file, not both.');
  }
  if (!hasC && !hasF) {
    throw new Error('One of --credentials or --credentials-file is required.');
  }
}

export function parseCredentialsJsonString(json: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON in --credentials');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--credentials must be a JSON object mapping field name → value.');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (v === undefined || v === null) {
      throw new Error(`Credential value for "${k}" cannot be null or undefined.`);
    }
    out[k] = String(v);
  }
  return out;
}

export function resolveFormLoginPath(baseUrl: string, authOptions: AuthPath[] | undefined, authPathId?: string): AuthPath {
  const formPaths = (authOptions ?? []).filter(
    (o) => (o.type === 'form-login' || o.type === 'form-multi') && o.requirements.method === 'credentials'
  );
  if (formPaths.length === 0) {
    throw new Error(
      `No automatable form-login path detected on ${baseUrl}. Use \`qulib auth init\` for manual login.`
    );
  }
  if (formPaths.length === 1) {
    return formPaths[0]!;
  }
  if (!authPathId || !authPathId.trim()) {
    const ids = formPaths.map((p) => p.id).join(', ');
    throw new Error(`Multiple form-login options found: ${ids}. Re-run with --auth-path <id>.`);
  }
  const found = formPaths.find((p) => p.id === authPathId.trim());
  if (!found) {
    const ids = formPaths.map((p) => p.id).join(', ');
    throw new Error(`No form-login authOption with id "${authPathId}". Available: ${ids}.`);
  }
  return found;
}

export function assertCredentialsCoverFields(credentials: Record<string, string>, path: AuthPath): void {
  if (path.requirements.method !== 'credentials') {
    throw new Error('Internal error: expected credentials requirements on form-login path.');
  }
  const missing: string[] = [];
  for (const f of path.requirements.fields) {
    if (!(f.name in credentials) || credentials[f.name] === '') {
      missing.push(f.name);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing credential value(s) for field name(s): ${missing.join(', ')}`);
  }
}

export function resolveAuthLoginConfig(params: {
  baseUrl: string;
  authOptions: AuthPath[] | undefined;
  credentials: Record<string, string>;
  authPathId?: string;
}): { path: AuthPath } {
  const path = resolveFormLoginPath(params.baseUrl, params.authOptions, params.authPathId);
  assertCredentialsCoverFields(params.credentials, path);
  return { path };
}
