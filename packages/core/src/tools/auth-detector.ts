import { resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { AuthPath, DetectedAuth } from '../schemas/config.schema.js';
import type { AnalyzeProgressSink } from '../harness/progress-log.js';
import { launchBrowser } from './browser.js';
import { BUILT_IN_OAUTH_PROVIDERS } from './oauth-providers.js';

export type StorageStateInvalidReason =
  | 'missing-file'
  | 'unreadable-file'
  | 'invalid-json'
  | 'wrong-origin'
  | 'expired-or-unauthorized'
  | 'no-auth-cookies'
  | 'unknown';

export interface StorageStateValidationResult {
  valid: boolean;
  reasonCode: StorageStateInvalidReason | 'ok';
  reason: string;
}

async function waitNetworkIdleBestEffort(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // best-effort — analytics or polling can prevent networkidle
  }
}

const PROVIDER_LABELS = new Set(BUILT_IN_OAUTH_PROVIDERS.map((p) => p.label.toLowerCase()));

function textLooksLikeOAuthIdpButton(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 120) {
    return false;
  }
  if (/\b(sign in with|log in with|continue with|sign up with)\b/i.test(t)) {
    return true;
  }
  // Accept single-word / short labels that exactly match a known provider name
  if (PROVIDER_LABELS.has(t.toLowerCase())) {
    return true;
  }
  return false;
}

const MAGIC_LINK_PATTERNS = [
  /email me a (sign[- ]?in )?link/i,
  /sign in with email/i,
  /passwordless/i,
  /we'll send you a link/i,
];

async function firstTextInputNameForLogin(page: import('@playwright/test').Page): Promise<string | null> {
  const emailName = await page.locator('input[type="email"]').first().getAttribute('name').catch(() => null);
  if (emailName) {
    return emailName;
  }
  const textInputs = page.locator('input[type="text"]');
  const count = await textInputs.count();
  for (let i = 0; i < count; i++) {
    const name = await textInputs.nth(i).getAttribute('name');
    if (name && /user|email|login/i.test(name)) {
      return name;
    }
  }
  return null;
}

function debugAuth(): boolean {
  return process.env.QULIB_DEBUG === '1';
}

function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'custom';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveVisibleFieldLabel(page: Page, el: import('@playwright/test').Locator): Promise<string> {
  const id = await el.getAttribute('id');
  if (id) {
    const lt = await page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first().textContent().catch(() => null);
    const fromLabel = (lt ?? '').trim();
    if (fromLabel) return fromLabel;
  }
  const placeholder = (await el.getAttribute('placeholder'))?.trim();
  if (placeholder) return placeholder;
  const aria = (await el.getAttribute('aria-label'))?.trim();
  if (aria) return aria;
  const name = (await el.getAttribute('name'))?.trim();
  if (name) return name;
  const typ = (await el.getAttribute('type'))?.trim();
  return typ && typ !== 'select' ? typ : 'text';
}

async function deriveCredentialFieldName(el: import('@playwright/test').Locator): Promise<string> {
  const name = (await el.getAttribute('name'))?.trim();
  if (name) return name;
  const placeholder = (await el.getAttribute('placeholder'))?.trim();
  if (placeholder) return slugify(placeholder);
  const aria = (await el.getAttribute('aria-label'))?.trim();
  if (aria) return slugify(aria);
  const id = (await el.getAttribute('id'))?.trim();
  if (id) return slugify(id);
  return 'field';
}

async function buildCredentialFieldsFromVisibleForm(page: Page): Promise<
  Array<{
    name: string;
    label: string;
    type: 'text' | 'password' | 'email' | 'select' | 'checkbox';
    observedOptions: string[];
  }>
> {
  const fields: Array<{
    name: string;
    label: string;
    type: 'text' | 'password' | 'email' | 'select' | 'checkbox';
    observedOptions: string[];
  }> = [];
  const seen = new Set<string>();

  const loc = page.locator(
    'input[type="text"]:visible, input[type="email"]:visible, input[type="password"]:visible, select:visible'
  );
  const count = await loc.count();
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    const tag = await el.evaluate((node) => node.tagName.toLowerCase()).catch(() => '');
    if (tag === 'select') {
      const name = await deriveCredentialFieldName(el);
      const label = await resolveVisibleFieldLabel(page, el);
      const opts = await el.locator('option').allInnerTexts();
      const observedOptions = opts.map((o) => o.trim()).filter((x) => x.length > 0).slice(0, 20);
      const dedupeKey = `select|${name}|${label}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      fields.push({ name, label, type: 'select', observedOptions });
      continue;
    }

    const rawType = ((await el.getAttribute('type')) ?? 'text').toLowerCase();
    if (rawType === 'hidden') continue;
    const fieldType = rawType === 'email' ? 'email' : rawType === 'password' ? 'password' : 'text';
    const name = await deriveCredentialFieldName(el);
    const label = await resolveVisibleFieldLabel(page, el);
    const placeholder = (await el.getAttribute('placeholder'))?.trim() ?? '';
    const dedupeKey = `${name}|${placeholder}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    fields.push({ name, label, type: fieldType, observedOptions: [] });
  }

  return fields;
}

function authPathsFromOauthButtons(oauthButtons: { provider: string; text: string }[], loginUrl: string): AuthPath[] {
  return oauthButtons.map((b) => {
    const isUnknown = b.provider === 'unknown';
    const id = isUnknown ? slugify(b.text) : b.provider;
    return {
      id,
      label: b.text,
      type: isUnknown ? 'oauth-unknown' : 'oauth',
      provider: isUnknown ? slugify(b.text) : b.provider,
      source: isUnknown ? 'heuristic' : 'built-in',
      automatable: false,
      confidence: isUnknown ? 'low' : 'high',
      requirements: {
        method: 'storage-state',
        instruction: `Run qulib auth init --base-url ${loginUrl}`,
      },
    };
  });
}

async function probeClickToRevealForms(
  page: Page,
  loginUrl: string,
  alreadyMatchedTexts: Set<string>,
  timeoutMs: number,
  progress?: AnalyzeProgressSink
): Promise<AuthPath[]> {
  const out: AuthPath[] = [];
  const buttons = page.locator('button');
  const n = await buttons.count();
  const seenLabels = new Set<string>();
  const SUBMIT_RE = /^(sign in|log in|submit|continue|next|cancel|close)$/i;

  let candidateAttempts = 0;
  for (let i = 0; i < n && candidateAttempts < 4; i++) {
    const label = ((await buttons.nth(i).textContent()) ?? '').trim();
    if (!label || label.length > 80) continue;
    if (alreadyMatchedTexts.has(label)) continue;
    if (SUBMIT_RE.test(label)) continue;
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    candidateAttempts += 1;

    const originBefore = new URL(page.url()).origin;

    if (debugAuth()) {
      progress?.debug(`detect_auth click-reveal try label="${label.slice(0, 80)}"`);
    }

    let clicked = false;
    try {
      await page.getByRole('button', { name: label, exact: true }).first().click({ timeout: 2000 });
      clicked = true;
    } catch {
      try {
        await page
          .locator('button')
          .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, 'i') })
          .first()
          .click({ timeout: 2000 });
        clicked = true;
      } catch {
        /* skip */
      }
    }
    if (!clicked) {
      continue;
    }

    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    } catch {
      /* best-effort after navigation */
    }
    if (new URL(page.url()).origin !== originBefore) {
      if (debugAuth()) {
        progress?.debug(
          `detect_auth click-reveal aborted (cross-origin after click): was ${originBefore} now ${new URL(page.url()).origin}`
        );
      }
      await page.goto(loginUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      await waitNetworkIdleBestEffort(page);
      continue;
    }

    try {
      await page.locator('input[type="password"]:visible').first().waitFor({ state: 'visible', timeout: 2000 });
    } catch {
      await page.goto(loginUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      await waitNetworkIdleBestEffort(page);
      continue;
    }

    const fields = await buildCredentialFieldsFromVisibleForm(page);
    const slug = slugify(label);
    out.push({
      id: slug,
      label,
      type: 'form-login',
      provider: slug,
      source: 'heuristic',
      automatable: true,
      confidence: 'medium',
      requirements: {
        method: 'credentials',
        fields,
      },
    });

    await page.goto(loginUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    await waitNetworkIdleBestEffort(page);
  }

  return out;
}

export function evaluateStorageStateValidity(signals: {
  expectedOrigin: string;
  finalUrl: string;
  visiblePasswordCount: number;
  hadUnauthorizedHttp: boolean;
}): StorageStateValidationResult {
  let finalOrigin: string | null = null;
  try {
    finalOrigin = new URL(signals.finalUrl).origin;
  } catch {
    finalOrigin = null;
  }
  if (finalOrigin === null || finalOrigin !== signals.expectedOrigin) {
    return {
      valid: false,
      reasonCode: 'wrong-origin',
      reason: 'session redirected to a different origin than the target app',
    };
  }
  if (signals.visiblePasswordCount > 0) {
    return {
      valid: false,
      reasonCode: 'expired-or-unauthorized',
      reason: 'login form still visible after loading storage state (session likely expired)',
    };
  }
  if (signals.hadUnauthorizedHttp) {
    return {
      valid: false,
      reasonCode: 'expired-or-unauthorized',
      reason: 'HTTP 401/403 on authenticated request (session likely expired or invalid)',
    };
  }
  return { valid: true, reasonCode: 'ok', reason: 'session appears active' };
}

interface ParsedStorageState {
  cookies?: unknown[];
  origins?: Array<{ origin?: string; localStorage?: unknown[] }>;
}

export async function preflightStorageStateFile(
  storagePath: string
): Promise<StorageStateValidationResult | null> {
  let exists = false;
  try {
    const s = await stat(storagePath);
    exists = s.isFile();
  } catch {
    exists = false;
  }
  if (!exists) {
    return {
      valid: false,
      reasonCode: 'missing-file',
      reason: 'storage state file does not exist',
    };
  }
  let raw: string;
  try {
    raw = await readFile(storagePath, 'utf8');
  } catch {
    return {
      valid: false,
      reasonCode: 'unreadable-file',
      reason: 'storage state file is not readable',
    };
  }
  let parsed: ParsedStorageState;
  try {
    parsed = JSON.parse(raw) as ParsedStorageState;
  } catch {
    return {
      valid: false,
      reasonCode: 'invalid-json',
      reason: 'storage state file is not valid JSON',
    };
  }
  const cookieCount = Array.isArray(parsed?.cookies) ? parsed.cookies.length : 0;
  const originEntries = Array.isArray(parsed?.origins) ? parsed.origins : [];
  const localStorageEntryCount = originEntries.reduce<number>((sum, entry) => {
    return sum + (Array.isArray(entry?.localStorage) ? entry.localStorage.length : 0);
  }, 0);
  if (cookieCount === 0 && localStorageEntryCount === 0) {
    return {
      valid: false,
      reasonCode: 'no-auth-cookies',
      reason: 'storage state file contains no cookies and no localStorage entries',
    };
  }
  return null;
}

export async function waitForReturnToOrigin(
  page: Page,
  baseUrl: string,
  timeoutMs = 15000
): Promise<{ returned: boolean; finalUrl: string }> {
  const targetOrigin = new URL(baseUrl).origin;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const finalUrl = page.url();
    try {
      if (new URL(finalUrl).origin === targetOrigin) {
        return { returned: true, finalUrl };
      }
    } catch {
      /* ignore transient invalid URLs */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { returned: false, finalUrl: page.url() };
}

export async function validateStorageState(
  url: string,
  storagePath: string,
  timeoutMs = 10000
): Promise<StorageStateValidationResult> {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(url).origin;
  } catch {
    return {
      valid: false,
      reasonCode: 'unknown',
      reason: 'target URL could not be parsed for origin matching',
    };
  }

  const storageAbs = resolve(process.cwd(), storagePath);

  const preflight = await preflightStorageStateFile(storageAbs);
  if (preflight !== null) {
    return preflight;
  }

  let hadUnauthorizedHttp = false;
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ storageState: storageAbs });
    const page = await context.newPage();
    page.on('response', (res) => {
      const s = res.status();
      if (s === 401 || s === 403) {
        hadUnauthorizedHttp = true;
      }
    });

    try {
      await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    } catch {
      return {
        valid: false,
        reasonCode: 'unknown',
        reason: 'navigation to target URL failed while validating storage state',
      };
    }
    await waitNetworkIdleBestEffort(page);

    const finalUrl = page.url();
    const visiblePasswordCount = await page
      .locator('input[type="password"]:visible')
      .count()
      .catch(() => 0);

    return evaluateStorageStateValidity({
      expectedOrigin,
      finalUrl,
      visiblePasswordCount,
      hadUnauthorizedHttp,
    });
  } finally {
    await browser.close();
  }
}

export async function detectAuth(
  url: string,
  timeoutMs = 15000,
  progress?: AnalyzeProgressSink
): Promise<DetectedAuth> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    progress?.info(`detect_auth URL=${url}`);

    await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    await waitNetworkIdleBestEffort(page);

    if (debugAuth()) {
      const html = await page.content();
      progress?.debug(`detect_auth HTML byteLength=${Buffer.byteLength(html, 'utf8')}`);
    }

    let loginUrl = url;
    const looksLikeLoginPage =
      /login|sign[- ]?in|auth/i.test(page.url()) ||
      (await page.locator('input[type="password"]:visible').count()) > 0;

    if (!looksLikeLoginPage) {
      const loginLink = page.locator('a').filter({ hasText: /^(log ?in|sign ?in|sign in)$/i }).first();
      const loginLinkCount = await loginLink.count();
      progress?.debug(`detect_auth selector loginLink count=${loginLinkCount}`);
      if (loginLinkCount > 0) {
        const href = await loginLink.getAttribute('href');
        progress?.debug(`detect_auth selector loginLink href matched=${Boolean(href)}`);
        if (href) {
          loginUrl = new URL(href, url).toString();
          await page.goto(loginUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
          await waitNetworkIdleBestEffort(page);
        }
      }
    }

    const passwordInputs = page.locator('input[type="password"]:visible');
    const passwordCount = await passwordInputs.count();
    progress?.debug(`detect_auth selector input[type=password] count=${passwordCount}`);
    const hasFormLogin = passwordCount > 0;

    const oauthButtons: { provider: string; text: string }[] = [];
    const buttonTexts = await page.locator('button, a').allInnerTexts();

    for (const text of buttonTexts) {
      const trimmed = text.trim();
      if (!textLooksLikeOAuthIdpButton(trimmed)) {
        if (debugAuth() && trimmed.length > 0 && trimmed.length <= 120) {
          progress?.debug(`detect_auth oauth text skipped (not Idp-shaped) sample="${trimmed.slice(0, 80)}"`);
        }
        continue;
      }
      let matchedAny = false;
      for (const { id, patterns } of BUILT_IN_OAUTH_PROVIDERS) {
        const matched = patterns.some((p) => p.test(trimmed));
        if (debugAuth()) {
          progress?.debug(`detect_auth oauth pattern try provider=${id} matched=${matched}`);
        }
        if (matched) {
          if (!oauthButtons.find((b) => b.provider === id)) {
            oauthButtons.push({ provider: id, text: trimmed.slice(0, 100) });
          }
          matchedAny = true;
        }
      }
      if (!matchedAny) {
        const builtIn = BUILT_IN_OAUTH_PROVIDERS.find((p) => p.label.toLowerCase() === trimmed.toLowerCase());
        if (builtIn) {
          if (!oauthButtons.find((b) => b.provider === builtIn.id)) {
            oauthButtons.push({ provider: builtIn.id, text: trimmed.slice(0, 100) });
          }
        } else if (!oauthButtons.find((b) => b.text === trimmed.slice(0, 100))) {
          oauthButtons.push({ provider: 'unknown', text: trimmed.slice(0, 100) });
        }
      }
    }

    const skipProbeLabels = new Set(oauthButtons.map((b) => b.text.trim()));
    const clickRevealForms = await probeClickToRevealForms(page, loginUrl, skipProbeLabels, timeoutMs, progress);

    const pageText = await page.locator('body').innerText().catch(() => '');
    const hasMagicLink = MAGIC_LINK_PATTERNS.some((p) => p.test(pageText));

    let type: DetectedAuth['type'] = 'none';
    let provider: string | null = null;
    let observedSelectors: DetectedAuth['observedSelectors'] = null;
    let recommendation = '';

    if (oauthButtons.length > 0) {
      type = 'oauth';
      provider = oauthButtons[0].provider;
      recommendation = `OAuth detected (${oauthButtons.map((b) => b.provider).join(', ')}). OAuth cannot be automated. Run "qulib auth init --base-url ${loginUrl}" to log in manually once and save a reusable storage state file.`;
    } else if (hasFormLogin) {
      type = 'form-login';
      const usernameName = await firstTextInputNameForLogin(page);
      const passwordName = await passwordInputs.first().getAttribute('name').catch(() => null);
      const submitName = await page
        .locator('button[type="submit"], input[type="submit"]')
        .first()
        .getAttribute('name')
        .catch(() => null);

      observedSelectors = {
        usernameSelector: usernameName ? `input[name="${usernameName}"]` : null,
        passwordSelector: passwordName ? `input[name="${passwordName}"]` : null,
        submitSelector: submitName ? `button[name="${submitName}"]` : 'button[type="submit"]',
      };
      if (debugAuth()) {
        progress?.debug(
          `detect_auth resolved selectors username=${observedSelectors.usernameSelector ?? 'null'} password=${observedSelectors.passwordSelector ?? 'null'} submit=${observedSelectors.submitSelector}`
        );
      }
      recommendation = `Form login detected. Configure auth with type="form-login", credentials, and the selectors above. Test selectors in your browser dev tools to confirm.`;
    } else if (hasMagicLink) {
      type = 'magic-link';
      recommendation = `Magic link / passwordless auth detected. Qulib cannot complete email-link flows. Run "qulib auth init --base-url ${loginUrl}" to log in manually once and save a storage state file.`;
    } else if (looksLikeLoginPage) {
      type = 'unknown';
      recommendation = `Authentication required but the pattern is unrecognized. Use "qulib auth init --base-url ${loginUrl}" to capture a storage state by logging in manually.`;
    } else {
      type = 'none';
      recommendation = `No authentication required for the entry URL. Qulib can scan anonymously.`;
    }

    if (clickRevealForms.length > 0) {
      recommendation += `\nAutomatable form login detected via: ${clickRevealForms.map((f) => f.label).join(', ')}. Use type="form-login" with the observed selectors in authOptions.`;
    }

    const providerList =
      oauthButtons.length > 0 ? oauthButtons.map((b) => b.provider).join(', ') : provider ?? 'none';
    const automatable = type === 'form-login' || clickRevealForms.length > 0;
    progress?.info(`Auth detected: ${type} (${providerList}) automatable=${automatable}`);

    const authOptions: AuthPath[] = [...authPathsFromOauthButtons(oauthButtons, loginUrl), ...clickRevealForms];

    return {
      hasAuth: type !== 'none' || oauthButtons.length > 0 || clickRevealForms.length > 0,
      type,
      provider,
      loginUrl:
        type === 'none' && oauthButtons.length === 0 && clickRevealForms.length === 0 ? null : loginUrl,
      observedSelectors,
      oauthButtons,
      ...(authOptions.length > 0 ? { authOptions } : {}),
      recommendation,
    };
  } finally {
    await browser.close();
  }
}
