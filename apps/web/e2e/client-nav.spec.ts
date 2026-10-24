import { expect, test } from '@playwright/test';
import { OWNER_STATE } from './env';
import { collectPageErrors } from './helpers';

/**
 * Client-side <Link> navigations must log nothing. RouteProgress once announced
 * route commits synchronously from Next's history write, which runs inside a
 * useInsertionEffect: `next dev` then logged "useInsertionEffect must not
 * schedule updates" on every navigation (production stays silent, so only a dev
 * run catches it).
 */
test.use({ storageState: OWNER_STATE, viewport: { width: 1280, height: 800 } });

test('dashboard nav links: no console errors across client navigations', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'rm_locale',
      value: 'he',
      url: test.info().project.use.baseURL ?? 'http://localhost:3100',
    },
    {
      name: 'rm_cookie_consent',
      value: 'necessary',
      url: test.info().project.use.baseURL ?? 'http://localhost:3100',
    },
  ]);
  await page.goto('/dashboard', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const errors = collectPageErrors(page);
  for (const path of [
    '/dashboard/leaks',
    '/dashboard/approvals',
    '/dashboard/receiving',
    '/dashboard',
  ]) {
    const link = page.locator(`header a[href="${path}"]`).first();
    await link.click();
    await page.waitForURL((u) => u.pathname === path);
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  expect(errors, 'console errors during client navigations').toEqual([]);
});
