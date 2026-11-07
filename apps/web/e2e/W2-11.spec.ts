import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * W2-11 · the supplier page opens on "what now, in ₪":
 *   - the header's 90-day ₪ equals the leak card's ₪ (one definition);
 *   - old ?tab= links resolve into the 5 tabs;
 *   - the owner's vendor table: totals line = Σ rows;
 *   - the receiver gets no supplier ledger (page and procedure).
 */
const PASSWORD = 'RestoMatch-Demo-2026!';
let suppliers: Array<{ id: string; name: string }> = [];

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    suppliers = await sql<Array<{ id: string; name: string }>>`
      select s.id, s.name from suppliers s join restaurants r on r.id = s.restaurant_id
      where r.name = ${DEMO_RESTAURANT_NAME} and s.active order by s.name`;
  } finally {
    await sql.end();
  }
  expect(suppliers.length).toBeGreaterThan(1);
});

test.describe('owner', () => {
  test.use({ storageState: OWNER_STATE });

  test('the header ₪ equals the leak card ₪ for every supplier', async ({ page }) => {
    const errors = collectPageErrors(page);
    for (const s of suppliers.slice(0, 4)) {
      await page.goto(`/dashboard/suppliers/${s.id}`);
      await expect(page.getByTestId('supplier-overview')).toBeVisible();
      const header = page.getByTestId('supplier-leak-header');
      const headerAgorot = Number(await header.getAttribute('data-agorot'));
      const total = page.getByTestId('supplier-leak-total');
      if (await total.count()) {
        expect(Number(await total.getAttribute('data-agorot'))).toBe(headerAgorot);
      } else {
        await expect(page.getByTestId('supplier-leak-clean')).toBeVisible();
        expect(headerAgorot).toBe(0);
      }
    }
    expect(errors).toEqual([]);
  });

  test('5 tabs; old ?tab= values land in their new home', async ({ page }) => {
    const id = suppliers[0]!.id;
    await page.goto(`/dashboard/suppliers/${id}`);
    const tabs = page.getByRole('navigation', { name: 'תצוגת ספק' }).getByRole('link');
    await expect(tabs).toHaveText(['סקירה', 'מחירים', 'הזמנות', 'כרטסת', 'פרטים']);
    for (const [legacy, current] of [
      ['leak', 'סקירה'],
      ['catalog', 'מחירים'],
      ['schedule', 'פרטים'],
      ['details', 'פרטים'],
    ] as const) {
      await page.goto(`/dashboard/suppliers/${id}?tab=${legacy}`);
      await expect(page.locator('nav a[aria-current="page"]')).toHaveText(current);
    }
  });

  test('the vendor table: sorted by the 90-day leak, totals = Σ rows', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/dashboard/suppliers');
    await expect(page.getByTestId('vendor-table')).toBeVisible();
    const res = await page.request.get(`/api/trpc/suppliers.table?input=${encodeURIComponent(JSON.stringify({ json: { includeInactive: true } }))}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      result: { data: { json: { rows: { leakAgorot: number; monthSpendAgorot: number }[]; totals: { leakAgorot: number; monthSpendAgorot: number } } } };
    };
    const { rows, totals } = body.result.data.json;
    expect(totals.leakAgorot).toBe(rows.reduce((s, r) => s + r.leakAgorot, 0));
    expect(totals.monthSpendAgorot).toBe(rows.reduce((s, r) => s + r.monthSpendAgorot, 0));
    expect(errors).toEqual([]);
  });
});

async function signIn(context: BrowserContext, page: Page, email: string): Promise<void> {
  const base = test.info().project.use.baseURL!;
  await context.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: base },
    { name: 'rm_locale', value: 'he', url: base },
  ]);
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { email, password: PASSWORD, rememberMe: 'false', csrfToken: csrf.csrfToken, callbackUrl: '/dashboard' },
    maxRedirects: 0,
  });
  expect(res.status(), `password sign-in for ${email}`).toBeLessThan(400);
}

test('the receiver gets no supplier ledger: the page and the procedure are refused', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(context, page, 'receiver@kfar-hazeitim.test');
  const res = await page.request.get(`/api/trpc/suppliers.ledgerGrid?input=${encodeURIComponent(JSON.stringify({ json: { months: 6 } }))}`);
  expect(res.status()).toBe(403);
  const overview = await page.request.get(
    `/api/trpc/suppliers.overview?input=${encodeURIComponent(JSON.stringify({ json: { supplierId: suppliers[0]!.id } }))}`,
  );
  expect(overview.status()).toBe(403);
  const nav = await page.goto('/dashboard/suppliers/ledger');
  expect(/\/dashboard$/.test(page.url()) || nav?.status() === 403).toBe(true);
  await context.close();
});
