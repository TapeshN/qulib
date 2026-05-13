import type { Page } from '@playwright/test';
import type { AuthPath } from '../schemas/config.schema.js';
import { BUILT_IN_OAUTH_PROVIDERS } from '../tools/oauth-providers.js';
import { waitForReturnToOrigin } from '../tools/auth-detector.js';

const builtInOAuthIds = new Set(BUILT_IN_OAUTH_PROVIDERS.map((p) => p.id));

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function waitNetworkIdleBestEffort(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    /* best-effort */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function authPathNeedsClickReveal(path: AuthPath): boolean {
  return path.type === 'form-login' && path.source === 'heuristic' && !builtInOAuthIds.has(path.id);
}

export async function runAutomatedAuthLogin(params: {
  loginUrl: string;
  path: AuthPath;
  credentials: Record<string, string>;
  outPath: string;
  headed: boolean;
  timeoutMs: number;
  successUrlContains?: string;
  baseUrlHint: string;
}): Promise<void> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: !params.headed });
  const context = await browser.newContext();
  const page = await context.newPage();
  let confirmed = false;
  try {
    await page.goto(params.loginUrl, { waitUntil: 'domcontentloaded', timeout: params.timeoutMs });
    await waitNetworkIdleBestEffort(page);

    if (authPathNeedsClickReveal(params.path)) {
      try {
        await page.getByRole('button', { name: params.path.label, exact: true }).first().click({ timeout: 2000 });
      } catch {
        await page
          .locator('button')
          .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(params.path.label)}\\s*$`, 'i') })
          .first()
          .click({ timeout: 2000 });
      }
      await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 2000 });
    }

    if (params.path.requirements.method !== 'credentials') {
      throw new Error('Internal error: expected credentials method on form-login path.');
    }

    for (const field of params.path.requirements.fields) {
      const val = params.credentials[field.name];
      const nameJson = JSON.stringify(field.name);
      const inputByName = `input[name=${nameJson}]`;
      const selectByName = `select[name=${nameJson}]`;
      try {
        if (field.type === 'select') {
          const sel = page.locator(selectByName).first();
          try {
            await sel.selectOption(val, { timeout: 8000 });
          } catch {
            await sel.selectOption({ label: val }, { timeout: 8000 });
          }
        } else if (field.type === 'checkbox') {
          const loc = page.locator(`input[type="checkbox"][name=${nameJson}]`).first();
          if (val === 'true' || val === '1' || val === 'on' || val === 'yes') {
            await loc.check({ timeout: 8000 });
          } else {
            await loc.uncheck({ timeout: 8000 });
          }
        } else {
          await page.locator(inputByName).first().fill(val, { timeout: 8000 });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to fill field "${field.name}" (${field.label}): ${msg}`);
      }
    }

    const preSubmit = page.url();
    try {
      await page.locator('button[type="submit"]').first().click({ timeout: 8000 });
    } catch {
      await page.locator('input[type="password"]').first().press('Enter');
    }

    if (params.successUrlContains && params.successUrlContains.trim().length > 0) {
      const frag = params.successUrlContains.trim();
      try {
        await page.waitForURL((u) => u.toString().includes(frag), { timeout: params.timeoutMs });
        confirmed = true;
      } catch {
        confirmed = false;
      }
    } else {
      const t0 = Date.now();
      while (Date.now() - t0 < params.timeoutMs) {
        if (page.url() !== preSubmit) {
          confirmed = true;
          break;
        }
        if (Date.now() - t0 >= 5000) {
          const vis = await page.locator('input[type="password"]:visible').count();
          if (vis === 0) {
            confirmed = true;
            break;
          }
        }
        await sleep(250);
      }
    }

    const originReturn = await waitForReturnToOrigin(page, params.baseUrlHint, params.timeoutMs);
    if (!originReturn.returned) {
      let targetOrigin = '<unknown>';
      let finalOrigin = '<unknown>';
      try {
        targetOrigin = new URL(params.baseUrlHint).origin;
      } catch {
        /* targetOrigin stays <unknown> */
      }
      try {
        finalOrigin = new URL(originReturn.finalUrl).origin;
      } catch {
        /* finalOrigin stays <unknown> */
      }
      throw new Error(
        `Login flow did not return to the app origin (expected ${targetOrigin}, final ${finalOrigin}). ` +
          `Refusing to save the storage state — it would belong to the wrong domain and produce ` +
          `false-confidence scans. Retry the login (the federated provider may need a redirect tweak) ` +
          `or capture the session manually with \`qulib auth init --base-url ${params.baseUrlHint}\`.`
      );
    }

    if (!confirmed) {
      console.error(
        '[qulib] Could not confirm login success heuristically, but the browser ended on the app origin. ' +
          'Storage state will be saved; verify the session before relying on it (run `qulib analyze` ' +
          'and check that releaseConfidence is not null).'
      );
    }

    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const outAbs = pathMod.resolve(params.outPath);
    await fs.mkdir(pathMod.dirname(outAbs), { recursive: true });
    await context.storageState({ path: outAbs });

    console.log(`\n[qulib] Saved storage state to ${outAbs}`);
    console.log('[qulib] To use it, pass to qulib like:');
    console.log(`        qulib analyze --url ${params.baseUrlHint} --auth-storage-state ${outAbs}`);
    console.log(`[qulib] Or in MCP, pass auth: { type: 'storage-state', path: '${outAbs}' }`);
  } finally {
    await browser.close();
  }
}
