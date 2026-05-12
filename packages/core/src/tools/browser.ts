import { chromium, type Browser } from '@playwright/test';

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Executable doesn't exist") || message.includes('chromium')) {
      throw new Error(
        `Playwright Chromium browser is not installed. Run:\n\n  npx playwright install chromium\n\nThen retry your qulib command. This is a one-time setup step.`
      );
    }
    throw err;
  }
}
