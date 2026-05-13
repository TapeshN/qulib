import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { DetectedAuth } from '../../schemas/config.schema.js';
import type { Gap } from '../../schemas/gap-analysis.schema.js';
import { launchBrowser } from '../explorers/browser.js';

async function waitNetworkIdleBestEffort(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    /* best-effort */
  }
}

export async function analyzeAuthSurfaceGaps(
  url: string,
  detection: DetectedAuth,
  timeoutMs: number
): Promise<Gap[]> {
  if (!detection.hasAuth) {
    return [];
  }

  const gaps: Gap[] = [];
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const resp = await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' }).catch(() => null);
    if (!resp || !resp.ok()) {
      gaps.push({
        id: randomUUID(),
        path: new URL(url).pathname || '/',
        severity: 'critical',
        category: 'auth-surface',
        reason: 'Sign-in surface did not load successfully for evaluation.',
        description: 'The auth entry URL failed to load or returned a non-OK status before DOM checks could run.',
        recommendation: 'Verify DNS, TLS, and that the URL is reachable from the scan environment.',
      });
      return gaps;
    }
    await waitNetworkIdleBestEffort(page);

    const title = await page.title().catch(() => '');
    if (!title || title.trim().length < 3) {
      gaps.push({
        id: randomUUID(),
        path: '/',
        severity: 'medium',
        category: 'auth-surface',
        reason: 'Missing or trivial document title on the sign-in surface.',
        description: 'Users and assistive tech rely on a meaningful window title.',
        recommendation: 'Set a concise, unique <title> for the login experience.',
      });
    }

    const metaDesc = await page.locator('meta[name="description"]').getAttribute('content').catch(() => null);
    if (!metaDesc || metaDesc.trim().length < 8) {
      gaps.push({
        id: randomUUID(),
        path: '/',
        severity: 'low',
        category: 'auth-surface',
        reason: 'No meta description on the sign-in surface.',
        description: 'Search and sharing previews benefit from meta description on public entry pages.',
        recommendation: 'Add <meta name="description" content="..."> with a short summary of the product.',
      });
    }

    const h1Count = await page.locator('h1').count();
    if (h1Count === 0) {
      gaps.push({
        id: randomUUID(),
        path: '/',
        severity: 'medium',
        category: 'auth-surface',
        reason: 'No visible primary heading (h1) on the sign-in surface.',
        description: 'A primary heading helps users orient on the login page.',
        recommendation: 'Add a single descriptive <h1> for the sign-in view.',
      });
    }

    const oauthButtons = page.locator('button, a[href], [role="button"]');
    const n = await oauthButtons.count();
    for (let i = 0; i < Math.min(n, 25); i++) {
      const el = oauthButtons.nth(i);
      const text = ((await el.textContent()) ?? '').trim();
      if (!text || text.length > 120) continue;
      const isOAuthish =
        /google|microsoft|github|apple|sso|sign in with|log in with|continue with|oauth/i.test(text);
      if (!isOAuthish) continue;

      const role = await el.getAttribute('role');
      const tag = await el.evaluate((node) => node.tagName.toLowerCase());
      const tabIndex = await el.getAttribute('tabindex');
      const aria = await el.getAttribute('aria-label');
      const keyboardable = tag === 'button' || tag === 'a' || role === 'button';
      const labeled = Boolean(aria && aria.trim().length > 0) || text.length > 0;
      if (!keyboardable || tabIndex === '-1') {
        gaps.push({
          id: randomUUID(),
          path: '/',
          severity: 'high',
          category: 'auth-surface',
          reason: `OAuth control "${text.slice(0, 60)}" may not be keyboard-accessible.`,
          description: 'SSO entry points should be real buttons or links with focus support.',
          recommendation: 'Use <button> or <a href> with visible label; avoid tabindex=-1 on the only sign-in path.',
        });
      } else if (!labeled) {
        gaps.push({
          id: randomUUID(),
          path: '/',
          severity: 'medium',
          category: 'auth-surface',
          reason: `OAuth control "${text.slice(0, 60)}" lacks aria-label and has weak visible text.`,
          description: 'Assistive technologies need a clear accessible name for IdP buttons.',
          recommendation: 'Add aria-label or visible text that names the provider and action.',
        });
      }
    }

    const hasPassword = (await page.locator('input[type="password"]').count()) > 0;
    const hasEmailLink = await page.getByText(/magic link|email.*link|passwordless/i).count();
    const hasOAuthUi =
      detection.oauthButtons.length > 0 ||
      (await page.getByText(/sign in with|continue with google|microsoft|github/i).count()) > 0;
    const formLoginFallbacks = (detection.authOptions ?? []).filter((o) => o.type === 'form-login');
    const hasFormLoginFallback = formLoginFallbacks.length > 0;

    if (detection.type === 'oauth' && hasOAuthUi && !hasPassword && !hasEmailLink) {
      if (hasFormLoginFallback) {
        const labels = formLoginFallbacks.map((o) => o.label).join(', ');
        gaps.push({
          id: randomUUID(),
          path: '/',
          severity: 'low',
          category: 'auth-surface',
          reason: `OAuth-primary login with form-login fallback detected via: ${labels}`,
          description:
            'A form-based login path exists alongside OAuth. Automate via type="form-login" using the selectors in authOptions.',
          recommendation: `Automatable form option(s): ${labels}. Configure type="form-login" with credentials and selectors from detectedAuth.authOptions.`,
        });
      } else {
        gaps.push({
          id: randomUUID(),
          path: '/',
          severity: 'medium',
          category: 'auth-surface',
          reason: 'OAuth-only entry with no visible password or magic-link fallback.',
          description: 'Users who cannot use a social IdP need another path (email/password, help, or support).',
          recommendation: 'Add a documented fallback (email/password, help desk link, or alternate IdP).',
        });
      }
    }

    const errorSelectors = '[role="alert"], [data-testid*="error" i], .error, .alert-danger, [class*="error" i]';
    const errCount = await page.locator(errorSelectors).count();
    if (errCount === 0 && hasOAuthUi) {
      gaps.push({
        id: randomUUID(),
        path: '/',
        severity: 'low',
        category: 'auth-surface',
        reason: 'No obvious in-DOM error container found for OAuth sign-in failures.',
        description: 'IdP failures should surface recoverable feedback in the page.',
        recommendation: 'Reserve a live region or inline alert for OAuth errors returned from the provider.',
      });
    }

    const help = await page.getByText(/forgot password|need help|contact support|get help/i).count();
    if (help === 0 && hasOAuthUi) {
      gaps.push({
        id: randomUUID(),
        path: '/',
        severity: 'low',
        category: 'auth-surface',
        reason: 'No visible “forgot password” or help path detected near OAuth controls.',
        description: 'Users locked out of an IdP need a support or recovery affordance.',
        recommendation: 'Link to account recovery, IT help, or a support URL near the sign-in actions.',
      });
    }
  } finally {
    await browser.close();
  }

  return gaps;
}
