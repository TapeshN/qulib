// Fixture Playwright spec covering the /login route. Path lives under e2e/ and ends
// in .spec.ts → detected as `playwright`; the '/login' string literal is extracted
// into coveredPaths, which makes auth-test-coverage score 90 for this fixture.
import { test, expect } from '@playwright/test';

test('login page renders the sign-in form', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('login-form')).toBeVisible();
});
