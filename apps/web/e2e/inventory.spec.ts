import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * Inventory counting (flag `inventoryCount`) on a phone, Hebrew and English:
 * start a count → type quantities → finish → the summary's ₪ value → the
 * actual-food-cost card (opening + purchases − closing, % of the sales typed
 * in). Every screen: axe WCAG 2.1 AA = 0, no horizontal overflow, 44 px touch
 * targets, no console errors.
 *
 * The flag is switched on for the demo tenant here (and restored after), with
 * a completed opening count 20 days back so the period has two ends.
 */

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

let restaurantId = '';
let settingsBefore = '';

test.describe.configure({ mode: 'serial' });
test.use({ ...PHONE, storageState: OWNER_STATE });

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string; settings: string }[]>`
      select id, coalesce(settings, '{}'::jsonb)::text as settings from restaurants where name = ${DEMO_RESTAURANT_NAME} order by created_at limit 1`;
    if (!r) throw new Error('no demo restaurant');
    restaurantId = r.id;
    settingsBefore = r.settings;
    await sql`update restaurants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features}',
      coalesce(settings -> 'features', '{}'::jsonb) || '{"inventoryCount": true}'::jsonb) where id = ${restaurantId}`;
    await sql`delete from inventory_counts where restaurant_id = ${restaurantId}`;
    await sql`insert into inventory_counts (restaurant_id, count_date, status, total_value_agorot, completed_at)
      values (${restaurantId}, (now() at time zone 'Asia/Jerusalem')::date - 20, 'completed', 900000, now())`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await sql`delete from inventory_counts where restaurant_id = ${restaurantId}`;
    await sql`update restaurants set settings = ${settingsBefore}::jsonb where id = ${restaurantId}`;
  } finally {
    await sql.end();
  }
});

async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  });
}

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > w + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${w}`);
    const sel = 'main button, main select, main input, main [role=button], main a[href]';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden' || el.closest('.sr-only')) continue;
      if (el.tagName === 'A' && s.display === 'inline') continue;
      if (el instanceof HTMLInputElement && ['hidden', 'file', 'checkbox', 'radio'].includes(el.type)) continue;
      if (r.width < 44 || r.height < 44) out.push(`${Math.round(r.width)}×${Math.round(r.height)} ${el.outerHTML.slice(0, 90)}`);
    }
    return out;
  });
}

async function checkScreen(page: Page, label: string) {
  expect(await axeViolations(page), `${label} axe`).toEqual([]);
  expect(await layoutProblems(page), `${label} layout`).toEqual([]);
}

for (const locale of ['he', 'en'] as const) {
  test(`[${locale} · phone] count → finish → actual food cost`, async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      // Known dev-server-only React warning from the shared RouteProgress history hook (it dispatches
      // inside Next's HistoryUpdater useInsertionEffect); production builds never log it. Reported to
      // the orchestrator with its fix — every other console error fails this test.
      if (m.type() === 'error' && !m.text().includes('useInsertionEffect must not schedule updates')) errors.push(`${page.url()} :: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    const url = baseURL ?? 'http://localhost:3100';
    await page.context().addCookies([
      { name: 'rm_locale', value: locale, url },
      { name: 'rm_cookie_consent', value: 'necessary', url },
    ]);

    await page.goto('/dashboard/inventory');
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
    await expect(page.getByTestId('food-cost-period')).toBeVisible();
    await checkScreen(page, `${locale} /dashboard/inventory`);

    await page.getByRole('button', { name: locale === 'he' ? 'התחלת ספירה' : 'Start a count' }).click();
    await page.waitForURL(/\/dashboard\/inventory\/count$/);
    await expect(page.getByTestId('count-progress')).toBeVisible();
    await checkScreen(page, `${locale} /dashboard/inventory/count`);

    // Count the first three products with the phone keypad; "2,5" is a valid Hebrew keyboard decimal.
    const inputs = page.locator('main input[inputmode="decimal"][id^="qty-"]');
    expect(await inputs.count()).toBeGreaterThan(3);
    await inputs.nth(0).fill('2,5');
    await inputs.nth(1).fill('4');
    await inputs.nth(2).fill('10');
    await inputs.nth(2).blur();
    await expect(page.getByTestId('count-progress')).toContainText(locale === 'he' ? 'נספרו 3 מתוך' : '3 of');
    await expect(page.getByTestId('count-progress').getByRole('status')).toHaveText(locale === 'he' ? 'נשמר' : 'Saved', { timeout: 10_000 });

    // Autosaved: a reload resumes with the same quantities.
    await page.reload();
    await expect(page.locator('main input[inputmode="decimal"][id^="qty-"]').nth(0)).toHaveValue('2.5');

    await page.getByRole('button', { name: locale === 'he' ? 'סיים ספירה' : 'Finish count' }).click();
    await page.getByRole('button', { name: locale === 'he' ? 'כן, סיים' : 'Yes, finish' }).click();
    await expect(page.getByTestId('count-done')).toBeVisible();
    await expect(page.getByTestId('count-done-value')).toContainText('₪');
    await checkScreen(page, `${locale} count summary`);

    await page.getByRole('link', { name: locale === 'he' ? 'לעלות המזון של התקופה' : 'See the period’s food cost' }).click();
    await page.waitForURL(/\/dashboard\/inventory$/);
    const card = page.getByTestId('food-cost-period');
    await expect(card).toContainText(locale === 'he' ? 'עלות מזון בפועל' : 'Actual food cost');
    // No POS on the demo: type the period's food sales → a % appears.
    if (await card.locator('#period-sales').count()) {
      await card.locator('#period-sales').fill('50000');
      await card.getByRole('button', { name: locale === 'he' ? 'שמירה' : 'Save' }).click();
    }
    await expect(page.getByTestId('food-cost-actual')).toContainText('%');
    await expect(page.getByTestId('count-history')).toBeVisible();
    await checkScreen(page, `${locale} /dashboard/inventory (period)`);

    expect(errors, 'console errors').toEqual([]);
  });
}
