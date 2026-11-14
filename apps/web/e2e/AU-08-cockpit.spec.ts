import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * AU-08 (A13) · the "מספר הקצאה" field mounted in the invoice cockpit (W2-02).
 *
 *   - bookkeeper: the field shows "חסר" on an at-risk invoice with no number; a typo is
 *     refused inline (nothing saved); 9 digits save → "תקין (פורמט)", one vat.allocation_set
 *     audit row, and after a reload the cockpit's VAT-at-risk badge is gone;
 *   - manager: reads the field, never the edit button (writes are owner + bookkeeper);
 *   - axe (serious/critical) on the mounted field.
 *
 * Own supplier + invoice (₪6,000 before VAT — over the allocation threshold, dated 3 Israel days ago) so it never touches
 * the demo rows or the card spec's fixture.
 */

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const SUPPLIER = 'AU-08 ספק קוקפיט';
const INVOICE_NO = 'AU08-E2E-COCKPIT';
const NUMBER = '123456789';

let restaurantId = '';
let supplierId = '';
let invoiceId = '';

function israelDayOffset(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function setCount(): Promise<number> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where restaurant_id = ${restaurantId} and action = 'vat.allocation_set' and entity_id = ${invoiceId}`;
    return r?.n ?? 0;
  } finally {
    await sql.end();
  }
}

/** Same throttle reset as AU-08.spec.ts (3 magic links per mailbox per 15 min). */
async function signIn(page: Page, email: string) {
  const sql = e2eSql();
  try {
    await sql`delete from rate_limit_counters where key like ${'magiclink:%'}`;
  } finally {
    await sql.end();
  }
  await loginViaMagicLink(page, email);
}

async function setLocale(page: Page, locale: 'he' | 'en') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

async function openField(page: Page) {
  await page.goto(`/dashboard/invoices/${invoiceId}`, { waitUntil: 'load' });
  const field = page.getByTestId('allocation-field');
  await expect(field).toBeVisible({ timeout: 30_000 });
  return field;
}

async function axeSerious(page: Page, selector: string): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (sel) => {
    const w = window as unknown as {
      axe: { run: (ctx: Element, opts: object) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> };
    };
    const el = document.querySelector(sel);
    if (!el) return ['missing-target'];
    const r = await w.axe.run(el, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  }, selector);
}

test.describe('AU-08 · allocation field in the cockpit', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const sql = e2eSql();
    try {
      const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
      restaurantId = r!.id;
      const [s] = await sql<{ id: string }[]>`
        insert into suppliers (restaurant_id, name) values (${restaurantId}, ${SUPPLIER}) returning id`;
      supplierId = s!.id;
      const day = israelDayOffset(-3);
      const [i] = await sql<{ id: string }[]>`
        insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, total_excl_vat, vat_amount, status, source)
        values (${restaurantId}, ${supplierId}, ${INVOICE_NO}, ${`${day}T10:00:00+02:00`}, '6000.00', '1080.00', 'parsed', 'photo')
        returning id`;
      invoiceId = i!.id;
    } finally {
      await sql.end();
    }
  });

  test.afterAll(async () => {
    const sql = e2eSql();
    try {
      // audit_log is append-only; the fixture invoice and supplier go, their audit rows stay.
      if (invoiceId) await sql`delete from invoices where id = ${invoiceId}`;
      if (supplierId) await sql`delete from suppliers where id = ${supplierId}`;
    } finally {
      await sql.end();
    }
  });

  test('manager: reads the field, never the edit button', async ({ page }) => {
    await setLocale(page, 'he');
    await signIn(page, 'manager@kfar-hazeitim.test');
    const field = await openField(page);
    await expect(field.getByTestId('allocation-state')).toContainText('חסר');
    await expect(field.getByTestId('allocation-edit')).toHaveCount(0);
  });

  test('axe: the mounted field has no serious/critical issue (he)', async ({ page }) => {
    await setLocale(page, 'he');
    await signIn(page, 'bookkeeper@kfar-hazeitim.test');
    await openField(page);
    expect(await axeSerious(page, '[data-testid="allocation-field"]')).toEqual([]);
  });

  test('bookkeeper: missing → typo refused → 9 digits saved once, badge gone after reload', async ({ page }) => {
    test.setTimeout(90_000);
    await setLocale(page, 'he');
    await signIn(page, 'bookkeeper@kfar-hazeitim.test');
    const field = await openField(page);
    await expect(page.getByTestId('invoice-vat-at-risk')).toBeVisible();
    await expect(field).toHaveAttribute('data-state', 'missing');
    await expect(field.getByTestId('allocation-state')).toContainText('חסר');
    await expect(field.getByTestId('allocation-deadline')).toBeVisible();

    await field.getByTestId('allocation-edit').click();
    await field.getByTestId('allocation-input').fill('12345');
    await field.getByTestId('allocation-save').click();
    await expect(field.getByRole('alert')).toBeVisible();
    expect(await setCount()).toBe(0);

    await field.getByTestId('allocation-input').fill('123-456-789');
    await field.getByTestId('allocation-save').click();
    await expect(field).toHaveAttribute('data-state', 'valid');
    await expect(field.getByTestId('allocation-state')).toContainText('תקין (פורמט)');
    await expect(field.getByTestId('allocation-value')).toHaveText(NUMBER);
    await expect.poll(setCount).toBe(1);

    const again = await openField(page);
    await expect(again).toHaveAttribute('data-state', 'valid');
    await expect(page.getByTestId('invoice-vat-at-risk')).toHaveCount(0);
  });
});
