import { expect, test, type Page } from '@playwright/test';

/**
 * The presenter's role switch, in ONE browser context: sign in as the owner,
 * sign out, sign in as the receiver — the receiver must get the receiver's app
 * (receiving, no owner pages), never the owner's session back.
 *
 * Regression for the sign-out race: every authenticated response re-issues the
 * session cookie, so a request in flight during sign-out could re-plant the
 * owner's JWT (30% of sign-outs on a production build). The sign-out tombstone
 * (lib/signOutTombstone) keeps it dead. Repeated, because the race is timing-
 * dependent; it bites hardest on a production build (link prefetch):
 *   ROLE_SWITCH_BASE_URL=http://localhost:3310 pnpm exec playwright test e2e/role-switch.spec.ts
 * against a `next start` server on the seeded demo tenant (keep ROUNDS × 2 ≤ 10 logins
 * per 15 min, the login rate limit).
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const ROUNDS = Number(process.env.ROLE_SWITCH_ROUNDS ?? 3);

const BASE = process.env.ROLE_SWITCH_BASE_URL;
// Needs the seeded demo tenant (password logins for owner@ / receiver@kfar-hazeitim.test),
// like i18n-sweep / demo-path. Opt-in, not in run-demo-path: 2 logins per round would
// push the owner past the login rate limit (10 / 15 min) next to the demo legs.
test.skip(!BASE, 'set ROLE_SWITCH_BASE_URL (a next start build on the seeded demo tenant) to run');
test.use({ baseURL: BASE });

async function signIn(page: Page, role: 'owner' | 'receiver') {
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(`${role}@kfar-hazeitim.test`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form:has(#password) button[type=submit]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.goto('/dashboard');
  // Shell v2 (W1-03): sign-out lives in the account menu, on phone and desktop.
  // The click lands immediately — in-flight prefetches are exactly the race.
  await page.getByTestId('avatar-menu').click();
  await page.locator('#rm-account-panel form[data-rm-logout] button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/dashboard'), { timeout: 30_000 });
}

test.describe('role switch in one browser (owner → sign out → receiver)', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL! }]);
  });

  test('signed out means signed out, and the receiver gets the receiver app', async ({ page }) => {
    for (let round = 1; round <= ROUNDS; round++) {
      await signIn(page, 'owner');
      await page.goto('/dashboard/leaks');
      await expect(page).toHaveURL(/\/dashboard\/leaks/); // the owner really was in

      await signOut(page);
      // Signed out: the owner's pages need a login again.
      await page.goto('/dashboard/leaks');
      await expect(page, `round ${round}: owner session came back after sign-out`).toHaveURL(/\/login/);

      await signIn(page, 'receiver');
      await page.goto('/dashboard/receiving');
      await expect(page).toHaveURL(/\/dashboard\/receiving/);
      // No owner navigation for the receiver…
      await expect(page.locator('a[href="/dashboard/leaks"]')).toHaveCount(0);
      await expect(page.locator('a[href="/dashboard/team"]')).toHaveCount(0);
      // …and the owner's pages are refused (middleware role gate): a bounce to the
      // home, or the in-shell 403 page once W1-04 lands — never the owner's page.
      const res = await page.goto('/dashboard/leaks');
      expect(/\/dashboard$/.test(page.url()) || res?.status() === 403).toBe(true);

      await signOut(page);
    }
  });
});
