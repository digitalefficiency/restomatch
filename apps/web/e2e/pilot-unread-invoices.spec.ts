import { expect, test, type Browser } from '@playwright/test';
import { DEMO_RESTAURANT_NAME } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/** PILOT (train B, W2-02): the owner finds an unread photo invoice from home → the list → the invoice. */
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';

async function signedIn(browser: Browser, role: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const base = test.info().project.use.baseURL!;
  await context.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: base },
    { name: 'rm_locale', value: 'he', url: base },
  ]);
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { email: `${role}@kfar-hazeitim.test`, password: PASSWORD, rememberMe: 'false', csrfToken: csrf.csrfToken, callbackUrl: '/dashboard' },
    maxRedirects: 0,
  });
  expect(res.status()).toBeLessThan(400);
  return page;
}

test('an unread photo invoice shows on home and in the waiting list, and opens its page', async ({ browser }) => {
  const number = `PILOT-${Date.now()}`;
  const sql = e2eSql();
  let id: string;
  try {
    const [r] = await sql<{ id: string; supplier: string }[]>`
      select r.id, (select s.id from suppliers s where s.restaurant_id = r.id order by s.created_at limit 1) as supplier
      from restaurants r where r.name = ${DEMO_RESTAURANT_NAME} order by r.created_at limit 1`;
    const [inv] = await sql<{ id: string }[]>`
      insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, status, source, ocr_payload)
      values (${r!.id}, ${r!.supplier}, ${number}, now(), 'parsed', 'photo',
        ${sql.json({ provider: 'reconciled', raw: { ocrFailed: true, reason: 'extraction_failed' } })})
      returning id`;
    id = inv!.id;
  } finally {
    await sql.end();
  }
  const page = await signedIn(browser, 'owner');
  const errors = collectPageErrors(page);
  await page.goto('/dashboard');
  await expect(page.locator('a[href="/dashboard/invoices"]').filter({ hasText: 'חשבוניות ממתינות להשלמת שורות' })).toBeVisible();
  await page.goto('/dashboard/invoices');
  await expect(page.getByRole('heading', { level: 1, name: 'חשבוניות שממתינות להשלמת שורות' })).toBeVisible();
  const row = page.getByTestId('needs-lines-row').filter({ hasText: number });
  await expect(row).toContainText('הקריאה נכשלה');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/invoices/${id!}`));
  expect(errors).toEqual([]);
  await page.context().close();
  // Leave the shared e2e tenant as seeded: other home specs count the "מחכה לך" rows.
  const clean = e2eSql();
  try {
    await clean`delete from invoices where id = ${id!}`;
  } finally {
    await clean.end();
  }
});

test('the receiver and the chef cannot open the list', async ({ browser }) => {
  for (const role of ['receiver', 'chef']) {
    const page = await signedIn(browser, role);
    const res = await page.goto('/dashboard/invoices');
    expect(res?.status() === 403 || res?.status() === 404 || /\/dashboard$/.test(page.url()), role).toBe(true);
    await expect(page.getByTestId('invoices-needs-lines')).toHaveCount(0);
    await page.context().close();
  }
});
