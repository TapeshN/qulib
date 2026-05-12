import type { BrowserContext } from '@playwright/test';
import { launchBrowser } from './browser.js';
import { AxeBuilder } from '@axe-core/playwright';
import type { AppExplorer } from './explorer.interface.js';
import { createAuthenticatedContext } from './auth.js';
import { RouteInventorySchema, type RouteInventory, type Route } from '../schemas/route-inventory.schema.js';
import type { HarnessConfig } from '../schemas/config.schema.js';

function crawlHostKey(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

function isInternalHref(href: string, baseUrlStr: string): boolean {
  try {
    const u = new URL(href);
    const base = new URL(baseUrlStr);
    return u.protocol === base.protocol && crawlHostKey(u.hostname) === crawlHostKey(base.hostname);
  } catch {
    return false;
  }
}

export class PlaywrightExplorer implements AppExplorer {
  async explore(baseUrl: string, config: HarnessConfig): Promise<RouteInventory> {
    const browser = await launchBrowser();

    let context: BrowserContext;
    try {
      context = await createAuthenticatedContext(browser, config.auth, config.timeoutMs);
    } catch (err) {
      await browser.close();
      throw new Error(`Authentication failed: ${String(err)}. Check your auth config and credentials.`);
    }

    if (config.auth) {
      const label =
        config.auth.type === 'form-login' ? config.auth.credentials.username : 'storage-state';
      console.error(`[qulib] authenticated as ${label}`);
    }

    const visited = new Set<string>();
    const queue: string[] = [baseUrl];
    const routes: Route[] = [];
    let budgetExceeded = false;

    try {
      while (queue.length > 0) {
        if (visited.size >= config.maxPagesToScan) {
          budgetExceeded = queue.length > 0;
          break;
        }

        const url = queue.shift();
        if (!url) {
          continue;
        }

        const normalized = url.split('?')[0].split('#')[0];
        if (visited.has(normalized)) continue;
        visited.add(normalized);

        const page = await context.newPage();
        const consoleErrors: string[] = [];

        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
          }
        });

        try {
          await page.goto(url, {
            timeout: config.timeoutMs,
            waitUntil: 'domcontentloaded',
          });

          const pageTitle = await page.title();
          const formCount = await page.locator('form').count();
          const buttonLabels = await page.locator('button').allInnerTexts();

          const hrefs = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter(Boolean)
          );

          const internalLinks = hrefs
            .filter((href) => isInternalHref(href, baseUrl))
            .map((href) => href.split('?')[0].split('#')[0]);

          const uniqueInternal = [...new Set(internalLinks)];

          for (const link of uniqueInternal) {
            if (!visited.has(link) && !queue.includes(link)) {
              queue.push(link);
            }
          }

          const brokenLinks: Route['brokenLinks'] = [];
          for (const link of uniqueInternal.slice(0, 20)) {
            try {
              const response = await page.request.head(link, { timeout: 5000 });
              if (response.status() >= 400) {
                brokenLinks.push({ url: link, status: response.status() });
              }
            } catch (err) {
              brokenLinks.push({ url: link, status: null, reason: String(err) });
            }
          }

          let a11yViolations: Route['a11yViolations'] = [];
          try {
            const axeResults = await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa'])
              .analyze();
            a11yViolations = axeResults.violations.map((v) => ({
              id: v.id,
              impact: v.impact ?? 'unknown',
              helpUrl: v.helpUrl,
              nodeCount: v.nodes.length,
            }));
          } catch (err) {
            consoleErrors.push(`axe-core failure: ${String(err)}`);
          }

          const path = new URL(url).pathname || '/';

          routes.push({
            path,
            pageTitle,
            links: uniqueInternal,
            formCount,
            buttonLabels: buttonLabels.map((b) => b.trim()).filter(Boolean),
            consoleErrors,
            brokenLinks,
            a11yViolations,
          });
        } catch (err) {
          const path = (() => {
            try {
              return new URL(url).pathname || '/';
            } catch {
              return url;
            }
          })();
          routes.push({
            path,
            pageTitle: '',
            links: [],
            formCount: 0,
            buttonLabels: [],
            consoleErrors: [`Navigation error: ${String(err)}`],
            brokenLinks: [],
            a11yViolations: [],
          });
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
      await browser.close();
    }

    return RouteInventorySchema.parse({
      scannedAt: new Date().toISOString(),
      baseUrl,
      routes,
      pagesSkipped: budgetExceeded ? queue.length : 0,
      budgetExceeded,
    });
  }
}
