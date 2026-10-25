import { expect, test } from '@playwright/test';
import { en as ordersEn } from '../lib/i18n/messages/orders/en';
import { he as ordersHe } from '../lib/i18n/messages/orders/he';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * The order wizard asks for a delivery date (none of the demo suppliers has an
 * order schedule, so before this every live order went out undated): the date
 * input starts at tomorrow in the restaurant's zone (past Fri/Sat), the order
 * is saved with it, and the supplier document carries it. Hebrew + English,
 * desktop + phone.
 */

test.use({ storageState: OWNER_STATE });

type Locale = 'he' | 'en';
const MSG = { he: ordersHe, en: ordersEn } as const;
const VIEWPORTS = [
  { name: '1366', use: { viewport: { width: 1366, height: 900 } } },
  { name: '390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
] as const;
const TZ = 'Asia/Jerusalem';

let supplierId = '';

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string }[]>`
      select s.id from suppliers s join restaurants r on r.id = s.restaurant_id
      where r.name = ${DEMO_RESTAURANT_NAME} and s.order_schedule is null
        and exists (select 1 from supplier_catalog_items c where c.supplier_id = s.id and c.active)
      order by s.name limit 1`;
    if (!row) throw new Error('seed needs a supplier without a schedule that has catalog items');
    supplierId = row.id;
  } finally {
    await sql.end();
  }
});

/** Tomorrow in Asia/Jerusalem, rolled past Fri/Sat — the wizard's default. */
function expectedDefaultDate(now = new Date()): string {
  const key = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const wd = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
  let d = new Date(now.getTime() + 24 * 3600 * 1000);
  while (wd(d) === 'Fri' || wd(d) === 'Sat') d = new Date(d.getTime() + 24 * 3600 * 1000);
  return key(d);
}

for (const vp of VIEWPORTS) {
  test.describe(`order wizard delivery date @${vp.name}`, () => {
    test.use(vp.use);
    for (const locale of ['he', 'en'] as const satisfies readonly Locale[]) {
      test(`${locale}: the date defaults to the next delivery day and the order is saved with it`, async ({ page }) => {
        const m = MSG[locale];
        const errors = collectPageErrors(page);
        const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
        await page.context().addCookies([
          { name: 'rm_locale', value: locale, url },
          { name: 'rm_cookie_consent', value: 'necessary', url },
        ]);
        await page.goto(`/dashboard/orders/new?supplierId=${supplierId}`);
        const firstItem = page.getByTestId('catalog-item').first();
        await expect(firstItem).toBeVisible({ timeout: 30_000 });
        await firstItem.click();
        await page.getByRole('button', { name: m.wizard.toReview }).click();

        const date = page.getByTestId('order-delivery-date');
        const expected = expectedDefaultDate();
        await expect(date).toHaveValue(expected);
        await expect(page.getByText(m.wizard.noSchedule)).toBeVisible();

        await page.locator('#ord-channel').selectOption('none');
        // The send button names the effect (W1-11) and waits out a 10 s undo window.
        const send = page.getByTestId('cart-primary');
        await expect(send).toHaveText(new RegExp(m.send.cta.none.split('{supplier}')[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        await send.click();
        await expect(page.getByRole('status').filter({ hasText: m.wizard.markedTitle })).toBeVisible({ timeout: 30_000 });
        const href = await page.getByRole('link', { name: m.wizard.viewOrder }).getAttribute('href');
        const poId = href!.split('/').pop()!;

        const sql = e2eSql();
        try {
          const [po] = await sql<{ day: string | null }[]>`
            select to_char(expected_delivery_at at time zone ${TZ}, 'YYYY-MM-DD HH24:MI') as day
            from purchase_orders where id = ${poId}`;
          expect(po?.day).toBe(`${expected} 00:00`);
        } finally {
          await sql.end();
        }
        expect(errors, errors.join('\n')).toEqual([]);
      });
    }
  });
}
