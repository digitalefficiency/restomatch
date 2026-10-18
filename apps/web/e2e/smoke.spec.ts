import { expect, test, type Page } from '@playwright/test';
import { en as commonEn } from '../lib/i18n/messages/common/en';
import { he as commonHe } from '../lib/i18n/messages/common/he';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql, HEBREW } from './helpers';

/**
 * Smoke: every main page, in Hebrew AND English, must
 *   - answer < 400 without bouncing to /login,
 *   - render <html lang dir> for the active locale,
 *   - show no error boundary / not-found page,
 *   - log no console errors or uncaught exceptions,
 *   - (English) carry no leftover Hebrew in the chrome (nav, header buttons).
 * Tenant DATA (restaurant/supplier/product names) is legitimately Hebrew and is
 * not checked — only the UI chrome.
 */

type Locale = 'he' | 'en';
const LOCALES: Locale[] = ['he', 'en'];

const BOUNDARY_TITLES = [
  commonHe.errorPage.title,
  commonEn.errorPage.title,
  commonHe.notFound.title,
  commonEn.notFound.title,
];

/** `:po` / `:invoice` / … are resolved from the seeded e2e DB in beforeAll. */
const DASHBOARD_PAGES = [
  '/dashboard',
  '/dashboard/approvals',
  '/dashboard/leaks',
  '/dashboard/receiving',
  '/dashboard/receiving/:openPo',
  '/dashboard/orders',
  '/dashboard/orders/new',
  '/dashboard/orders/:po',
  '/dashboard/invoices/:invoice',
  '/dashboard/suppliers',
  '/dashboard/suppliers/:supplier',
  '/dashboard/products/:product',
  '/dashboard/catalog',
  '/dashboard/catalog/import',
  '/dashboard/catalog/mapping',
  '/dashboard/exports',
  '/dashboard/team',
  '/dashboard/settings',
  '/admin',
];

const PUBLIC_PAGES = [
  '/',
  '/pricing',
  '/about',
  '/privacy',
  '/terms',
  '/cookies',
  '/login',
  '/showcase',
  '/showcase/dashboard',
  '/showcase/dashboard/invoices',
  '/showcase/approvals',
  '/showcase/deliveries',
  '/showcase/receiver',
];

const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) throw new Error('demo restaurant missing from the e2e DB');
    const one = async (q: Promise<{ id: string }[]>, key: string) => {
      const [row] = await q;
      if (!row) throw new Error(`seed has no row for :${key}`);
      ids[key] = row.id;
    };
    await one(sql`select id from purchase_orders where restaurant_id = ${r.id} order by created_at limit 1`, 'po');
    await one(
      sql`select id from purchase_orders where restaurant_id = ${r.id} and status = 'sent' order by created_at limit 1`,
      'openPo',
    );
    await one(
      sql`select id from invoices where restaurant_id = ${r.id} and status = 'matched' order by created_at limit 1`,
      'invoice',
    );
    await one(sql`select id from suppliers where restaurant_id = ${r.id} order by name limit 1`, 'supplier');
    await one(sql`select id from products where restaurant_id = ${r.id} order by canonical_name limit 1`, 'product');
  } finally {
    await sql.end();
  }
});

function resolve(path: string): string {
  return path.replace(/:(\w+)/g, (_, k: string) => {
    const v = ids[k];
    if (!v) throw new Error(`unresolved :${k}`);
    return v;
  });
}

async function visit(page: Page, locale: Locale, path: string, authed: boolean) {
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url: test.info().project.use.baseURL ?? 'http://localhost:3100' },
  ]);
  const errors = collectPageErrors(page);
  const res = await page.goto(resolve(path), { waitUntil: 'load' });
  // Let client components hydrate + fire their first tRPC queries.
  await page.waitForLoadState('networkidle').catch(() => {});

  expect(res, `no response for ${path}`).not.toBeNull();
  expect(res!.status(), `${path} HTTP status`).toBeLessThan(400);
  if (authed) expect(new URL(page.url()).pathname, `${path} bounced to /login`).not.toBe('/login');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', locale);
  await expect(html).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');

  for (const title of BOUNDARY_TITLES) {
    await expect(page.getByRole('heading', { name: title, exact: true }), `${path} shows "${title}"`).toHaveCount(0);
  }
  expect(errors, `${path} console/page errors`).toEqual([]);
}

/** Visible text of the chrome only — Hebrew here in English mode is a translation gap. */
async function chromeText(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => (el as HTMLElement).innerText.trim())
        .filter(Boolean),
    );
}

for (const locale of LOCALES) {
  test.describe(`authenticated pages [${locale}]`, () => {
    test.use({ storageState: OWNER_STATE });
    for (const path of DASHBOARD_PAGES) {
      test(`${locale} ${path}`, async ({ page }) => {
        await visit(page, locale, path, true);
        if (locale === 'en') {
          const leaks = (await chromeText(page, 'header nav a, header nav button, header form button')).filter(
            (t) => HEBREW.test(t),
          );
          expect.soft(leaks, `${path}: Hebrew left in English chrome`).toEqual([]);
        }
      });
    }
  });

  test.describe(`public pages [${locale}]`, () => {
    for (const path of PUBLIC_PAGES) {
      test(`${locale} ${path}`, async ({ page }) => {
        await visit(page, locale, path, false);
        if (locale === 'en') {
          const leaks = (await chromeText(page, 'header a, header button, footer a')).filter((t) =>
            HEBREW.test(t),
          );
          expect.soft(leaks, `${path}: Hebrew left in English chrome`).toEqual([]);
        }
      });
    }
  });
}
