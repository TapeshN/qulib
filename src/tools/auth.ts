import type { Browser, BrowserContext } from '@playwright/test';
import { resolve } from 'node:path';
import type { AuthConfig } from '../schemas/config.schema.js';

export async function createAuthenticatedContext(
  browser: Browser,
  auth: AuthConfig | undefined,
  timeoutMs: number
): Promise<BrowserContext> {
  if (!auth) {
    return browser.newContext();
  }

  if (auth.type === 'storage-state') {
    const storagePath = resolve(process.cwd(), auth.path);
    return browser.newContext({ storageState: storagePath });
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(auth.loginUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    await page.fill(auth.selectors.username, auth.credentials.username);
    await page.fill(auth.selectors.password, auth.credentials.password);
    await page.click(auth.selectors.submit);

    const urlFragment = auth.successIndicator.urlContains;
    if (urlFragment) {
      await page.waitForURL((url) => url.toString().includes(urlFragment), {
        timeout: timeoutMs,
      });
    }

    const visibleSelector = auth.successIndicator.selectorVisible;
    if (visibleSelector) {
      await page.waitForSelector(visibleSelector, {
        timeout: timeoutMs,
        state: 'visible',
      });
    }
  } finally {
    await page.close();
  }

  return context;
}
