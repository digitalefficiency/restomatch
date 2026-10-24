import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * Fresh phone, cookie banner not answered yet: the dashboard's bottom nav and
 * the receiving wizard's sticky "close receipt" CTA must stay clickable — the
 * banner sits below them (app/dashboard/consent-clearance.tsx), never on top.
 */
test.use({ storageState: OWNER_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const BANNER = '[role="dialog"][aria-label="הסכמה לשימוש בעוגיות"]';

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

test('bottom nav stays clickable above the unanswered cookie banner, and drops back after a choice', async ({ page }) => {
  await page.goto('/dashboard');
  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible();
  const bottomNav = page.locator('nav.fixed').filter({ has: page.locator('a[href="/dashboard/receiving"]') });
  const receiving = bottomNav.locator('a[href="/dashboard/receiving"]');
  await expect(receiving).toBeVisible();

  const navBox = (await bottomNav.boundingBox())!;
  const bannerBox = (await banner.locator('> div').boundingBox())!;
  expect(navBox.y + navBox.height, 'nav sits above the banner').toBeLessThanOrEqual(bannerBox.y + 1);
  expect(await onTop(page, receiving), 'bottom-nav link is not covered').toBe(true);
  await receiving.click();
  await expect(page).toHaveURL(/\/dashboard\/receiving$/);

  // Choosing releases the space: the nav returns to the bottom edge.
  await page.getByRole('button', { name: 'רק חיוניות' }).click();
  await expect(banner).toHaveCount(0);
  await expect
    .poll(async () => {
      const b = await bottomNav.boundingBox();
      return b ? Math.round(b.y + b.height) : -1;
    })
    .toBe(844);
});

test('receiving wizard: the sticky "close receipt" CTA stays clickable with the banner visible', async ({ page }) => {
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
  // The banner never covers the wizard's own buttons either.
  const demo = page.getByRole('button', { name: 'השתמש בחשבונית-דמה (ללא העלאה)' });
  expect(await onTop(page, demo), '"use a demo invoice" is not covered').toBe(true);
  await demo.click();
  await page.getByRole('button', { name: /^עבד את החשבונית/ }).click();
  await expect(page.getByRole('heading', { name: 'תוצאת ההצלבה' })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('continue-adjust').click();

  const cta = page.getByTestId('close-receipt');
  await expect(cta).toBeVisible();
  await expect(page.locator(BANNER)).toBeVisible();
  expect(await onTop(page, cta), 'close-receipt CTA is not covered by the banner or the nav').toBe(true);
  const nav = page.locator('nav.fixed').filter({ has: page.locator('a[href="/dashboard/receiving"]') });
  expect(await onTop(page, nav.locator('a[href="/dashboard/receiving"]')), 'bottom nav still clickable').toBe(true);
});
