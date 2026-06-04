// Fixture Playwright spec covering the /dashboard route. Together with login.spec.ts
// this covers both inferred routes → test-coverage-breadth scores 100 for this fixture.
import { test, expect } from '@playwright/test';

test('dashboard renders', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('.dashboard')).toBeVisible();
});
