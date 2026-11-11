import { readFile, unlink } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, MAGIC_LINK_FILE, OWNER_STATE } from './env';
import { e2eSql, ensurePasswordUser } from './helpers';

/**
 * W3-07b · invite → /join/<token> → e-mail code → own password → /welcome →
 * role home. Local run: the dev code hook writes beside MAGIC_LINK_FILE (no
 * e-mail provider). The staging run with the real Resend path is the manual
 * runbook in docs/ux/wave3/W3-07b.md §6 (a person reads the inbox).
 */
const JOIN_CODE_FILE = MAGIC_LINK_FILE.replace('magic-link', 'join-code');
const PASSWORD = 'W3-07b e2e password 2026';

async function readCodeFile(file: string, email: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as { to: string; code: string };
      if (parsed.to === email) return parsed.code;
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`code for ${email} did not appear in ${file}`);
}

async function readJoinCode(email: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(JOIN_CODE_FILE, 'utf8')) as { to: string; code: string };
      if (parsed.to === email) return parsed.code;
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`join code for ${email} did not appear in ${JOIN_CODE_FILE}`);
}

/** The owner invites `email`; returns the /join link from the WhatsApp share button. */
async function inviteFromTeamScreen(page: Page, email: string): Promise<string> {
  await page.goto('/dashboard/team');
  await page.locator('#invite-email').fill(email);
  await page.locator('#invite-role').selectOption('receiver');
  await page.getByRole('button', { name: 'שליחת הזמנה' }).click();
  const wa = page.getByTestId('invite-whatsapp');
  await expect(wa).toBeVisible();
  const href = (await wa.getAttribute('href')) ?? '';
  const text = decodeURIComponent(href.replace(/^https:\/\/wa\.me\/\?text=/, ''));
  const link = /https?:\/\/\S+\/join\/[A-Za-z0-9_-]+(\?\S*)?/.exec(text)?.[0];
  expect(link, 'join link in the WhatsApp text').toBeTruthy();
  return new URL(link!).pathname;
}

test.describe('W3-07b join', () => {
  test.use({ storageState: OWNER_STATE });

  test.beforeAll(async () => {
    const sql = e2eSql();
    await sql`delete from rate_limit_counters`;
    await sql.end();
  });

  test('invite → /join → code → /welcome → role home; the link is single-use', async ({ page, browser }) => {
    const email = `w307b-${Date.now()}@join.e2e.test`;
    const joinPath = await inviteFromTeamScreen(page, email);

    const ctx = await browser.newContext({ storageState: undefined, locale: 'he-IL' });
    const base = test.info().project.use.baseURL!;
    await ctx.addCookies([
      { name: 'rm_cookie_consent', value: 'necessary', url: base },
      { name: 'rm_locale', value: 'he', url: base },
    ]);
    const anon = await ctx.newPage();
    await unlink(JOIN_CODE_FILE).catch(() => {});

    await anon.goto(joinPath);
    await expect(anon.getByRole('heading', { level: 1 })).toContainText(DEMO_RESTAURANT_NAME);
    await expect(anon.getByTestId('join-role')).toBeVisible();
    await anon.getByTestId('join-send-code').click();
    await expect(anon.getByTestId('join-code-form')).toBeVisible();

    const code = await readJoinCode(email);
    await anon.locator('#join-name').fill('דנה מהמטבח');
    await anon.locator('#join-password').fill(PASSWORD);
    await anon.locator('#join-code').fill(code); // auto-submits on the 6th digit

    await anon.waitForURL(/\/welcome/, { timeout: 60_000 });
    await expect(anon.locator('#welcome-name')).toHaveValue('דנה מהמטבח');
    await anon.getByRole('button', { name: /סיום/ }).click();
    await anon.waitForURL(/\/dashboard/, { timeout: 60_000 });
    expect(anon.url()).not.toContain('/onboarding');

    const sql = e2eSql();
    const rows = await sql`
      select m.role from memberships m join users u on u.id = m.user_id where u.email = ${email}`;
    await sql.end();
    expect(rows.map((r) => r.role)).toEqual(['receiver']);

    // single use: the same link is now a calm "used" state, without the restaurant
    const again = await (await browser.newContext({ storageState: undefined })).newPage();
    await again.goto(joinPath);
    await expect(again.getByTestId('join-state')).toHaveAttribute('data-state', 'used');
    await ctx.close();
  });

  test('an unknown token is a calm not-found state', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: undefined })).newPage();
    await page.goto('/join/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await expect(page.getByTestId('join-state')).toHaveAttribute('data-state', 'notFound');
  });
});

test.describe('W3-07b slice b: sign in with an e-mail code', () => {
  test('e-mail → 6-digit code → signed in; a wrong code is refused calmly', async ({ browser }) => {
    const email = `w307b-code-${Date.now()}@login.e2e.test`;
    await ensurePasswordUser({ email, password: 'W3-07b code-login 2026' });
    const sql = e2eSql();
    await sql`delete from rate_limit_counters`;
    await sql.end();
    const file = MAGIC_LINK_FILE.replace('magic-link', 'login-code');
    await unlink(file).catch(() => {});

    const ctx = await browser.newContext({ storageState: undefined, locale: 'he-IL' });
    const base = test.info().project.use.baseURL!;
    await ctx.addCookies([
      { name: 'rm_cookie_consent', value: 'necessary', url: base },
      { name: 'rm_locale', value: 'he', url: base },
    ]);
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.locator('input[name="email"]').first().fill(email);
    await page.getByTestId('login-code-button').click();
    await page.waitForURL(/\/login\/code/);
    await expect(page.getByTestId('login-code-sent')).toBeVisible();

    const code = await readCodeFile(file, email);
    const wrong = code === '000000' ? '111111' : '000000';
    await page.locator('#login-code').fill(wrong);
    await page.waitForURL(/e=wrongCode/);
    await page.locator('#login-code').fill(code);
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    await ctx.close();
  });
});
