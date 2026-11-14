import { readFile, unlink } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, MAGIC_LINK_FILE, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * W3-07b · invite → /join/<token> → e-mail code → own password → /welcome →
 * role home. Local run: the dev code hook writes beside MAGIC_LINK_FILE (no
 * e-mail provider). The staging run with the real Resend path is the manual
 * runbook in docs/ux/wave3/W3-07b.md §6 (a person reads the inbox).
 */
const JOIN_CODE_FILE = MAGIC_LINK_FILE.replace('magic-link', 'join-code');
const PASSWORD = 'W3-07b e2e password 2026';

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

  test('no account oracle: /join looks the same for an existing account and a new address, before and after "send"', async ({
    page,
    browser,
  }) => {
    // Same first/last letter and domain, so the masked addresses on screen match too.
    const stamp = Date.now();
    const existing = `xexisting${stamp}z@oracle.e2e.test`;
    const fresh = `xfresh${stamp}z@oracle.e2e.test`;
    const sql = e2eSql();
    await sql`insert into users (email, name, email_verified) values (${existing}, 'Existing account', now())`;
    await sql.end();

    const pathExisting = await inviteFromTeamScreen(page, existing);
    const pathFresh = await inviteFromTeamScreen(page, fresh);

    const ctx = await browser.newContext({ storageState: undefined, locale: 'he-IL' });
    const base = test.info().project.use.baseURL!;
    await ctx.addCookies([
      { name: 'rm_cookie_consent', value: 'necessary', url: base },
      { name: 'rm_locale', value: 'he', url: base },
    ]);
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await a.goto(pathExisting);
    await b.goto(pathFresh);
    const card = (p: Page) => p.locator('main').innerText();
    await expect(a.getByTestId('join-send-code')).toBeVisible();
    await expect(b.getByTestId('join-send-code')).toBeVisible();
    expect(await card(a)).toBe(await card(b));
    expect(await a.getByTestId('join-has-password').count()).toBe(0);

    const SIGNIN_FILE = MAGIC_LINK_FILE.replace('magic-link', 'join-signin');
    await unlink(SIGNIN_FILE).catch(() => {});
    await a.getByTestId('join-send-code').click();
    await b.getByTestId('join-send-code').click();
    await expect(a.getByTestId('join-code-form')).toBeVisible();
    await expect(b.getByTestId('join-code-form')).toBeVisible();
    expect(await card(a)).toBe(await card(b));
    expect(new URL(a.url()).search).toBe(new URL(b.url()).search);

    // server-side only: the existing account got a sign-in link (no code), the new address a code
    await readJoinCode(fresh);
    const deadline = Date.now() + 30_000;
    let link: { to: string; url: string } | null = null;
    while (!link && Date.now() < deadline) {
      try {
        const parsed = JSON.parse(await readFile(SIGNIN_FILE, 'utf8')) as { to: string; url: string };
        if (parsed.to === existing) link = parsed;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    expect(link?.url).toMatch(/\/login\?callbackUrl=/);
    await ctx.close();
  });
});
