import { expect, test } from '@playwright/test';
import { authenticator } from 'otplib';
import { e2eSql, ensurePasswordUser, loginViaMagicLink } from './helpers';

/**
 * Auth flows as they exist after the security stack (password primary, TOTP
 * 2FA, magic link as backup). Field selectors use `name=` attributes, not the
 * visible (translatable) labels.
 */
const PASSWORD = 'E2e-Correct-Horse-9!';

test.describe('password login', () => {
  test.beforeAll(async () => {
    await ensurePasswordUser({ email: 'e2e-password@restomatch.test', password: PASSWORD });
  });

  test('correct password → dashboard', async ({ page }) => {
    await page.goto('/login');
    const form = page.locator('form', { has: page.locator('input[name="password"]') });
    await form.locator('input[name="email"]').fill('e2e-password@restomatch.test');
    await form.locator('input[name="password"]').fill(PASSWORD);
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('header')).toContainText('e2e-password@restomatch.test');
  });

  test('wrong password → uniform error, stays on /login', async ({ page }) => {
    await page.goto('/login');
    const form = page.locator('form', { has: page.locator('input[name="password"]') });
    await form.locator('input[name="email"]').fill('e2e-password@restomatch.test');
    await form.locator('input[name="password"]').fill('definitely-wrong');
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login\?error=CredentialsSignin/);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('unauthenticated dashboard visit → /login', async ({ page }) => {
    await page.goto('/dashboard/approvals');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('two-factor (TOTP)', () => {
  const secret = authenticator.generateSecret();

  test.beforeAll(async () => {
    await ensurePasswordUser({ email: 'e2e-2fa@restomatch.test', password: PASSWORD, totpSecret: secret });
  });

  test('password → /login/2fa gate → code → dashboard', async ({ page }) => {
    await page.goto('/login');
    const form = page.locator('form', { has: page.locator('input[name="password"]') });
    await form.locator('input[name="email"]').fill('e2e-2fa@restomatch.test');
    await form.locator('input[name="password"]').fill(PASSWORD);
    await form.locator('button[type="submit"]').click();
    // The 2FA screen renders, but after the password server action the address
    // bar can keep the action's redirect target (/dashboard) — a Next quirk when
    // middleware redirects the RSC fetch (reported to S4). Assert on the form.
    await expect(page.locator('input[name="code"]')).toBeVisible();

    // The pending session must not reach the app before the second factor.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\/2fa/);
    await expect(page.locator('input[name="code"]')).toBeVisible();

    await page.locator('input[name="code"]').fill(authenticator.generate(secret));
    await page.locator('form', { has: page.locator('input[name="code"]') }).locator('button[type="submit"]').first().click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('input[name="code"]')).toHaveCount(0);
    await expect(page.locator('header')).toContainText('e2e-2fa@restomatch.test');
  });

  test('wrong code keeps the gate closed', async ({ page }) => {
    await page.goto('/login');
    const form = page.locator('form', { has: page.locator('input[name="password"]') });
    await form.locator('input[name="email"]').fill('e2e-2fa@restomatch.test');
    await form.locator('input[name="password"]').fill(PASSWORD);
    await form.locator('button[type="submit"]').click();
    // The 2FA screen renders, but after the password server action the address
    // bar can keep the action's redirect target (/dashboard) — a Next quirk when
    // middleware redirects the RSC fetch (reported to S4). Assert on the form.
    await expect(page.locator('input[name="code"]')).toBeVisible();
    await page.locator('input[name="code"]').fill('000000');
    await page.locator('form', { has: page.locator('input[name="code"]') }).locator('button[type="submit"]').first().click();
    await expect(page).toHaveURL(/\/login\/2fa\?error=/);
    await expect(page.getByRole('alert')).toBeVisible();
    // Still gated: the app is unreachable without the second factor.
    await page.goto('/dashboard/approvals');
    await expect(page).toHaveURL(/\/login\/2fa/);
  });
});

test.describe('magic link (backup) + onboarding', () => {
  const email = `e2e-new-${Date.now()}@restomatch.test`;

  test.afterAll(async () => {
    const sql = e2eSql();
    try {
      await sql`delete from restaurants where id in (
        select restaurant_id from memberships m join users u on u.id = m.user_id where u.email = ${email})`;
      await sql`delete from users where email = ${email}`;
    } finally {
      await sql.end();
    }
  });

  test('new user: magic link → onboarding → own restaurant dashboard', async ({ page }) => {
    await loginViaMagicLink(page, email, '/dashboard');
    await expect(page).toHaveURL(/\/onboarding/);
    const form = page.locator('form', { has: page.locator('input#name') });
    await form.locator('input#name').fill('מסעדת E2E');
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('banner')).toContainText('מסעדת E2E');
  });
});
