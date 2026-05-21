import { expect, test } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import { createDb, memberships, restaurants, users } from '@restomatch/db';
import { MAGIC_LINK_FILE } from '../playwright.config';

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';

test.beforeEach(async () => {
  const db = createDb(TEST_DB_URL);
  await db.delete(memberships);
  await db.delete(restaurants);
  await db.delete(users);
  try {
    await unlink(MAGIC_LINK_FILE);
  } catch {
    /* file may not exist */
  }
});

async function waitForMagicLink(): Promise<string> {
  for (let i = 0; i < 30; i += 1) {
    try {
      const raw = await readFile(MAGIC_LINK_FILE, 'utf8');
      const parsed = JSON.parse(raw) as { url: string };
      return parsed.url;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('magic link file did not appear within 15s');
}

test('signup → magic link → onboarding → dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RestoMatch' })).toBeVisible();

  await page.getByRole('link', { name: 'כניסה למערכת' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('כתובת מייל').fill('e2e-owner@restomatch.test');
  await page.getByRole('button', { name: 'שלח לי קישור התחברות' }).click();

  // Auth.js redirects to its built-in /api/auth/verify-request page
  // after sending the magic link. We don't assert on the exact URL
  // because the verifyRequest page config doesn't always override it.
  const magicUrl = await waitForMagicLink();
  await page.goto(magicUrl);

  await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 });

  await page.getByLabel(/שם המסעדה/).fill('כפר הזיתים E2E');
  await page.getByRole('button', { name: /צור מסעדה והמשך/ }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'כפר הזיתים E2E' })).toBeVisible();
  await expect(page.getByText('בעלים')).toBeVisible();
});

test('logged-in user redirects from /login to /dashboard via session check', async ({
  page,
}) => {
  // Walk through signup to establish session
  await page.goto('/login');
  await page.getByLabel('כתובת מייל').fill('e2e-redirect@restomatch.test');
  await page.getByRole('button', { name: 'שלח לי קישור התחברות' }).click();
  const magicUrl = await waitForMagicLink();
  await page.goto(magicUrl);
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 });
  await page.getByLabel(/שם המסעדה/).fill('Redirect Restaurant');
  await page.getByRole('button', { name: /צור מסעדה והמשך/ }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

  // Now visit home — CTA should say "לדשבורד"
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'לדשבורד' })).toBeVisible();
});
