import type { Page } from '@playwright/test';
import type { DetectedAuth } from '../schemas/config.schema.js';
import type { AnalyzeProgressSink } from '../harness/progress-log.js';
import { launchBrowser } from './browser.js';

async function waitNetworkIdleBestEffort(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // best-effort — analytics or polling can prevent networkidle
  }
}

const OAUTH_PROVIDERS: Array<{ provider: string; patterns: RegExp[] }> = [
  { provider: 'github', patterns: [/github/i, /sign in with github/i] },
  {
    provider: 'google',
    patterns: [/google/i, /sign in with google/i, /accounts\.google\.com/i],
  },
  {
    provider: 'microsoft',
    patterns: [/microsoft/i, /sign in with microsoft/i, /login\.microsoftonline\.com/i],
  },
  { provider: 'apple', patterns: [/apple/i, /sign in with apple/i] },
  { provider: 'auth0', patterns: [/auth0/i] },
  { provider: 'okta', patterns: [/okta/i] },
];

function textLooksLikeOAuthIdpButton(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 120) {
    return false;
  }
  return (
    /\b(sign in with|log in with|continue with|sign up with)\b/i.test(t) ||
    /^(github|google|microsoft|apple)$/i.test(t)
  );
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
      (await page.locator('input[type="password"]').count()) > 0;

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

    const passwordInputs = page.locator('input[type="password"]');
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
      for (const { provider, patterns } of OAUTH_PROVIDERS) {
        const matched = patterns.some((p) => p.test(trimmed));
        if (debugAuth()) {
          progress?.debug(`detect_auth oauth pattern try provider=${provider} matched=${matched}`);
        }
        if (matched) {
          if (!oauthButtons.find((b) => b.provider === provider)) {
            oauthButtons.push({ provider, text: trimmed.slice(0, 100) });
          }
        }
      }
    }

    const pageText = await page.locator('body').innerText().catch(() => '');
    const hasMagicLink = MAGIC_LINK_PATTERNS.some((p) => p.test(pageText));

    let type: DetectedAuth['type'] = 'none';
    let provider: string | null = null;
    let observedSelectors: DetectedAuth['observedSelectors'] = null;
    let recommendation = '';

    if (oauthButtons.length > 0) {
      type = 'oauth';
      provider = oauthButtons[0].provider;
      recommendation = `OAuth detected (${oauthButtons.map((b) => b.provider).join(', ')}). OAuth cannot be automated. Run "qulib auth init --base-url ${url}" to log in manually once and save a reusable storage state file.`;
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
      recommendation = `Magic link / passwordless auth detected. Qulib cannot complete email-link flows. Run "qulib auth init --base-url ${url}" to log in manually once and save a storage state file.`;
    } else if (looksLikeLoginPage) {
      type = 'unknown';
      recommendation = `Authentication required but the pattern is unrecognized. Use "qulib auth init --base-url ${url}" to capture a storage state by logging in manually.`;
    } else {
      type = 'none';
      recommendation = `No authentication required for the entry URL. Qulib can scan anonymously.`;
    }

    const providerList =
      oauthButtons.length > 0 ? oauthButtons.map((b) => b.provider).join(', ') : provider ?? 'none';
    const automatable = type === 'form-login';
    progress?.info(`Auth detected: ${type} (${providerList}) automatable=${automatable}`);

    return {
      hasAuth: type !== 'none',
      type,
      provider,
      loginUrl: type === 'none' ? null : loginUrl,
      observedSelectors,
      oauthButtons,
      recommendation,
    };
  } finally {
    await browser.close();
  }
}
