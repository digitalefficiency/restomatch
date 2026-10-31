import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * W1-10 · catalog and price-list money safety.
 *   - A price list with "1,250" imports as ₪1,250.00 (not ₪1.25); "-5" is held
 *     out as "מחיר לא ברור"; the VAT basis must be chosen; the preview shows the
 *     parsed "₪ שיובא" with the ₪ on the correct side.
 *   - Typed catalog prices are text + inputMode=decimal and format on blur.
 *   - The product page shows ₪ per default unit.
 *   - axe (WCAG 2.1 AA): no critical/serious violation on catalog, import,
 *     mapping, products and product detail — he + en, 390 and 1440.
 * W1_10_SHOTS=1 also writes the reviewed screens to e2e/__screenshots__/W1-10/.
 */
test.use({ storageState: OWNER_STATE });

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SHOTS = process.env.W1_10_SHOTS ? 'e2e/__screenshots__/W1-10' : null;
const SKU = `W110-${Date.now().toString(36)}`;

let supplierId = '';
let productId = '';

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [sup] = await sql<{ id: string }[]>`
      select s.id from suppliers s join restaurants r on r.id = s.restaurant_id
      where r.name = ${DEMO_RESTAURANT_NAME} order by s.name limit 1`;
    const [prod] = await sql<{ id: string }[]>`
      select p.id from products p join restaurants r on r.id = p.restaurant_id
      join supplier_catalog_items c on c.product_id = p.id
      where r.name = ${DEMO_RESTAURANT_NAME} group by p.id order by count(*) desc, p.id limit 1`;
    if (!sup || !prod) throw new Error('the demo seed has no supplier / catalog product');
    supplierId = sup.id;
    productId = prod.id;
  } finally {
    await sql.end();
  }
});

async function setLocale(page: Page, locale: 'he' | 'en') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

/** In he-IL the ₪ glyph renders to the LEFT of the first digit (DoD-4). */
async function shekelIsLeftOfDigits(cell: Locator): Promise<boolean> {
  return cell.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      const s = text.indexOf('₪');
      const d = text.search(/\d/);
      if (s < 0 || d < 0) continue;
      const rect = (i: number) => {
        const r = document.createRange();
        r.setStart(node!, i);
        r.setEnd(node!, i + 1);
        return r.getBoundingClientRect();
      };
      return rect(s).right <= rect(d).left + 0.5;
    }
    return false;
  });
}

async function seriousAxe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (tags) => {
    const w = window as unknown as {
      axe: {
        run: (c: unknown, o: unknown) => Promise<{
          violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[];
        }>;
      };
    };
    const res = await w.axe.run(
      // `next dev`'s overlay and the lab worker banner are not part of this screen.
      { exclude: [['nextjs-portal'], ['[data-worker-status]']] },
      { runOnly: { type: 'tag', values: tags } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  }, WCAG_AA);
}

function csvFile(rows: string[]) {
  return {
    name: 'מחירון בדיקה.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(['מק"ט,תיאור,יחידה,מחיר', ...rows].join('\n'), 'utf8'),
  };
}

test('import: "1,250" → ₪1,250.00, "-5" held, VAT basis required, ₪ on the correct side', async ({ page }) => {
  const errors = collectPageErrors(page);
  await setLocale(page, 'he');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dashboard/catalog/import?supplierId=${supplierId}`);
  await page.locator('input[type=file]').setInputFiles(
    csvFile([`${SKU}-1,שמן זית 18 ליטר W110,יח׳,"1,250"`, `${SKU}-2,אורז יסמין W110,ק"ג,"12,90"`, `${SKU}-3,מלח W110,ק"ג,-5`]),
  );
  await page.getByRole('button', { name: 'ניתוח הקובץ' }).click();

  const imported = page.getByTestId('imported-price');
  await expect(imported.first()).toContainText('1,250.00');
  await expect(imported.nth(1)).toContainText('12.90');
  expect(await shekelIsLeftOfDigits(imported.first())).toBe(true);
  // Owner decision: numbers in tables are always physically right-aligned (he and en).
  expect(await imported.first().evaluate((el) => getComputedStyle(el).textAlign)).toBe('right');
  await expect(page.getByText('מחיר לא ברור · 1 שורות לא ייובאו')).toBeVisible();
  // The file's "-5" is bidi-isolated: it must not read "5-" in RTL (review finding 15).
  await expect(page.locator('bdi[dir=ltr]', { hasText: '"-5"' })).toBeVisible();
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/import-check-he-1440.png`, fullPage: true });
  }
  expect(await seriousAxe(page)).toEqual([]);

  // No silent default for the VAT basis.
  await page.getByRole('button', { name: /ייבוא 2 שורות/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'כוללים מע״מ' })).toBeVisible();
  await page.getByLabel('לא כולל מע״מ').check();
  await page.getByRole('button', { name: /ייבוא 2 שורות/ }).click();
  // The toast and the done card both announce it.
  await expect(page.getByRole('status').filter({ hasText: 'הייבוא הושלם' }).first()).toBeVisible();
  await expect(page.getByText('מחיר לא ברור · 1 שורות לא ייובאו')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/import-done-he-1440.png`, fullPage: true });

  const sql = e2eSql();
  try {
    const rows = await sql<{ supplier_sku: string; list_price: string | null }[]>`
      select supplier_sku, list_price from supplier_catalog_items where supplier_sku like ${`${SKU}-%`} order by supplier_sku`;
    expect(rows).toEqual([
      { supplier_sku: `${SKU}-1`, list_price: '1250.0000' },
      { supplier_sku: `${SKU}-2`, list_price: '12.9000' },
    ]);
    const [imp] = await sql<{ column_mapping: Record<string, string> }[]>`
      select column_mapping from catalog_imports where supplier_id = ${supplierId} order by created_at desc limit 1`;
    expect(imp!.column_mapping).toMatchObject({ vatBasis: 'ex' });
  } finally {
    await sql.end();
  }
  expect(errors).toEqual([]);
});

test('a 0.6–0.9 match is never linked: "בדיקה" step, accept learns the alias (catalog-01)', async ({ page }) => {
  // On the demo seed "עגבניות שרי טרי" scores 0.80 (fuzzy) against "עגבניות שרי" — main linked it silently.
  const RAW = 'עגבניות שרי טרי';
  const sql = e2eSql();
  try {
    const [tomato] = await sql<{ supplier_id: string; product_id: string }[]>`
      select c.supplier_id, c.product_id from supplier_catalog_items c join restaurants r on r.id = c.restaurant_id
      where r.name = ${DEMO_RESTAURANT_NAME} and c.supplier_name_raw = 'עגבניות שרי' and c.product_id is not null limit 1`;
    test.skip(!tomato, 'the demo seed has no "עגבניות שרי" catalog row');
    await setLocale(page, 'he');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/dashboard/catalog/import?supplierId=${tomato!.supplier_id}`);
    await page.locator('input[type=file]').setInputFiles(csvFile([`${SKU}-T,${RAW},ק"ג,9.80`]));
    await page.getByRole('button', { name: 'ניתוח הקובץ' }).click();
    await page.getByLabel('לא כולל מע״מ').check();
    await page.getByRole('button', { name: /ייבוא 1 שורות/ }).click();

    await expect(page.getByRole('heading', { name: 'בדיקה · 1 התאמות דורשות אישור' })).toBeVisible();
    await expect(page.getByText('הצעה: עגבניות שרי')).toBeVisible();
    await expect(page.getByText(/התאמה בינונית · שם דומה · אותו ספק/)).toBeVisible();
    await expect(page.getByText(/%/)).toHaveCount(0); // a word, not a false-precision %
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/import-review-he-390.png`, fullPage: true });
    expect(await seriousAxe(page)).toEqual([]);

    const [saved] = await sql<{ product_id: string | null }[]>`
      select product_id from supplier_catalog_items where supplier_sku = ${`${SKU}-T`}`;
    expect(saved!.product_id).toBeNull();
    expect(await sql`select 1 from product_aliases where supplier_name_raw = ${RAW}`).toHaveLength(0);

    // "אבדוק אחר כך" leads somewhere: the review persists on the server and the
    // supplier's import history links back to it (review finding 4).
    await page.getByRole('button', { name: 'אבדוק אחר כך' }).click();
    await page.goto(`/dashboard/suppliers/${tomato!.supplier_id}?tab=catalog`);
    await page.getByRole('link', { name: 'בדיקה · 1 התאמות דורשות אישור' }).first().click();
    await expect(page.getByRole('heading', { name: 'בדיקה · 1 התאמות דורשות אישור' })).toBeVisible();
    await expect(page.getByText(RAW)).toBeVisible();

    await page.getByRole('button', { name: 'בחירת מוצר אחר' }).click();
    await page.getByRole('searchbox', { name: 'חיפוש מוצר לקישור' }).fill('עגבניות שרי');
    await page.getByRole('button', { name: 'קישור ל-עגבניות שרי', exact: true }).click();
    await expect(page.getByText('קושר ל-עגבניות שרי')).toBeVisible();
    // Focus is not lost: with no rows left it lands on the finish button (review finding 14).
    await expect(page.locator('#rv-finish')).toBeFocused();
    await expect(page.getByRole('button', { name: 'סיום הבדיקה' })).toBeVisible();
    const [linked] = await sql<{ product_id: string | null }[]>`
      select product_id from supplier_catalog_items where supplier_sku = ${`${SKU}-T`}`;
    expect(linked!.product_id).toBe(tomato!.product_id);
    const aliases = await sql<{ confidence: string }[]>`
      select confidence from product_aliases where supplier_name_raw = ${RAW} and product_id = ${tomato!.product_id}`;
    expect(aliases.map((a) => a.confidence)).toEqual(['1.000']);
  } finally {
    // Leave the demo tenant as seeded so a rerun (E2E_SKIP_SEED=1) meets the same 0.80 suggestion.
    await sql`delete from product_aliases where supplier_name_raw = ${RAW}`;
    await sql`delete from supplier_catalog_items where supplier_sku like ${`${SKU}-%`}`;
    await sql.end();
  }
});

test('a typed catalog price is text + decimal keypad and formats "7,5" → "7.50"', async ({ page }) => {
  await setLocale(page, 'he');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/catalog');
  await page.getByRole('button', { name: /^עריכת פריט:/ }).first().click();
  const price = page.getByRole('textbox', { name: 'מחיר מחירון' }).first();
  await expect(price).toHaveAttribute('type', 'text');
  await expect(price).toHaveAttribute('inputmode', 'decimal');
  await price.fill('7,5');
  await price.blur();
  await expect(price).toHaveValue('7.50');
  await price.press('Escape');
});

test('product page: ₪ per default unit, "cheapest" only between comparable prices', async ({ page }) => {
  await setLocale(page, 'he');
  await page.goto(`/dashboard/products/${productId}`);
  const header = page.getByRole('columnheader', { name: /^₪ ל/ });
  await expect(header).toBeVisible();
  const cells = page.getByTestId('unit-price');
  await expect(cells.first()).toBeVisible();
  const n = await cells.count();
  const comparable = await page.getByTestId('unit-price').filter({ hasNotText: 'לא ניתן להשוות' }).count();
  const badges = await page.getByTestId('unit-price').getByText('הזול ביותר').count();
  expect(badges).toBeLessThanOrEqual(comparable >= 2 ? n : 0);
  if (comparable < 2) expect(badges).toBe(0);
});

const PAGES = [
  ['catalog', '/dashboard/catalog'],
  ['import', '/dashboard/catalog/import'],
  ['mapping', '/dashboard/catalog/mapping'],
  ['products', '/dashboard/products'],
  ['product', '/dashboard/products/:product'],
] as const;

for (const locale of ['he', 'en'] as const) {
  for (const [vpName, vp] of [
    ['390', { width: 390, height: 844 }],
    ['1440', { width: 1440, height: 900 }],
  ] as const) {
    test(`axe clean + screens [${locale} · ${vpName}]`, async ({ page }) => {
      await setLocale(page, locale);
      await page.setViewportSize(vp);
      for (const [name, path] of PAGES) {
        await page.goto(path.replace(':product', productId), { waitUntil: 'load' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await expect(page.locator('h1').first()).toBeVisible();
        // A list refetching on mount is faded (opacity-80) for a moment; judge the settled colours.
        await page.waitForFunction(() => !document.querySelector('.opacity-80'), null, { timeout: 10_000 }).catch(() => {});
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          await page.screenshot({ path: `${SHOTS}/${name}-${locale}-${vpName}.png`, fullPage: name === 'product' });
        }
        expect(await seriousAxe(page), `${path} [${locale} · ${vpName}]`).toEqual([]);
        // No horizontal page scroll at phone width.
        if (vp.width === 390) {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
        }
      }
    });
  }
}

test('names grid: a product-link click with unsaved English names asks first (review finding 13)', async ({ page }) => {
  await setLocale(page, 'he');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/products');
  const first = page.locator('input[id^="name-en-"]').first();
  await first.fill(`W110 ${SKU}`);
  await page.locator('a[id^="name-en-"][id$="-label"]').first().click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'המשך עריכה' }).click();
  await expect(page).toHaveURL(/\/dashboard\/products$/);
  await expect(first).toHaveValue(`W110 ${SKU}`);
});
