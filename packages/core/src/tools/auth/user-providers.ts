import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { OAuthProvider } from './oauth-providers.js';

const USER_PROVIDERS_PATH = join(homedir(), '.qulib', 'providers.json');

export interface SerializedProvider {
  id: string;
  label: string;
  patterns: string[];
}

export function loadUserProviders(): OAuthProvider[] {
  const raw = loadSerialized();
  return raw.map((p) => ({
    id: p.id,
    label: p.label,
    patterns: p.patterns.map((src) => new RegExp(src, 'i')),
  }));
}

export function addUserProvider(input: { id: string; label: string; pattern: string }): void {
  const existing = loadSerialized();
  const idx = existing.findIndex((p) => p.id === input.id);
  if (idx >= 0) {
    const p = existing[idx];
    if (!p.patterns.includes(input.pattern)) {
      p.patterns.push(input.pattern);
    }
    p.label = input.label;
  } else {
    existing.push({ id: input.id, label: input.label, patterns: [input.pattern] });
  }
  ensureDir();
  writeFileSync(USER_PROVIDERS_PATH, JSON.stringify(existing, null, 2), 'utf-8');
}

export function removeUserProvider(id: string): boolean {
  const existing = loadSerialized();
  const filtered = existing.filter((p) => p.id !== id);
  if (filtered.length === existing.length) {
    return false;
  }
  ensureDir();
  writeFileSync(USER_PROVIDERS_PATH, JSON.stringify(filtered, null, 2), 'utf-8');
  return true;
}

export function listUserProviders(): SerializedProvider[] {
  return loadSerialized();
}

function loadSerialized(): SerializedProvider[] {
  if (!existsSync(USER_PROVIDERS_PATH)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(USER_PROVIDERS_PATH, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as SerializedProvider[];
  } catch {
    return [];
  }
}

function ensureDir(): void {
  const dir = dirname(USER_PROVIDERS_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
