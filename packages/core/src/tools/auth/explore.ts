import type { Page } from '@playwright/test';
import {
  AuthExplorationSchema,
  type AuthExploration,
  type AuthPath,
  type AuthPathRequirements,
} from '../../schemas/config.schema.js';
import type { AnalyzeProgressSink } from '../../harness/progress-log.js';
import { launchBrowser } from '../explorers/browser.js';
import { BUILT_IN_OAUTH_PROVIDERS, type OAuthProvider } from './providers.js';
import { loadUserProviders } from './custom-providers.js';

type ProviderWithSource = OAuthProvider & { source: 'built-in' | 'user-local' };

const MAGIC_LINK_PATTERNS = [
  /email me a (sign[- ]?in )?link/i,
  /sign in with email/i,
  /passwordless/i,
  /we'll send you a link/i,
];

async function waitNetworkIdleBestEffort(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // best-effort
  }
}

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

function slugifyLabel(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 48);
  return s.length > 0 ? s : 'unknown';
}

function onLoginishPage(url: string): boolean {
  return /login|sign[- ]?in|auth|sso|oauth/i.test(new URL(url).pathname + new URL(url).hostname);
}

function debugExplore(): boolean {
  return process.env.QULIB_DEBUG === '1';
}

function isHeuristicUnknownSso(text: string, loginish: boolean): boolean {
  const t = text.trim();
  if (!loginish || t.length < 3 || t.length > 80) {
    return false;
  }
  if (/^(submit|cancel|back|close|next|skip|help|faq)$/i.test(t)) {
    return false;
  }
  if (/\b(sign in with|log in with|continue with)\b/i.test(t)) {
    return true;
  }
  if (/\b(sync|sso|portal|workspace|federation)\b/i.test(t)) {
    return true;
  }
  return false;
}

function storageRequirement(): AuthPathRequirements {
  return {
    method: 'storage-state',
    instruction:
      'OAuth and most SSO flows cannot be scripted. Run `qulib auth init --base-url <app-url>` on this machine, then pass the saved storage state JSON to `analyze` or MCP `analyze_app` as `auth: { type: "storage-state", path: "..." }`.',
  };
}

async function collectVisibleControlTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const nodes = document.querySelectorAll('button, a[href], [role="button"]');
    for (const el of nodes) {
      const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (!t || t.length > 120) {
        continue;
      }
      const style = window.getComputedStyle(el as HTMLElement);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        continue;
      }
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  });
}

function buildAllProviders(): ProviderWithSource[] {
  const builtIn = BUILT_IN_OAUTH_PROVIDERS.map((p) => ({ ...p, source: 'built-in' as const }));
  const user = loadUserProviders().map((p) => ({ ...p, source: 'user-local' as const }));
  return [...builtIn, ...user];
}

function matchProvider(text: string, p: OAuthProvider): boolean {
  return p.patterns.some((re) => re.test(text));
}

function oauthConfidence(source: ProviderWithSource['source'], loginish: boolean): AuthPath['confidence'] {
  if (source === 'user-local') {
    return 'high';
  }
  if (source === 'built-in' && loginish) {
    return 'high';
  }
  if (source === 'built-in') {
    return 'medium';
  }
  return 'low';
}

async function buildFormPaths(page: Page): Promise<AuthPath[]> {
  const passwordCount = await page.locator('input[type="password"]').count();
  if (passwordCount === 0) {
    return [];
  }
  const formType: AuthPath['type'] = passwordCount > 1 ? 'form-multi' : 'form-login';
  const fields = await page.evaluate(() => {
    const pwd = document.querySelector('input[type="password"]');
    if (!pwd) {
      return [];
    }
    const form = pwd.closest('form') ?? document.body;
    const out: Array<{
      name: string;
      label: string;
      type: 'text' | 'password' | 'email' | 'select' | 'checkbox';
      observedOptions: string[];
    }> = [];
    const inputs = form.querySelectorAll('input, select, textarea');
    for (const el of inputs) {
      if (!(el instanceof HTMLElement)) {
        continue;
      }
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const inp = el as HTMLInputElement;
        const t = (inp.type || 'text').toLowerCase();
        if (['hidden', 'submit', 'button', 'image', 'reset'].includes(t)) {
          continue;
        }
        let fieldType: 'text' | 'password' | 'email' | 'select' | 'checkbox' = 'text';
        if (t === 'password') {
          fieldType = 'password';
        } else if (t === 'email') {
          fieldType = 'email';
        } else if (t === 'checkbox') {
          fieldType = 'checkbox';
        }
        const id = inp.id;
        let label = inp.getAttribute('aria-label') ?? inp.placeholder ?? inp.name ?? fieldType;
        if (id) {
          const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (lab?.textContent) {
            label = lab.textContent.trim();
          }
        }
        out.push({
          name: inp.name || inp.id || fieldType,
          label: label.slice(0, 120),
          type: fieldType,
          observedOptions: [],
        });
      } else if (tag === 'select') {
        const sel = el as HTMLSelectElement;
        const opts = Array.from(sel.options).map((o) => o.text.trim()).filter(Boolean);
        out.push({
          name: sel.name || sel.id || 'select',
          label: (sel.getAttribute('aria-label') ?? sel.name ?? 'select').slice(0, 120),
          type: 'select',
          observedOptions: opts.slice(0, 50),
        });
      }
    }
    return out;
  });
  const requirements: AuthPathRequirements =
    fields.length > 0
      ? { method: 'credentials', fields }
      : {
          method: 'unknown',
          instruction:
            'A password field exists but field metadata could not be read. Inspect the page in devtools and configure form-login selectors manually, or use `qulib auth init`.',
        };
  return [
    {
      id: formType === 'form-multi' ? 'form-multi' : 'form-login',
      label: formType === 'form-multi' ? 'Multi-field sign-in form' : 'Username / password form',
      type: formType,
      provider: null,
      source: 'heuristic',
      automatable: requirements.method === 'credentials',
      confidence: requirements.method === 'credentials' ? 'medium' : 'low',
      requirements,
    },
  ];
}

export async function exploreAuth(
  url: string,
  timeoutMs = 20000,
  progress?: AnalyzeProgressSink
): Promise<AuthExploration> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    progress?.info(`explore_auth URL=${url}`);

    await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    await waitNetworkIdleBestEffort(page);

    if (debugExplore()) {
      const html = await page.content();
      progress?.debug(`explore_auth HTML byteLength=${Buffer.byteLength(html, 'utf8')}`);
    }

    const loginishAfterFirst =
      /login|sign[- ]?in|auth/i.test(page.url()) || (await page.locator('input[type="password"]').count()) > 0;

    if (!loginishAfterFirst) {
      const loginLink = page.locator('a').filter({ hasText: /^(log ?in|sign ?in|sign in)$/i }).first();
      const cnt = await loginLink.count();
      progress?.debug(`explore_auth selector loginLink count=${cnt}`);
      if (cnt > 0) {
        const href = await loginLink.getAttribute('href');
        progress?.debug(`explore_auth selector loginLink href matched=${Boolean(href)}`);
        if (href) {
          const next = new URL(href, url).toString();
          await page.goto(next, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
          await waitNetworkIdleBestEffort(page);
        }
      }
    }

    const finalUrl = page.url();
    const loginish = onLoginishPage(finalUrl) || (await page.locator('input[type="password"]').count()) > 0;

    const allProviders = buildAllProviders();
    const texts = await collectVisibleControlTexts(page);
    const consumed = new Set<string>();
    const authPaths: AuthPath[] = [];
    const unrecognizedButtons: Array<{ label: string; hint: string }> = [];

    for (const rawText of texts) {
      const text = rawText.trim();
      if (!text) {
        continue;
      }
      let providerMatch: { p: ProviderWithSource; gate: boolean } | null = null;
      for (const p of allProviders) {
        const hit = matchProvider(text, p);
        if (debugExplore()) {
          progress?.debug(`explore_auth provider try id=${p.id} matched=${hit}`);
        }
        if (!hit) {
          continue;
        }
        if (p.source === 'built-in' && !(textLooksLikeOAuthIdpButton(text) || loginish)) {
          continue;
        }
        providerMatch = { p, gate: textLooksLikeOAuthIdpButton(text) || loginish };
        break;
      }
      if (providerMatch) {
        const { p, gate } = providerMatch;
        const id = `oauth:${p.id}`;
        if (consumed.has(id)) {
          continue;
        }
        consumed.add(id);
        authPaths.push({
          id,
          label: p.label,
          type: 'oauth',
          provider: p.id,
          source: p.source,
          automatable: false,
          confidence: oauthConfidence(p.source, loginish || gate),
          requirements: storageRequirement(),
        });
        progress?.info(`explore_auth path id=${id} type=oauth provider=${p.id} automatable=false`);
        continue;
      }
      if (isHeuristicUnknownSso(text, loginish)) {
        const slug = slugifyLabel(text);
        const id = `oauth-unknown:${slug}`;
        if (consumed.has(id)) {
          continue;
        }
        consumed.add(id);
        authPaths.push({
          id,
          label: text.slice(0, 100),
          type: 'oauth-unknown',
          provider: null,
          source: 'heuristic',
          automatable: false,
          confidence: 'low',
          requirements: storageRequirement(),
        });
        progress?.info(`explore_auth path id=${id} type=oauth-unknown automatable=false`);
        const safePattern = text.slice(0, 48).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        unrecognizedButtons.push({
          label: text.slice(0, 100),
          hint: `If this is your org SSO, register it: qulib auth providers add --id "${slug}" --label "${text.replace(/"/g, '\\"').slice(0, 80)}" --pattern "${safePattern}"`,
        });
      }
    }

    const pageText = await page.locator('body').innerText().catch(() => '');
    if (MAGIC_LINK_PATTERNS.some((re) => re.test(pageText))) {
      authPaths.push({
        id: 'magic-link',
        label: 'Magic link / passwordless',
        type: 'magic-link',
        provider: null,
        source: 'heuristic',
        automatable: false,
        confidence: 'medium',
        requirements: {
          method: 'storage-state',
          instruction:
            'Magic-link flows need a human in the loop. Use `qulib auth init --base-url <app-url>` and complete email or provider steps in the opened browser, then reuse the saved storage state for scans.',
        },
      });
      progress?.info('explore_auth path id=magic-link type=magic-link automatable=false');
    }

    const formPaths = await buildFormPaths(page);
    for (const fp of formPaths) {
      authPaths.push(fp);
      progress?.info(`explore_auth path id=${fp.id} type=${fp.type} automatable=${fp.automatable}`);
    }

    const authRequired = authPaths.length > 0;
    let authScope: AuthExploration['authScope'] = 'none';
    if (authRequired) {
      if (loginish) {
        authScope = 'site-wide';
      } else {
        authScope = /login|signin|auth/i.test(new URL(finalUrl).pathname) ? 'site-wide' : 'optional';
      }
    }

    const suggestedParts: string[] = [];
    if (authPaths.some((p) => p.type === 'oauth' || p.type === 'oauth-unknown')) {
      suggestedParts.push(
        'For OAuth or unrecognized SSO buttons, collect a Playwright storage state with `qulib auth init` before calling `analyze_app`.'
      );
    }
    if (authPaths.some((p) => p.type === 'form-login' || p.type === 'form-multi')) {
      suggestedParts.push(
        'For password forms, gather username/password and stable selectors (or use storage state if MFA applies).'
      );
    }
    if (authPaths.some((p) => p.type === 'magic-link')) {
      suggestedParts.push('For magic-link, use `qulib auth init` after the user completes email delivery.');
    }
    if (!authRequired) {
      suggestedParts.push('No sign-in surface detected at this URL; you can run `analyze_app` without auth unless gated deeper in the app.');
    }

    const exploration: AuthExploration = {
      url: finalUrl,
      authRequired,
      authScope,
      authPaths,
      observedAt: new Date().toISOString(),
      suggestedAgentBehavior: suggestedParts.join(' '),
      unrecognizedButtons,
    };

    return AuthExplorationSchema.parse(exploration);
  } finally {
    await browser.close();
  }
}
