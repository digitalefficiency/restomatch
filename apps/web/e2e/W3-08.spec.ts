import { expect, test } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';
import { he } from '../lib/i18n/messages/reports/he';

/**
 * W3-08 · "דוח החודש" (owner decision I4): one copy of the month in 3 tabs.
 *   - the 3 tabs in order, `?tab=` switches, the month survives a tab change;
 *   - the number shows once on the proof tab; the by-supplier total equals it;
 *   - /dashboard/reports/digest answers 308 to the "כך זה נשלח" tab;
 *   - D11: the cover is set in Frank Ruhl Libre (the stack), and no ₪ sits under it.
 * The server's month is whatever its clock says, so nothing here pins an amount.
 */
test.use({ storageState: OWNER_STATE });

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    for (const flag of ['monthlyReport', 'monthlyDigestPreview']) {
      await sql`
        update restaurants
        set settings = jsonb_set(
          case jsonb_typeof(settings) when 'object' then settings when 'string' then (settings #>> '{}')::jsonb else '{}'::jsonb end,
          ${`{features,${flag}}`}::text[], 'true'::jsonb, true)
        where name = ${DEMO_RESTAURANT_NAME}`;
    }
  } finally {
    await sql.end();
  }
});

test.beforeEach(async ({ page }) => {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
});

test('three tabs, the number once, the month kept', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/dashboard/reports/monthly');
  await page.waitForLoadState('networkidle');
  const tabs = page.getByTestId('report-tabs').getByRole('link');
  await expect(tabs).toHaveText([he.tabs.proof, he.tabs.by, he.tabs.sent]);
  await expect(page.getByTestId('report-tab-proof')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('report-number')).toHaveCount(1);
  await expect(page.getByTestId('report-status')).toBeVisible();
  await expect(page.getByTestId('report-step').first()).toBeVisible();

  // Pick last month in the 12-month select; the tab link keeps it.
  const options = page.getByTestId('report-month').locator('option');
  await expect(options).toHaveCount(12);
  const last = await options.nth(1).getAttribute('value');
  await page.getByTestId('report-month').selectOption(last!);
  await page.getByRole('button', { name: he.show }).click();
  await expect(page).toHaveURL(new RegExp(`month=${last}`));
  await page.waitForLoadState('networkidle');
  const numberAgorot = await page.getByTestId('report-number').getAttribute('data-agorot');

  await page.getByTestId('report-tab-by').click();
  await expect(page).toHaveURL(new RegExp(`tab=by&month=${last}`));
  await expect(page.getByTestId('report-number')).toHaveCount(0);
  const total = page.getByTestId('report-supplier-total');
  if (await total.count()) {
    const restated = await page.getByTestId('report-restated-note').count();
    if (!restated) await expect(total).toHaveAttribute('data-agorot', numberAgorot!);
  }

  await page.getByTestId('report-tab-sent').click();
  await expect(page.getByTestId('report-email-frame')).toBeVisible();
  await expect(page.getByTestId('report-whatsapp')).toBeVisible();
  await expect(page.getByTestId('report-copy-me')).toBeDisabled();
  // The e-mail preview is an iframe with sandbox="" (no scripts, by design). Anything the dev
  // server injects into frames is blocked there and logged; that block is the sandbox working.
  const SANDBOX_BLOCK = /Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/;
  expect(errors.filter((e) => !SANDBOX_BLOCK.test(e))).toEqual([]);
});

test('the old digest page answers 308 to the sent tab', async ({ page }) => {
  const res = await page.request.get('/dashboard/reports/digest?month=2026-10', { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()['location']).toContain('/dashboard/reports/monthly?tab=sent&month=2026-10');
  await page.goto('/dashboard/reports/digest');
  await expect(page).toHaveURL(/tab=sent/);
  await expect(page.getByTestId('report-tab-sent')).toHaveAttribute('aria-current', 'page');
});

test('D11: Frank Ruhl Libre on the cover only, never on ₪', async ({ page }) => {
  await page.goto('/dashboard/reports/monthly');
  const coverFont = await page.getByTestId('report-cover-title').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(coverFont).toMatch(/Frank Ruhl Libre/);
  const numberFont = await page.getByTestId('report-number').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(numberFont).not.toMatch(/Frank Ruhl Libre/);
  // No shekel sign is rendered inside any display-face element.
  const shekelsInDisplay = await page.locator('.report-display').evaluateAll((els) => els.filter((e) => /₪/.test(e.textContent ?? '')).length);
  expect(shekelsInDisplay).toBe(0);
});

/** The seeded demo password (packages/db/scripts/seed.ts DEFAULT_DEMO_PASSWORD), as in W1-03. */
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';

test.describe('owner decision I3: the bookkeeper reads the month report', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('all 3 tabs and the digest open for the bookkeeper, read-only', async ({ page }) => {
    await page.goto('/login');
    await page.locator('form:has(#password) [name=email]').fill('bookkeeper@kfar-hazeitim.test');
    await page.locator('#password').fill(PASSWORD);
    await page.locator('form:has(#password) button[type=submit]').click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    for (const tab of ['proof', 'by', 'sent'] as const) {
      const res = await page.goto(`/dashboard/reports/monthly?tab=${tab}`);
      expect(res?.status(), tab).toBe(200);
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId(`report-tab-${tab}`)).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId(`report-${tab}`)).toBeVisible();
    }
    await page.goto('/dashboard/reports/digest');
    await expect(page).toHaveURL(/tab=sent/);
    await expect(page.getByTestId('report-sent')).toBeVisible();
    // Read-only: nothing to send from here.
    await expect(page.getByTestId('report-copy-me')).toBeDisabled();
  });
});
