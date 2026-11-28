import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql, ensurePasswordUser } from './helpers';

/**
 * W3-07a slice 1: every platform-admin write in /admin is staged (before → after)
 * and needs a typed reason, which lands in the audit row's `after.reason`.
 * Nothing is written before "אישור השינוי"; "ביטול" writes nothing.
 */
const PASSWORD = 'E2e-Admin-Staged-7!';
const BASE = () => test.info().project.use.baseURL ?? 'http://localhost:3100';

async function adminFixture() {
  const tag = randomBytes(4).toString('hex');
  const adminEmail = `w307a-admin-${tag}@restomatch.test`;
  const memberEmail = `w307a-member-${tag}@restomatch.test`;
  const secret = authenticator.generateSecret();
  await ensurePasswordUser({ email: adminEmail, password: PASSWORD, totpSecret: secret });
  const sql = e2eSql();
  try {
    await sql`update users set is_platform_admin = true where email = ${adminEmail}`;
    // Past the short arming grace of a fresh enrolment (lib/secondFactorGate).
    await sql`
      update user_credentials set totp_enabled_at = now() - interval '1 minute'
      where user_id = (select id from users where email = ${adminEmail})`;
    const [restaurant] = await sql<{ id: string }[]>`
      select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    const [member] = await sql<{ id: string }[]>`
      insert into users (email, name, email_verified) values (${memberEmail}, 'W3-07a', now())
      returning id`;
    await sql`
      insert into memberships (user_id, restaurant_id, role)
      values (${member!.id}, ${restaurant!.id}, 'receiver')`;
    return { adminEmail, memberEmail, memberId: member!.id, restaurantId: restaurant!.id, secret };
  } finally {
    await sql.end();
  }
}

async function roleOf(restaurantId: string, userId: string): Promise<string | undefined> {
  const sql = e2eSql();
  try {
    const [m] = await sql<{ role: string }[]>`
      select role from memberships where restaurant_id = ${restaurantId} and user_id = ${userId}`;
    return m?.role;
  } finally {
    await sql.end();
  }
}

async function auditAfter(restaurantId: string, action: string, entityId: string) {
  const sql = e2eSql();
  try {
    return await sql<{ after: Record<string, unknown> }[]>`
      select after from audit_log
      where restaurant_id = ${restaurantId} and action = ${action} and entity_id = ${entityId}
      order by at desc`;
  } finally {
    await sql.end();
  }
}

async function signInAsAdmin(page: Page, email: string, secret: string) {
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url: BASE() },
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE() },
  ]);
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form:has(#password) button[type=submit]').click();
  await expect(page).toHaveURL(/\/login\/2fa/);
  await page.locator('input[name="code"]').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'אימות' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test('a role change is staged, needs a reason, and the reason reaches the audit row', async ({ page }) => {
  test.setTimeout(180_000);
  const f = await adminFixture();
  await signInAsAdmin(page, f.adminEmail, f.secret);
  await page.goto(`/admin/restaurants/${f.restaurantId}`);

  // Picking a role only stages it: the card shows before → after, nothing is written.
  await page.getByLabel(`תפקיד עבור ${f.memberEmail}`).selectOption('chef');
  const card = page.getByTestId('staged-change');
  await expect(card).toBeVisible();
  await expect(card.getByText('שינוי ממתין לאישור')).toBeVisible();
  expect(await roleOf(f.restaurantId, f.memberId)).toBe('receiver');

  // The one primary stays disabled until a reason of 3+ characters is typed.
  const confirm = card.getByRole('button', { name: 'אישור השינוי' });
  await expect(confirm).toBeDisabled();
  await card.getByLabel('סיבה (חובה)').fill('  ');
  await expect(confirm).toBeDisabled();
  await card.getByLabel('סיבה (חובה)').fill('  עבר למטבח  ');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(card).toBeHidden();
  await expect.poll(() => roleOf(f.restaurantId, f.memberId)).toBe('chef');
  const rows = await auditAfter(f.restaurantId, 'admin.role_set', f.memberId);
  expect(rows[0]?.after).toMatchObject({ role: 'chef', reason: 'עבר למטבח' });
});

test('cancel restores the form and writes nothing', async ({ page }) => {
  test.setTimeout(180_000);
  const f = await adminFixture();
  await signInAsAdmin(page, f.adminEmail, f.secret);
  await page.goto(`/admin/restaurants/${f.restaurantId}`);

  const select = page.getByLabel(`תפקיד עבור ${f.memberEmail}`);
  await select.selectOption('manager');
  const card = page.getByTestId('staged-change');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'ביטול' }).click();
  await expect(card).toBeHidden();
  await expect(select).toHaveValue('receiver');
  expect(await roleOf(f.restaurantId, f.memberId)).toBe('receiver');
  expect(await auditAfter(f.restaurantId, 'admin.role_set', f.memberId)).toHaveLength(0);
});

test('a feature flag change is staged, needs a reason, and shows its source', async ({ page }) => {
  test.setTimeout(180_000);
  const f = await adminFixture();
  // A throwaway restaurant: toggling flags on the demo tenant would leak into other specs.
  const sql = e2eSql();
  let restaurantId: string;
  try {
    const [r] = await sql<{ id: string }[]>`
      insert into restaurants (name, settings) values (${`W3-07a flags ${randomBytes(3).toString('hex')}`}, ${sql.json({ features: { contracts: true } })})
      returning id`;
    restaurantId = r!.id;
  } finally {
    await sql.end();
  }
  await signInAsAdmin(page, f.adminEmail, f.secret);
  await page.goto(`/admin/restaurants/${restaurantId}`);

  // "פיצ׳רים פעילים" names what is in effect, and each row says why.
  await expect(page.getByTestId('active-features')).toContainText('contracts');
  await expect(page.locator('tr:has(#feature-contracts) [data-source]')).toHaveAttribute('data-source', 'stored');

  // Toggling only stages it; nothing is written until confirm with a reason.
  await page.locator('#feature-contracts').uncheck();
  await page.getByRole('button', { name: 'לבדיקה ואישור' }).last().click();
  const card = page.getByTestId('staged-change');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'אישור השינוי' })).toBeDisabled();
  await card.getByLabel('סיבה (חובה)').fill('כיבוי לבדיקה');
  await card.getByRole('button', { name: 'אישור השינוי' }).click();
  await expect(card).toBeHidden();

  const rows = await auditAfter(restaurantId, 'admin.features', restaurantId);
  expect(rows[0]?.after).toMatchObject({ contracts: false, reason: 'כיבוי לבדיקה' });
});

test.describe('slice 2 · connections hub and plan usage (demo owner)', () => {
  test.use({ storageState: OWNER_STATE, viewport: { width: 1440, height: 900 } });

  test('the hub groups every connection with a status chip', async ({ page }) => {
    await page.goto('/dashboard/integrations');
    const board = page.getByTestId('hub-status');
    await expect(board.getByRole('heading', { name: 'חיבורים' })).toBeVisible();
    for (const group of ['accounting', 'pos', 'procurement']) {
      await expect(board.locator(`[data-group="${group}"]`)).toBeVisible();
    }
    // Every tile carries a known status; "not connected" is never an error.
    const statuses = await board.locator('[data-tile]').evaluateAll((els) => els.map((e) => e.getAttribute('data-status')));
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) expect(['connected', 'sample', 'error', 'not_connected', 'contact']).toContain(s);
  });

  test('settings shows a read-only plan and usage, with no ₪', async ({ page }) => {
    await page.goto('/dashboard/settings');
    const plan = page.getByTestId('plan-usage');
    await expect(plan).toBeVisible();
    // The usage rows sit in a "פרטים" fold (the settings page has a W2-16 word budget).
    const toggle = plan.locator('[data-explain-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(plan.locator('[data-row="scans"]')).toBeVisible();
    await expect(plan.locator('[data-row="seats"]')).toBeVisible();
    await expect(plan).not.toContainText('₪');
    // Read-only: the fold toggle is the only control.
    await expect(plan.locator('input, select, a')).toHaveCount(0);
    await expect(plan.locator('button')).toHaveCount(1);
  });
});
