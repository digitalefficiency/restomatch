import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * Fresh phone, cookie banner not answered yet: the dashboard's bottom nav and
 * the Delivery Check's sticky primary CTA must stay clickable. Inside
 * the app the banner is an inline strip at the top of the page (W1-01,
 * a11y-12 / mobile-field-19) — it never overlaps fixed chrome, so the nav keeps
 * the bottom edge and nothing has to make room for it.
 */
test.use({ storageState: OWNER_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const BANNER = '[role="region"][aria-label="הסכמה לשימוש בעוגיות"]';

/** True when the element's centre is the top-most hit target (nothing over it). */
async function onTop(page: Page, loc: Locator): Promise<boolean> {
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) return false;
  const handle = await loc.elementHandle();
  return page.evaluate(
    ({ x, y, el }) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && el && (hit === el || el.contains(hit)));
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2, el: handle },
  );
}

test.beforeEach(async ({ page }) => {
  const ctx = page.context();
  await ctx.clearCookies({ name: 'rm_cookie_consent' }); // a phone that never answered
  await ctx.addCookies([{ name: 'rm_locale', value: 'he', url: test.info().project.use.baseURL! }]);
});

test('bottom nav stays clickable with the unanswered cookie banner, which sits inline at the top', async ({ page }) => {
  await page.goto('/dashboard');
  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-consent', 'inline');
  // Shell v2 (W1-03): the owner's bar is בית · אישורים · דליפות · הזמנות · עוד.
  const bottomNav = page.getByTestId('bottom-bar');
  const approvals = bottomNav.locator('a[href="/dashboard/approvals"]');
  await expect(approvals).toBeVisible();

  // Inline at the top: in the document flow, above the page, never over fixed chrome.
  const bannerBox = (await banner.boundingBox())!;
  expect(bannerBox.y, 'banner starts at the top of the page').toBeLessThanOrEqual(1);
  expect(await banner.evaluate((el) => getComputedStyle(el).position)).toBe('static');
  const navBox = (await bottomNav.boundingBox())!;
  expect(Math.round(navBox.y + navBox.height), 'nav keeps the bottom edge').toBe(844);
  expect(await onTop(page, approvals), 'bottom-nav link is not covered').toBe(true);
  await approvals.click();
  await expect(page).toHaveURL(/\/dashboard\/approvals$/);

  // Choosing removes the strip.
  await page.getByRole('button', { name: 'רק חיוניות' }).click();
  await expect(banner).toHaveCount(0);
  await expect
    .poll(async () => {
      const b = await bottomNav.boundingBox();
      return b ? Math.round(b.y + b.height) : -1;
    })
    .toBe(844);
});

test('Delivery Check: the sticky primary CTA stays clickable with the banner visible', async ({ page }) => {
  test.setTimeout(120_000);
  const sql = e2eSql();
  let poId = '';
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${r!.id} order by name limit 1`;
    const prods = await sql<{ id: string; name: string }[]>`
      select id, canonical_name as name from products
      where restaurant_id = ${r!.id} and canonical_name ~ '[א-ת]' order by canonical_name limit 3`;
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
      values (${r!.id}, ${sup!.id}, now() + interval '1 hour', 'sent', 'manual', 'e2e-consent') returning id`;
    poId = po!.id;
    for (const [i, p] of prods.entries()) {
      await sql`insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
                values (${poId}, ${p.id}, ${p.name}, ${2 + i}, 'ק״ג', ${10 + i})`;
    }
  } finally {
    await sql.end();
  }

  await page.goto(`/dashboard/receiving/${poId}`);
  await expect(page.locator(BANNER)).toBeVisible();
  // The banner never covers the Delivery Check's own buttons either (W1-06: the
  // live flow has no demo invoice; it offers "no invoice right now").
  const noInvoice = page.getByTestId('scan-no-invoice');
  expect(await onTop(page, noInvoice), '"no invoice right now" is not covered').toBe(true);
  await noInvoice.click();
  await expect(page.getByTestId('delivery-check')).toBeVisible({ timeout: 30_000 });

  // The sticky primary at the bottom ("everything arrived as ordered") is the close path.
  const cta = page.getByTestId('all-arrived');
  await expect(cta).toBeVisible();
  await expect(page.locator(BANNER)).toBeVisible();
  expect(await onTop(page, cta), 'the Delivery Check primary is not covered by the banner or the nav').toBe(true);
  // Field route (W1-03 focus mode): no bottom bar competes with the CTA.
  await expect(page.getByTestId('bottom-bar')).toBeHidden();
});
