import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authenticator } from 'otplib';
import { ensurePasswordUser } from './helpers';

/**
 * Train-A review (MEDIUM): a session minted BEFORE the account enrolled 2FA was
 * never pending the second factor, so it kept full access (admin console
 * included) for its whole lifetime. Now the jwt callback revokes it on the next
 * request; a fresh sign-in has to pass /login/2fa.
 */
const PASSWORD = 'E2e-Correct-Horse-9!';
const BASE = () => test.info().project.use.baseURL ?? 'http://localhost:3100';

test('a session from before 2FA enrolment is signed out; password + TOTP gets back in', async ({ page }) => {
  test.setTimeout(180_000);
  const email = `mfa-${randomBytes(4).toString('hex')}@restomatch.test`;
  await ensurePasswordUser({ email, password: PASSWORD }); // no 2FA yet
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url: BASE() },
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE() },
  ]);

  const signIn = async () => {
    await page.goto('/login');
    await page.locator('form:has(#password) [name=email]').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('form:has(#password) button[type=submit]').click();
  };

  await signIn();
  await expect(page).toHaveURL(/\/dashboard/);

  // The account enrols 2FA elsewhere (another device / the DB) — this browser's
  // token predates it and never passed a second factor.
  const secret = authenticator.generateSecret();
  await ensurePasswordUser({ email, password: PASSWORD, totpSecret: secret });

  await page.goto('/dashboard/settings');
  await expect(page).toHaveURL(/\/login/);

  // A fresh sign-in must pass the second factor, and then it works.
  await signIn();
  await expect(page).toHaveURL(/\/login\/2fa/);
  await page.locator('input[name="code"]').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'אימות' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/dashboard/settings');
  await expect(page).toHaveURL(/\/dashboard\/settings/);
});

test('enrolling 2FA in Settings keeps THIS session signed in (it just proved a TOTP code)', async ({ page }) => {
  test.setTimeout(180_000);
  const email = `mfa-enrol-${randomBytes(4).toString('hex')}@restomatch.test`;
  await ensurePasswordUser({ email, password: PASSWORD });
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url: BASE() },
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE() },
  ]);
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form:has(#password) button[type=submit]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/dashboard/settings');
  await page.getByRole('button', { name: 'הפעלת אימות דו-שלבי' }).click();
  const secret = (await page.locator('code').first().innerText()).trim();
  await page.locator('#confirm-code').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'אישור והפעלה' }).click();
  await expect(page.getByText('שמרו את קודי השחזור')).toBeVisible();

  // Still signed in after enrolment: the next request is not bounced to /login.
  await page.goto('/dashboard/settings');
  await expect(page).toHaveURL(/\/dashboard\/settings/);
});
