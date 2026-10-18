/**
 * End-to-end proof of "Receiver in English" on the seeded demo tenant
 * (כפר הזיתים), against a running dev server + worker:
 *
 *   PO (Hebrew lines, no English yet) → receiver logs in → switches to English
 *   → receiving inbox → wizard → uploads a fixture image (local scan storage)
 *   → stub OCR (no ANTHROPIC_API_KEY) → reconciliation shows ENGLISH item names
 *   with the Hebrew original underneath → adjust quantities → close receipt.
 *
 * It also double-taps "Process invoice" and asserts exactly ONE invoice was
 * registered (M8), and that invoice_lines / po_lines / products got English.
 * Screenshots (phone viewport) land in docs/client-ready/screenshots/.
 *
 * Run (from apps/web, with `pnpm dev` and the worker running):
 *   set -a; . ./.env.local; set +a
 *   pnpm exec tsx scripts/e2e-english-receiving.ts
 */
import { readFile, unlink, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import {
  and,
  createDb,
  eq,
  goodsReceipts,
  inArray,
  invoiceLines,
  invoices,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
} from '@restomatch/db';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const DB_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/restomatch_dev';
const MAGIC = process.env.MAGIC_LINK_FILE ?? '/tmp/restomatch-magic-link.json';
const SHOTS = resolve(process.cwd(), '../../docs/client-ready/screenshots');
const EMAIL = 'receiver@kfar-hazeitim.test';
// 1x1 PNG — the stub OCR ignores pixels; storage + viewer handle it like a photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

const db = createDb(DB_URL);

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function seedPo(): Promise<{ poId: string; supplierName: string; names: string[] }> {
  const [r] = await db.select().from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  if (!r) throw new Error('seeded restaurant כפר הזיתים not found — run ./scripts/dev-setup.sh');
  const prods = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.restaurantId, r.id),
        inArray(products.canonicalName, ['חזה עוף', 'עגבניה שרי', 'מלפפון חממה', 'שמן זית כתית']),
      ),
    );
  check(prods.length === 4, 'seeded products exist');
  const [sup] = await db.select().from(suppliers).where(eq(suppliers.restaurantId, r.id)).limit(1);
  // Start from a clean slate: no English yet, so the run proves translation.
  await db.update(products).set({ nameEn: null }).where(inArray(products.id, prods.map((p) => p.id)));
  const today = new Date();
  today.setHours(today.getHours() + 1, 0, 0, 0);
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: r.id,
      supplierId: sup!.id,
      expectedDeliveryAt: today,
      status: 'sent',
      source: 'manual',
      notes: 'e2e-english-receiving',
    })
    .returning();
  await db.insert(poLines).values(
    prods.map((p, i) => ({
      poId: po!.id,
      productId: p.id,
      rawDescription: p.canonicalName,
      qtyOrdered: String(2 + i),
      unit: 'ק״ג',
      unitPriceExpected: String(10 + i * 5),
    })),
  );
  return { poId: po!.id, supplierName: sup!.name, names: prods.map((p) => p.canonicalName) };
}

async function login(page: Page): Promise<void> {
  await unlink(MAGIC).catch(() => {});
  await page.goto(`${BASE}/login`);
  const magicInput = page.getByLabel(/קישור התחברות|sign-in link|magic/i);
  await magicInput.fill(EMAIL);
  await page.getByRole('button', { name: /קישור התחברות|sign-in link|magic link/i }).click();
  let url = '';
  for (let i = 0; i < 180 && !url; i += 1) {
    try {
      url = (JSON.parse(await readFile(MAGIC, 'utf8')) as { url: string }).url;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  check(url, 'magic link issued');
  await page.goto(url);
  await page.waitForURL(/\/dashboard/, { timeout: 180_000 });
}

async function main(): Promise<void> {
  await mkdir(SHOTS, { recursive: true });
  const runStart = new Date();
  const { poId, names } = await seedPo();
  console.log(`seeded PO ${poId} with ${names.join(', ')}`);

  // CI/sandbox images may pin a different Chromium build than this Playwright.
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  );
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // Pre-accept "necessary only" so the consent banner never covers the wizard.
  await ctx.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000); // first hit compiles the route in dev
  try {
    await login(page);

    // English via the shareable ?lang=en link (sets the rm_locale cookie).
    await page.goto(`${BASE}/dashboard/receiving?lang=en`);
    await page.getByRole('heading', { name: 'Receiving' }).waitFor();
    check(await page.locator('html[lang="en"][dir="ltr"]').count(), 'page is English / LTR');
    await page.screenshot({ path: join(SHOTS, 'receiving-inbox-en.png'), fullPage: true });

    await page.locator(`a[href="/dashboard/receiving/${poId}"]`).click();
    await page.waitForURL(`**/dashboard/receiving/${poId}`, { timeout: 180_000 });
    await page.getByRole('heading', { name: 'Photograph the invoice' }).waitFor({ timeout: 180_000 });
    await page.screenshot({ path: join(SHOTS, 'receiving-scan-en.png'), fullPage: true });

    await page.locator('input[type="file"]').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: PNG });
    const process = page.getByRole('button', { name: 'Process invoice' });
    await page.getByText(/^Saved · scan-/).waitFor();
    // M8: a double-tap on the button.
    await process.dblclick();

    await page.getByRole('heading', { name: 'Check result' }).waitFor({ timeout: 60_000 });
    const cards = page.getByTestId('recon-cards');
    for (const en of ['Chicken breast', 'Cherry tomatoes', 'Greenhouse cucumber', 'Extra virgin olive oil']) {
      await cards.getByTestId('item-name-en').filter({ hasText: en }).first().waitFor();
    }
    check(true, 'reconciliation shows the English item names');
    for (const he of names) {
      await cards.getByTestId('item-name-he').filter({ hasText: he }).first().waitFor();
    }
    check(true, 'each English name shows its Hebrew original underneath');
    check(await cards.getByText(/\bkg\b/).count(), 'units shown in English (kg)');
    await page.screenshot({ path: join(SHOTS, 'receiving-reconciliation-en.png'), fullPage: true });

    await page.getByTestId('toggle-hebrew-original').uncheck();
    check((await cards.getByTestId('item-name-he').count()) === 0, '"Show Hebrew original" toggle hides the Hebrew');
    await page.screenshot({ path: join(SHOTS, 'receiving-reconciliation-en-no-hebrew.png'), fullPage: true });
    await page.getByTestId('toggle-hebrew-original').check();

    await page.getByTestId('continue-adjust').click();
    await page.getByRole('heading', { name: 'How much really arrived?' }).waitFor();
    await page.screenshot({ path: join(SHOTS, 'receiving-adjust-en.png'), fullPage: true });
    // Confirm every pending line: "= invoice" where billed, else "= order".
    const cardsToFix = page.locator('.adjust-card').filter({ has: page.getByRole('button', { name: /^= (invoice|order) \(/ }) });
    const n = await cardsToFix.count();
    for (let i = 0; i < n; i += 1) {
      const card = cardsToFix.nth(i);
      const inv = card.getByRole('button', { name: /^= invoice \(/ });
      await ((await inv.count()) ? inv : card.getByRole('button', { name: /^= order \(/ })).click();
    }
    await page.getByTestId('close-receipt').click();
    await page.getByTestId('receipt-confirmed').waitFor();
    await page.getByRole('heading', { name: 'Receipt closed' }).waitFor();
    await page.screenshot({ path: join(SHOTS, 'receiving-confirmed-en.png'), fullPage: true });

    // DB assertions.
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.poId, poId));
    check(gr && gr.status !== 'pending', `goods receipt closed (status=${gr?.status})`);
    const invs = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.restaurantId, gr!.restaurantId), eq(invoices.supplierId, (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)))[0]!.supplierId)));
    const mine = invs.filter((i) => i.createdAt >= runStart && i.rawImageUrl?.includes('/scans/'));
    check(mine.length === 1, `double-tap registered exactly ONE invoice (M8) — got ${mine.length}`);
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, mine[0]!.id));
    check(lines.length === 4 && lines.every((l) => l.rawDescriptionEn), 'every invoice line has English persisted');
    const pls = await db.select().from(poLines).where(eq(poLines.poId, poId));
    check(pls.every((l) => l.rawDescriptionEn), 'every PO line has English persisted');

    // Hebrew UI still Hebrew/RTL.
    await page.goto(`${BASE}/dashboard/receiving?lang=he`);
    await page.getByRole('heading', { name: 'קליטת סחורה' }).waitFor();
    check(await page.locator('html[lang="he"][dir="rtl"]').count(), 'Hebrew UI unchanged (RTL)');
    await page.screenshot({ path: join(SHOTS, 'receiving-inbox-he.png'), fullPage: true });

    // Public demo in English.
    await page.goto(`${BASE}/showcase/receiver?lang=en`);
    await page.getByRole('heading', { name: 'Which supplier is here?' }).waitFor();
    await page.getByText("Avi's Greengrocer").click();
    await page.getByRole('button', { name: 'Continue to scan' }).click();
    await page.getByRole('button', { name: 'Use a demo invoice (no upload)' }).click();
    await page.getByRole('button', { name: 'Process invoice' }).click();
    await page.getByRole('heading', { name: 'Check result' }).waitFor();
    await page.getByTestId('recon-cards').getByText('Cherry tomatoes').waitFor();
    check(true, 'showcase demo shows English item names');
    await page.screenshot({ path: join(SHOTS, 'receiving-showcase-en.png'), fullPage: true });

    console.log('\nE2E English receiving: PASS');
  } catch (err) {
    await page.screenshot({ path: join(SHOTS, 'receiving-FAILED.png'), fullPage: true }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
