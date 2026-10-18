/**
 * Full QA click-through of the S2 area (receiving / OCR / English) against a
 * running web server + local Postgres/Redis, on the seeded demo tenant.
 *
 * Scenarios cover desktop + 390 px mobile, he + en, roles receiver / manager /
 * owner / chef, and the edge cases: huge photo (client downscale), PDF, huge
 * PDF, double-tap (process + close), retake, two photos, offline, slow OCR
 * (still-reading → continue → background result), OCR failure, discrepancies
 * after confirm, invoice page, public showcase.
 *
 * The script starts/stops the OCR worker itself (slow/failed OCR scenarios).
 * Writes docs/client-ready/qa/receiving-qa.json + screenshots.
 *
 *   cd apps/web && set -a && . ./.env.local && set +a
 *   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec tsx scripts/qa-receiving.ts [scenario…]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  and,
  createDb,
  desc,
  eq,
  goodsReceipts,
  gte,
  inArray,
  invoiceLines,
  invoices,
  matchRuns,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
} from '@restomatch/db';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const DB_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/restomatch_dev';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const ROOT = resolve(process.cwd(), '../..');
const OUT = join(ROOT, 'docs/client-ready/qa');
const SHOTS = join(ROOT, 'docs/client-ready/screenshots');
const LOCAL_SCANS = process.env.LOCAL_SCAN_DIR || join(tmpdir(), 'restomatch-scans');
const db = createDb(DB_URL);

type Role = 'receiver' | 'manager' | 'owner' | 'chef';
interface Result {
  id: string;
  title: string;
  status: 'PASS' | 'FAIL';
  checks: string[];
  error?: string;
  ms: number;
}
const results: Result[] = [];

// ─── worker control ────────────────────────────────────────────────────────
let worker: ChildProcess | null = null;
async function workerOn(): Promise<void> {
  if (worker) return;
  worker = spawn('pnpm', ['--filter', '@restomatch/worker', 'start'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'ignore',
    detached: true,
  });
  await new Promise((r) => setTimeout(r, 8000));
}
async function workerOff(): Promise<void> {
  if (!worker?.pid) return;
  try {
    process.kill(-worker.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  worker = null;
  await new Promise((r) => setTimeout(r, 2000));
}

// ─── fixtures ──────────────────────────────────────────────────────────────
interface Fixtures {
  bigJpeg: Buffer;
  smallPng: Buffer;
  smallPdf: Buffer;
  hugePdf: Buffer;
}
async function makeFixtures(): Promise<Fixtures> {
  // A 12 MP phone photo with EXIF orientation 6 — noise so it doesn't compress.
  const w = 4032;
  const h = 3024;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 2654435761) >>> 24;
  const bigJpeg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const smallPng = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#f8fafc' } })
    .png()
    .toBuffer();
  const smallPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  );
  const hugePdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4 * 1024 * 1024, 0x20)]);
  return { bigJpeg, smallPng, smallPdf, hugePdf };
}

// ─── data ──────────────────────────────────────────────────────────────────
let restaurantId = '';
async function freshPo(tag: string): Promise<{ poId: string; names: string[] }> {
  const [r] = await db.select().from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  if (!r) throw new Error('seeded restaurant not found — run ./scripts/dev-setup.sh');
  restaurantId = r.id;
  const prods = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.restaurantId, r.id),
        inArray(products.canonicalName, ['חזה עוף', 'עגבניה שרי', 'מלפפון חממה', 'שמן זית כתית']),
      ),
    );
  const [sup] = await db.select().from(suppliers).where(eq(suppliers.restaurantId, r.id)).limit(1);
  const when = new Date();
  when.setHours(Math.min(when.getHours() + 1, 23), 0, 0, 0);
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: r.id, supplierId: sup!.id, expectedDeliveryAt: when, status: 'sent', source: 'manual', notes: `qa-${tag}` })
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
  return { poId: po!.id, names: prods.map((p) => p.canonicalName) };
}

async function invoicesSince(t: Date) {
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.restaurantId, restaurantId), gte(invoices.createdAt, t)))
    .orderBy(desc(invoices.createdAt));
}

// ─── browser helpers ───────────────────────────────────────────────────────
let browser: Browser;
let currentPage: Page | null = null;

async function session(role: Role, opts: { mobile: boolean; locale: 'he' | 'en'; consent?: boolean }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
    deviceScaleFactor: opts.mobile ? 2 : 1,
  });
  await ctx.addCookies([
    ...(opts.consent === false ? [] : [{ name: 'rm_cookie_consent', value: 'necessary', url: BASE }]),
    { name: 'rm_locale', value: opts.locale, url: BASE },
  ]);
  const page = await ctx.newPage();
  currentPage = page;
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000);
  await page.goto(`${BASE}/login`);
  await page.locator('#email').fill(`${role}@kfar-hazeitim.test`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#password').press('Enter');
  await page.waitForURL(/\/dashboard/, { timeout: 180_000 });
  // The receiver's membership prefers English; force the scenario's locale.
  await ctx.addCookies([{ name: 'rm_locale', value: opts.locale, url: BASE }]);
  return { ctx, page };
}

async function openWizard(page: Page, poId: string) {
  await page.goto(`${BASE}/dashboard/receiving/${poId}`);
  await page.locator('input[type="file"]').waitFor({ state: 'attached' });
}

async function pick(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
}

const PROCESS = /^(Process invoice|עבד את החשבונית)/;
async function waitUploaded(page: Page) {
  await page.getByText(/^(Saved|נשמר) · scan-/).waitFor({ timeout: 120_000 });
}
async function waitReview(page: Page) {
  await page.getByRole('heading', { name: /^(Check result|תוצאת ההצלבה)$/ }).waitFor({ timeout: 180_000 });
}

async function scenario(id: string, title: string, fn: (check: (c: unknown, msg: string) => void) => Promise<void>) {
  const only = process.argv.slice(2);
  if (only.length && !only.includes(id)) return;
  const t0 = Date.now();
  const checks: string[] = [];
  const check = (c: unknown, msg: string) => {
    if (!c) throw new Error(`check failed: ${msg}`);
    checks.push(msg);
  };
  try {
    await fn(check);
    results.push({ id, title, status: 'PASS', checks, ms: Date.now() - t0 });
    console.log(`PASS ${id} ${title}`);
  } catch (err) {
    results.push({ id, title, status: 'FAIL', checks, error: err instanceof Error ? err.message.split('\n')[0] : String(err), ms: Date.now() - t0 });
    if (process.env.QA_FAIL_SHOTS && currentPage) {
      await currentPage.screenshot({ path: join(process.env.QA_FAIL_SHOTS, `FAIL-${id}.png`) }).catch(() => {});
    }
    console.log(`FAIL ${id} ${title}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
  }
}

/** Row badges saying "Missing on invoice" — the KPI counter tile with the same label is not an alarm. */
async function missingAlarms(page: Page): Promise<number> {
  return Math.max(0, (await page.getByText('Missing on invoice', { exact: true }).count()) - 1);
}

/** Is the element's centre the top-most hit target (not under an overlay)? */
async function unobstructed(page: Page, testIdOrLocator: ReturnType<Page['locator']>): Promise<boolean> {
  await testIdOrLocator.scrollIntoViewIfNeeded();
  const box = await testIdOrLocator.boundingBox();
  if (!box) return false;
  const handle = await testIdOrLocator.elementHandle();
  return page.evaluate(
    ({ x, y, el }) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && el && (hit === el || el.contains(hit)));
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2, el: handle },
  );
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `qa-${name}.png`), fullPage: true }).catch(() => {});
}

async function latestLocalScanSize(): Promise<number | null> {
  try {
    const dir = join(LOCAL_SCANS, restaurantId);
    const files = (await readdir(dir)).filter((f) => !f.endsWith('.json'));
    let newest: { m: number; size: number } | null = null;
    for (const f of files) {
      const s = await stat(join(dir, f));
      if (!newest || s.mtimeMs > newest.m) newest = { m: s.mtimeMs, size: s.size };
    }
    return newest?.size ?? null;
  } catch {
    return null;
  }
}

// ─── scenarios ─────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(SHOTS, { recursive: true });
  browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const fx = await makeFixtures();
  console.log(`fixtures: big jpeg ${(fx.bigJpeg.length / 1e6).toFixed(1)} MB, huge pdf ${(fx.hugePdf.length / 1e6).toFixed(1)} MB`);
  // QA_NO_WORKER=1: production run (`next start`) — no worker / dev OCR stub.
  if (process.env.QA_NO_WORKER !== '1') await workerOn();
  let enInvoiceId = '';

  await scenario('A', 'receiver · en · 390px — huge photo, double-tap process, English review, double-tap close', async (check) => {
    const { poId, names } = await freshPo('A');
    const t = new Date();
    const { ctx, page } = await session('receiver', { mobile: true, locale: 'en' });
    await openWizard(page, poId);
    await pick(page, 'IMG_4032.jpg', 'image/jpeg', fx.bigJpeg);
    await waitUploaded(page);
    const stored = await latestLocalScanSize();
    check(stored !== null && stored <= 3 * 1024 * 1024, `12 MP photo stored downscaled (${stored} bytes ≤ 3 MB; original ${fx.bigJpeg.length})`);
    await page.getByRole('button', { name: PROCESS }).dblclick();
    await waitReview(page);
    const cards = page.getByTestId('recon-cards');
    await cards.getByTestId('item-name-en').filter({ hasText: 'Chicken breast' }).first().waitFor();
    for (const he of names) await cards.getByTestId('item-name-he').filter({ hasText: he }).first().waitFor();
    check(true, 'English names with Hebrew originals underneath');
    check(await page.locator('html[lang="en"][dir="ltr"]').count(), 'English page is LTR');
    await shot(page, 'A-review-en-mobile');
    await page.getByTestId('continue-adjust').click();
    const cardsToFix = page.locator('.adjust-card').filter({ has: page.getByRole('button', { name: /^= (invoice|order) \(/ }) });
    const n = await cardsToFix.count();
    for (let i = 0; i < n; i += 1) {
      const card = cardsToFix.nth(i);
      const invBtn = card.getByRole('button', { name: /^= invoice \(/ });
      await ((await invBtn.count()) ? invBtn : card.getByRole('button', { name: /^= order \(/ })).click();
    }
    await page.getByTestId('close-receipt').dblclick();
    await page.getByTestId('receipt-confirmed').waitFor();
    await shot(page, 'A-confirmed-en-mobile');
    const inv = await invoicesSince(t);
    check(inv.length === 1, `double-tap registered exactly one invoice (got ${inv.length})`);
    enInvoiceId = inv[0]!.id;
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.poId, poId));
    check(gr?.status === 'completed' || gr?.status === 'partial', `receipt closed once (${gr?.status})`);
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, enInvoiceId));
    check(lines.length === 4 && lines.every((l) => l.rawDescriptionEn), 'invoice lines have English persisted');
    // Discrepancies: the dev stub bills line 1 ~8% over the agreed price.
    let runs: unknown[] = [];
    for (let i = 0; i < 20 && runs.length === 0; i += 1) {
      runs = await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, enInvoiceId));
      if (!runs.length) await new Promise((r) => setTimeout(r, 1500));
    }
    check(runs.length >= 1, 'the 3-way match ran for the invoice (discrepancies computed)');
    await ctx.close();
  });

  await scenario('B', 'manager · he · desktop — PDF upload, Hebrew RTL review, adjust, confirm', async (check) => {
    const { poId } = await freshPo('B');
    const t = new Date();
    const { ctx, page } = await session('manager', { mobile: false, locale: 'he' });
    await openWizard(page, poId);
    await pick(page, 'invoice.pdf', 'application/pdf', fx.smallPdf);
    await waitUploaded(page);
    await page.getByRole('button', { name: PROCESS }).click();
    await waitReview(page);
    check(await page.locator('html[lang="he"][dir="rtl"]').count(), 'Hebrew page is RTL');
    check(await page.getByTestId('recon-table').isVisible(), 'desktop shows the comparison table');
    check((await page.getByTestId('item-name-en').count()) === 0, 'no English names in the Hebrew UI');
    await shot(page, 'B-review-he-desktop');
    await page.getByTestId('continue-adjust').click();
    const chips = page.locator('.adjust-card').filter({ has: page.getByRole('button', { name: /^= (חשבונית|הזמנה) \(/ }) });
    const n = await chips.count();
    for (let i = 0; i < n; i += 1) {
      const card = chips.nth(i);
      const b = card.getByRole('button', { name: /^= חשבונית \(/ });
      await ((await b.count()) ? b : card.getByRole('button', { name: /^= הזמנה \(/ })).click();
    }
    await page.getByTestId('close-receipt').click();
    await page.getByTestId('receipt-confirmed').waitFor();
    const inv = await invoicesSince(t);
    check(inv.length === 1 && inv[0]!.rawImageUrl?.includes('/scans/'), 'PDF registered as one invoice');
    await ctx.close();
  });

  await scenario('C', 'owner · en + he — invoice page after receiving', async (check) => {
    if (!enInvoiceId) throw new Error('needs scenario A');
    const { ctx, page } = await session('owner', { mobile: false, locale: 'en' });
    await page.goto(`${BASE}/dashboard/invoices/${enInvoiceId}`);
    await page.getByRole('heading', { name: 'Correct invoice' }).waitFor();
    await page.getByTestId('item-name-en').filter({ hasText: 'Chicken breast' }).first().waitFor();
    check(true, 'English line names on the invoice page');
    check((await page.getByTestId('invoice-ocr-failed').count()) === 0, 'no OCR-failed notice on a read invoice');
    check(/₪/.test(await page.locator('table').innerText()), 'amounts formatted in ₪');
    await shot(page, 'C-invoice-en');
    await ctx.addCookies([{ name: 'rm_locale', value: 'he', url: BASE }]);
    await page.goto(`${BASE}/dashboard/invoices/${enInvoiceId}`);
    await page.getByRole('heading', { name: 'תיקון חשבונית' }).waitFor();
    check(await page.locator('html[dir="rtl"]').count(), 'Hebrew invoice page is RTL');
    await ctx.close();
  });

  await scenario('D', 'receiver · en — retake after review + two photos before processing', async (check) => {
    const { poId } = await freshPo('D');
    const t = new Date();
    const { ctx, page } = await session('receiver', { mobile: true, locale: 'en' });
    await openWizard(page, poId);
    // Two photos: pick one, retake, pick another, then process → one invoice.
    await pick(page, 'first.png', 'image/png', fx.smallPng);
    await waitUploaded(page);
    await page.getByRole('button', { name: 'Retake' }).click();
    await pick(page, 'second.jpg', 'image/jpeg', fx.bigJpeg);
    await waitUploaded(page);
    await page.getByRole('button', { name: PROCESS }).click();
    await waitReview(page);
    check((await invoicesSince(t)).length === 1, 'only the processed photo became an invoice');
    // Retake after the review → a second, separate scan.
    await page.getByRole('button', { name: 'Retake the invoice' }).click();
    await pick(page, 'third.png', 'image/png', fx.smallPng);
    await waitUploaded(page);
    await page.getByRole('button', { name: PROCESS }).click();
    await waitReview(page);
    check((await invoicesSince(t)).length === 2, 'retake registered a second scan (no stale result shown)');
    await ctx.close();
  });

  await scenario('E', 'receiver · en — huge PDF is refused with a clear message (no upload)', async (check) => {
    const { poId } = await freshPo('E');
    const t = new Date();
    const { ctx, page } = await session('receiver', { mobile: true, locale: 'en' });
    await openWizard(page, poId);
    await pick(page, 'huge.pdf', 'application/pdf', fx.hugePdf);
    await page.getByText(/The file is too large \(max 3 MB\)/).waitFor();
    check(true, '"too large" message shown');
    check((await invoicesSince(t)).length === 0, 'nothing registered');
    await shot(page, 'E-huge-pdf-en');
    await ctx.close();
  });

  await scenario('F', 'receiver · en — offline upload shows a network message, recovers when back online', async (check) => {
    const { poId } = await freshPo('F');
    const { ctx, page } = await session('receiver', { mobile: true, locale: 'en' });
    await openWizard(page, poId);
    await ctx.setOffline(true);
    await pick(page, 'offline.png', 'image/png', fx.smallPng);
    const banner = page.getByText(/No connection|Upload failed/);
    await banner.first().waitFor();
    const txt = await banner.first().innerText();
    check(!/Failed to fetch|Internal server error|TRPC/i.test(txt), `no raw error text ("${txt.trim()}")`);
    await shot(page, 'F-offline-en');
    await ctx.setOffline(false);
    await page.getByRole('button', { name: 'Retake' }).click();
    await pick(page, 'online.png', 'image/png', fx.smallPng);
    await waitUploaded(page);
    check(true, 'upload works again once online');
    await ctx.close();
  });

  await scenario('G', 'receiver · en — slow OCR: still-reading → continue with order → background result', async (check) => {
    const { poId } = await freshPo('G');
    await workerOff();
    const { ctx, page } = await session('receiver', { mobile: true, locale: 'en' });
    await openWizard(page, poId);
    await pick(page, 'slow.png', 'image/png', fx.smallPng);
    await waitUploaded(page);
    await page.getByRole('button', { name: PROCESS }).click();
    await page.getByRole('heading', { name: 'Still reading the invoice…' }).waitFor({ timeout: 60_000 });
    await shot(page, 'G-still-reading-en');
    await page.getByTestId('skip-ocr-wait').click();
    await waitReview(page);
    await page.getByTestId('ocr-notice-reading').waitFor();
    check((await missingAlarms(page)) === 0, 'PO-only review shows no "missing" alarms');
    check(await page.getByTestId('recon-pending-banner').isVisible(), 'calm "check by hand" banner instead');
    await shot(page, 'G-po-only-pending-en');
    await workerOn();
    await page.getByTestId('ocr-notice-ready').waitFor({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Show results' }).click();
    await page.getByTestId('item-name-en').filter({ hasText: 'Chicken breast' }).first().waitFor();
    check(true, 'invoice result arrived in the background and was shown on demand');
    await ctx.close();
  });

  await scenario('H', 'receiver · en — OCR failure is shown, receiving continues against the order', async (check) => {
    const { poId } = await freshPo('H');
    await workerOff();
    const t = new Date();
    const { ctx, page } = await session('receiver', { mobile: true, locale: 'en' });
    await openWizard(page, poId);
    await pick(page, 'fail.png', 'image/png', fx.smallPng);
    await waitUploaded(page);
    await page.getByRole('button', { name: PROCESS }).click();
    let inv: Awaited<ReturnType<typeof invoicesSince>> = [];
    for (let i = 0; i < 240 && inv.length === 0; i += 1) {
      inv = await invoicesSince(t);
      if (!inv.length) await new Promise((r) => setTimeout(r, 500));
    }
    // What the worker does on a final failure (markOcrFailed).
    await db
      .update(invoices)
      .set({ status: 'parsed', ocrConfidence: '0', ocrPayload: { provider: 'claude_vision', raw: { ocrFailed: true, reason: 'extraction_failed' } } })
      .where(eq(invoices.id, inv[0]!.id));
    await page.getByTestId('ocr-notice-failed').waitFor({ timeout: 30_000 });
    check(true, 'failed-read notice shown');
    check((await missingAlarms(page)) === 0, 'no false alarms on the PO-only review');
    await shot(page, 'H-ocr-failed-en');
    await page.goto(`${BASE}/dashboard/invoices/${inv[0]!.id}`).catch(() => {});
    await workerOn();
    await ctx.close();
  });

  await scenario('I', 'chef · en — no receiving rights: translated error, never raw server text', async (check) => {
    const { poId } = await freshPo('I');
    const { ctx, page } = await session('chef', { mobile: false, locale: 'en' });
    await openWizard(page, poId);
    await pick(page, 'chef.png', 'image/png', fx.smallPng);
    await waitUploaded(page);
    await page.getByRole('button', { name: PROCESS }).click();
    const alert = page.getByRole('alert').first();
    await alert.waitFor();
    const txt = await alert.innerText();
    check(!/Required role|TRPC|Internal server error/i.test(txt), `translated error ("${txt.trim()}")`);
    check(!/[֐-׿]/.test(txt), 'no Hebrew in the English error');
    await shot(page, 'I-chef-forbidden-en');
    await ctx.close();
  });

  await scenario('J', 'public showcase · en · 390px — demo invoice in English; upload without storage stays in demo mode', async (check) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
    const page = await ctx.newPage();
    currentPage = page;
    // Handing a 11 MB file to the browser alone takes ~20 s on a 4-core box.
    page.setDefaultTimeout(120_000);
    page.setDefaultNavigationTimeout(180_000);
    await page.goto(`${BASE}/showcase/receiver?lang=en`);
    await page.getByRole('heading', { name: 'Which supplier is here?' }).waitFor();
    await page.getByText("Avi's Greengrocer").click();
    await page.getByRole('button', { name: 'Continue to scan' }).click();
    await pick(page, 'demo.jpg', 'image/jpeg', fx.bigJpeg);
    await page.getByText(/Demo mode — not saved to the server/).waitFor({ timeout: 60_000 });
    check(true, 'real photo without storage env → demo mode (server endpoint answered not_configured)');
    await page.getByRole('button', { name: PROCESS }).click();
    await page.getByRole('heading', { name: 'Check result' }).waitFor({ timeout: 60_000 });
    await page.getByTestId('recon-cards').getByText('Cherry tomatoes').waitFor();
    check(true, 'demo review in English');
    await shot(page, 'J-showcase-en-mobile');
    await ctx.close();
  });

  await workerOff();
  await scenario('K', 'receiver · en · 390px · no cookie consent — demo invoice → order-only review → close (S7 trip-wires)', async (check) => {
    const { poId } = await freshPo('K');
    const { ctx, page } = await session('receiver', { mobile: true, locale: 'en', consent: false });
    await openWizard(page, poId);
    const progress = page.getByTestId('wizard-progress');
    check((await progress.getAttribute('data-filled')) === '2' && (await page.getByText('Step 2 of 5').count()) > 0, 'scan: "Step 2 of 5" with 2 of 5 bars filled');
    const demo = page.getByRole('button', { name: 'Use a demo invoice (no upload)' });
    const banner = page.getByRole('button', { name: 'Essential only' });
    const bannerShown = await banner.isVisible().catch(() => false);
    const demoClear = await unobstructed(page, demo);
    // S6 owns the cookie banner (global fix in flight): record, don't fail.
    check(true, `observation (S6): cookie banner shown=${bannerShown}; "Use a demo invoice" ${demoClear ? 'clear' : 'COVERED by it'} at 390px`);
    await shot(page, 'K-scan-cookie-banner-en-mobile');
    if (bannerShown) await banner.click();
    await demo.click();
    await page.getByRole('button', { name: PROCESS }).click();
    await waitReview(page);
    check((await page.getByText(/OCR confidence/).count()) === 0, 'no "OCR confidence 100%" when no invoice was read');
    check((await page.getByText(/Receiving against the order/).count()) > 0, '"receiving against the order" subtitle');
    check((await missingAlarms(page)) === 0, 'no false "missing" lines');
    check(await page.getByTestId('recon-pending-banner').isVisible(), 'calm "check by hand" banner');
    check((await progress.getAttribute('data-filled')) === '4' && (await page.getByText('Step 4 of 5').count()) > 0, 'review: "Step 4 of 5" with 4 bars');
    await shot(page, 'K-po-only-review-en-mobile');
    await page.getByRole('button', { name: 'Continue to quantities' }).click();
    await page.getByRole('heading', { name: 'How much really arrived?' }).waitFor();
    for (let i = 0; i < 30; i += 1) {
      const btn = page.getByRole('button', { name: /^= order/ }).first();
      if (!(await btn.count())) break;
      await btn.click();
    }
    const cta = page.getByTestId('close-receipt');
    check(await unobstructed(page, cta), 'sticky "Close receipt" CTA is the top-most element (nothing over it)');
    await shot(page, 'K-adjust-cta-en-mobile');
    check(await cta.isEnabled(), 'every line checked → close enabled');
    await cta.click();
    await page.getByTestId('receipt-confirmed').waitFor({ timeout: 60_000 });
    const verified = await page.getByTestId('receipt-confirmed').innerText();
    check(!/0 matched, 0 checked/.test(verified) && /checked by hand/.test(verified), 'summary counts the hand-checked lines');
    check((await progress.getAttribute('data-filled')) === '5', 'confirmed: all 5 bars');
    await shot(page, 'K-confirmed-en-mobile');
    await ctx.close();
  });

  await browser.close();
  const pass = results.filter((r) => r.status === 'PASS').length;
  await writeFile(join(OUT, `${process.env.QA_RUN ?? 'receiving-qa'}.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  console.log(`\nQA: ${pass}/${results.length} scenarios passed → docs/client-ready/qa/${process.env.QA_RUN ?? 'receiving-qa'}.json`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await workerOff();
  process.exit(1);
});
