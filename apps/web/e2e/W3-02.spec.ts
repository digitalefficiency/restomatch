import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * W3-02 · recipe workbench (docs/ux/wave3/W3-02.md). On the seeded demo tenant
 * ("כפר הזיתים", all flags on):
 *  - IA-02: the chef's "עלות מנה" has no food-cost period card (inventory.period
 *    is owner/manager only), so no error card and no ₪ period query;
 *  - the editor costs the draft live through recipes.preview (no save), with a
 *    share-of-plate bar and an ambiguous quantity flagged, never guessed;
 *  - "נסה בלי לשמור" hides save and the reset brings back the saved numbers.
 */
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 } };

async function open(browser: Browser, baseURL: string, role: 'owner' | 'chef', device: typeof PHONE | typeof DESK): Promise<Page> {
  const ctx = await browser.newContext({ baseURL, ...device });
  await ctx.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: baseURL },
    { name: 'rm_locale', value: 'he', url: baseURL },
  ]);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(`${role}@kfar-hazeitim.test`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form:has(#password) button[type=submit]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  return page;
}

test('chef: "עלות מנה" shows dishes, never the period error card or a ₪ period query (IA-02)', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'chef', PHONE);
  const periods: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('inventory.period')) periods.push(r.url());
  });
  await page.goto('/dashboard/recipes');
  await expect(page.locator('main h1')).toHaveText('עלות מנה');
  await expect(page.getByTestId('recipes-summary')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('food-cost-period')).toHaveCount(0);
  await expect(page.locator('main [role=alert]')).toHaveCount(0);
  expect(periods).toEqual([]);
  await page.context().close();
});

test('owner: a new dish is costed live while typing, never saved, and the trial hides save', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'owner', DESK);
  const saves: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('recipes.save')) saves.push(r.url());
  });
  await page.goto('/dashboard/recipes/new');
  await page.locator('#r-name').fill('מנת בדיקה W3-02');
  await page.locator('#r-price').fill('68,50');
  // The e2e seed has no recipes: build the draft from a priced demo product.
  await page.locator('#r-add-product').click();
  await page.locator('#r-add-product').fill('עוף');
  await page.locator('#r-add-product-list [role=option]', { hasText: '₪' }).first().locator('button').click();

  const qty = page.locator('input[id$="-q"]').first();
  const hero = page.getByTestId('recipe-live').locator('[aria-live=polite]');
  await qty.fill('200');
  await expect(hero).toContainText('₪');
  await expect(page.getByTestId('line-share').first()).toContainText('100');
  await expect(page.getByTestId('recipe-gap')).toBeVisible();
  const at200 = await hero.innerText();

  await qty.fill('400');
  await expect(hero).not.toHaveText(at200);

  await qty.fill('1,250');
  await expect(page.getByText('1,250 או 1.25?')).toBeVisible();

  await page.getByTestId('recipe-trial').click();
  await expect(page.getByRole('button', { name: 'שמירה' })).toHaveCount(0);
  await page.getByRole('button', { name: 'סיום הניסיון' }).click();
  await expect(page.getByRole('button', { name: 'שמירה' })).toBeVisible();
  expect(saves).toEqual([]);
  await page.context().close();
});

test('W3-02b: the owner sees the food-cost control room; the chef never mounts it (no ₪ query)', async ({ browser, baseURL }) => {
  const owner = await open(browser, baseURL!, 'owner', DESK);
  await owner.goto('/dashboard/inventory');
  await expect(owner.getByTestId('control-room')).toBeVisible();
  await expect(owner.getByTestId('control-room')).toContainText('חדר הבקרה של עלות המזון');
  // With a closed period the equation's terms are links to their sources; with none, the card says what is missing.
  const eq = owner.getByTestId('control-room-equation');
  if (await eq.count()) {
    await expect(eq.getByRole('link').first()).toHaveAttribute('href', /^\/dashboard\/inventory\//);
  }
  await owner.context().close();

  const chef = await open(browser, baseURL!, 'chef', PHONE);
  const calls: string[] = [];
  chef.on('request', (r) => {
    if (r.url().includes('inventory.controlRoom')) calls.push(r.url());
  });
  await chef.goto('/dashboard/inventory');
  await expect(chef.locator('main h1')).toBeVisible();
  await chef.waitForLoadState('networkidle');
  await expect(chef.getByTestId('control-room')).toHaveCount(0);
  expect(calls).toEqual([]);
  await chef.context().close();
});
