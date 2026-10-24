/**
 * QA walk for flag `dockPriceContext` ("your usual price" at the dock and on
 * the invoice page) on the seeded demo tenant. Needs a NON-production web
 * server (the dev OCR stub bills line 1 at +8%), local Postgres + Redis; the
 * script starts/stops the OCR worker itself.
 *
 *   cd apps/web && set -a && . ./.env.local && set +a
 *   E2E_BASE_URL=http://localhost:3100 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec tsx scripts/qa-dock-price.ts
 *
 * Screenshots → docs/client-ready/screenshots/dock-price-*.png; prints a JSON report.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { chromium, type Page } from '@playwright/test';
import { and, createDb, eq, invoices, poLines, products, purchaseOrders, restaurants, suppliers } from '@restomatch/db';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const DB_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/restomatch_dev';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const ROOT = resolve(process.cwd(), '../..');
const SHOTS = join(ROOT, 'docs/client-ready/screenshots');
const db = createDb(DB_URL);

/** Ordered at the usual (90-day median) price, so the stub's +8% reads ≈ +8%. */
const LINES = [
  { name: 'מלפפונים', qty: '12', price: '5.90' },
  { name: 'לימונים', qty: '6.5', price: '7.90' },
  { name: 'תפוחי אדמה', qty: '25', price: '4.20' },
];

let worker: ChildProcess | null = null;
const report: Array<Record<string, unknown>> = [];

async function restaurant() {
  const [r] = await db.select().from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  if (!r) throw new Error('seeded restaurant not found');
  return r;
}

async function setFlag(on: boolean) {
  const r = await restaurant();
  const settings = (r.settings ?? {}) as { features?: Record<string, boolean> };
  const features = { ...(settings.features ?? {}) };
  if (on) delete features.dockPriceContext;
  else features.dockPriceContext = false;
  await db.update(restaurants).set({ settings: { ...settings, features } as never }).where(eq(restaurants.id, r.id));
}

async function freshPo(tag: string): Promise<string> {
  const r = await restaurant();
  const [sup] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, r.id), eq(suppliers.name, 'ירקות השרון')))
    .limit(1);
  if (!sup) throw new Error('supplier ירקות השרון not found');
  const all = await db.select().from(products).where(eq(products.restaurantId, r.id));
  const when = new Date();
  when.setHours(Math.min(when.getHours() + 1, 23), 0, 0, 0);
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: r.id, supplierId: sup.id, expectedDeliveryAt: when, status: 'sent', source: 'manual', notes: `qa-dock-${tag}` })
    .returning();
  await db.insert(poLines).values(
    LINES.map((l) => {
      const p = all.find((x) => x.canonicalName === l.name);
      if (!p) throw new Error(`product ${l.name} not found`);
      return { poId: po!.id, productId: p.id, rawDescription: l.name, qtyOrdered: l.qty, unit: 'ק״ג', unitPriceExpected: l.price };
    }),
  );
  return po!.id;
}

async function login(role: 'receiver' | 'owner', locale: 'he' | 'en', width: number) {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE },
    { name: 'rm_locale', value: locale, url: BASE },
  ]);
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
  page.on('response', (r) => r.status() >= 500 && serverErrors.push(`${r.status()} ${r.url()}`));
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000);
  await page.goto(`${BASE}/login`);
  await page.locator('#email').fill(`${role}@kfar-hazeitim.test`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#password').press('Enter');
  await page.waitForURL(/\/dashboard/, { timeout: 180_000 });
  await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }]);
  return { browser, page, consoleErrors, serverErrors };
}

const AXE = resolve(ROOT, 'node_modules/.pnpm/axe-core@4.14.0/node_modules/axe-core/axe.min.js');
/** axe WCAG 2.1 AA, scoped to the hint (the page chrome is other sessions' surface). */
async function axeHint(page: Page): Promise<string[]> {
  if ((await page.locator('[data-testid=dock-price-hint]').count()) === 0) return [];
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> } }).axe;
    const r = await axe.run(
      { include: [['[data-testid=dock-price-hint]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } },
    );
    return r.violations.map((v) => `${v.id} ×${v.nodes.length}`);
  });
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

async function dock(locale: 'he' | 'en', width: number, flagOn: boolean, png: Buffer) {
  const poId = await freshPo(`${locale}-${width}-${flagOn ? 'on' : 'off'}`);
  const s = await login('receiver', locale, width);
  try {
    await s.page.goto(`${BASE}/dashboard/receiving/${poId}`);
    await s.page.locator('input[type="file"]').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: png });
    await s.page.getByText(/^(Saved|נשמר) · scan-/).waitFor({ timeout: 120_000 });
    await s.page.getByRole('button', { name: /^(Process invoice|עבד את החשבונית)/ }).click();
    await s.page.getByRole('heading', { name: /^(Check result|תוצאת ההצלבה)$/ }).waitFor({ timeout: 180_000 });
    await s.page.waitForTimeout(1500); // the price-context query lands after the review renders
    const hints = s.page.locator('[data-testid=dock-price-hint]:visible');
    const texts = await hints.allInnerTexts();
    const name = `dock-price-dock-${locale}-${width}${flagOn ? '' : '-flag-off'}`;
    if (texts.length) await hints.first().scrollIntoViewIfNeeded();
    await s.page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: !texts.length });
    report.push({
      check: 'dock',
      locale,
      width,
      flagOn,
      hints: texts,
      axe: await axeHint(s.page),
      ok: flagOn
        ? texts.length === 1 && /\+\s?8(\.\d)?\s?%/.test(texts[0]!) && /(90 יום|90 days)/.test(texts[0]!)
        : texts.length === 0,
      overflow: await overflow(s.page),
      consoleErrors: s.consoleErrors,
      serverErrors: s.serverErrors,
    });
  } finally {
    await s.browser.close();
  }
}

async function invoicePage(locale: 'he' | 'en', width: number) {
  const r = await restaurant();
  const [inv] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.restaurantId, r.id), eq(invoices.invoiceNumber, 'MF-24108')))
    .limit(1);
  if (!inv) throw new Error('invoice MF-24108 not found');
  const s = await login('owner', locale, width);
  try {
    await s.page.goto(`${BASE}/dashboard/invoices/${inv.id}`, { waitUntil: 'networkidle' });
    const hints = s.page.locator('[data-testid=dock-price-hint]:visible');
    const texts = await hints.allInnerTexts();
    if (texts.length) await hints.first().scrollIntoViewIfNeeded();
    await s.page.screenshot({ path: join(SHOTS, `dock-price-invoice-${locale}-${width}.png`) });
    report.push({
      check: 'invoice',
      locale,
      width,
      hints: texts,
      axe: await axeHint(s.page),
      ok: texts.length >= 1 && texts.some((t) => /89/.test(t) && /\+\s?7\.9\s?%/.test(t)),
      overflow: await overflow(s.page),
      consoleErrors: s.consoleErrors,
      serverErrors: s.serverErrors,
    });
  } finally {
    await s.browser.close();
  }
}

async function main() {
  worker = spawn('pnpm', ['--filter', '@restomatch/worker', 'start'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'ignore',
    detached: true,
  });
  await new Promise((r) => setTimeout(r, 8000));
  const png = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#f8fafc' } }).png().toBuffer();
  try {
    await setFlag(true);
    for (const locale of ['he', 'en'] as const) {
      for (const width of [1366, 390]) {
        await dock(locale, width, true, png);
        await invoicePage(locale, width);
      }
    }
    await setFlag(false);
    await dock('he', 390, false, png);
  } finally {
    await setFlag(true);
    if (worker?.pid) {
      try {
        process.kill(-worker.pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
  }
  console.log(JSON.stringify(report, null, 1));
  process.exit(report.every((r) => r.ok && !(r.axe as string[]).length && !r.overflow && !(r.consoleErrors as string[]).length && !(r.serverErrors as string[]).length) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
