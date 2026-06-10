/**
 * Lightweight helper used by test files that require a Playwright Chromium
 * installation. Checks for the browser at the filesystem level — no side
 * effects, no subprocess launch.
 *
 * Two ways to skip:
 *   1. Set PLAYWRIGHT_SKIP=1 in the environment — explicit opt-out, useful for
 *      fresh-clone CI jobs that intentionally skip browser tests.
 *   2. The Playwright Chromium executable is simply absent from the expected
 *      install path (e.g. the developer never ran `npx playwright install`).
 *
 * Usage in test files:
 *
 *   import { chromiumAvailable, CHROMIUM_SKIP_REASON } from './playwright-available.js';
 *
 *   test('my browser test', { skip: !chromiumAvailable, skipMessage: CHROMIUM_SKIP_REASON }, () => { ... });
 *
 * Or for a subtree of tests (t.before guard):
 *
 *   if (!chromiumAvailable) { t.skip(); return; }
 */

import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * True when a Playwright Chromium browser binary is present on disk AND the
 * caller has not set PLAYWRIGHT_SKIP=1.
 */
export const chromiumAvailable: boolean =
  !process.env['PLAYWRIGHT_SKIP'] && existsSync(chromium.executablePath());

/**
 * Human-readable reason string passed to `t.skip()` / `skipMessage` so the
 * skip is self-documenting in test output.
 */
export const CHROMIUM_SKIP_REASON: string = process.env['PLAYWRIGHT_SKIP']
  ? 'PLAYWRIGHT_SKIP=1 is set — browser tests opted out. Unset PLAYWRIGHT_SKIP to enable.'
  : 'Playwright Chromium is not installed. Run `npx playwright install chromium` to enable these tests.';
