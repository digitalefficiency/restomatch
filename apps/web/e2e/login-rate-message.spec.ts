import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { e2eSql, ensurePasswordUser } from './helpers';

/**
 * Pilot (ציקטי, shared restaurant Wi-Fi): when the login limiter throttles, the
 * page says "too many attempts" — never "wrong email or password" to someone
 * typing the RIGHT password. Wrong passwords before that stay the uniform copy.
 */
const PASSWORD = 'E2e-Correct-Horse-9!';
const BASE = () => test.info().project.use.baseURL ?? 'http://localhost:3100';
const WRONG = 'אימייל או סיסמה שגויים.';
const RATE = 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.';

async function clearLoginCounters() {
  const sql = e2eSql();
  try {
    await sql`delete from rate_limit_counters where key like ${'login:%'}`;
  } finally {
    await sql.end();
  }
}

async function attempt(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('form:has(#password) button[type=submit]').click();
  await page.waitForURL(/\/login\?/);
  return (await page.locator('#login-error').first().innerText()).trim();
}

test.describe('login throttle message', () => {
  test.beforeEach(clearLoginCounters);
  test.afterEach(clearLoginCounters); // never leave this test's attempts on the shared e2e IP

  test('a throttled sign-in shows "too many attempts", even with the right password', async ({ page }) => {
    test.setTimeout(180_000);
    const email = `rate-${randomBytes(4).toString('hex')}@restomatch.test`;
    await ensurePasswordUser({ email, password: PASSWORD });
    await page.context().addCookies([
      { name: 'rm_locale', value: 'he', url: BASE() },
      { name: 'rm_cookie_consent', value: 'necessary', url: BASE() },
    ]);

    // 10 wrong passwords: the per-account login limit (LOGIN_EMAIL_LIMIT = 10).
    for (let i = 1; i <= 10; i += 1) {
      expect(await attempt(page, email, `wrong-${i}`), `attempt ${i}`).toContain(WRONG);
    }
    // The 11th, with the correct password, is throttled: the rate copy, not "wrong password".
    const text = await attempt(page, email, PASSWORD);
    expect(text).toContain(RATE);
    expect(text).not.toContain(WRONG);
    await expect(page).toHaveURL(/error=rate/);
  });
});
