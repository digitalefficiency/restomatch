import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import postgres from 'postgres';
import { he as accountingHe } from '../lib/i18n/messages/accounting/he';
import { en as accountingEn } from '../lib/i18n/messages/accounting/en';
import { en as approvalsEn } from '../lib/i18n/messages/approvals/en';
import { he as approvalsHe } from '../lib/i18n/messages/approvals/he';
import { en as chainEn } from '../lib/i18n/messages/chain/en';
import { he as chainHe } from '../lib/i18n/messages/chain/he';
import { en as commonEn } from '../lib/i18n/messages/common/en';
import { he as commonHe } from '../lib/i18n/messages/common/he';
import { en as landingEn } from '../lib/i18n/messages/landing/en';
import { en as marketingEn } from '../lib/i18n/messages/marketing/en';
import { he as marketingHe } from '../lib/i18n/messages/marketing/he';
import { he as landingHe } from '../lib/i18n/messages/landing/he';
import { en as leaksEn } from '../lib/i18n/messages/leaks/en';
import { he as leaksHe } from '../lib/i18n/messages/leaks/he';
import { en as navEn } from '../lib/i18n/messages/nav/en';
import { he as navHe } from '../lib/i18n/messages/nav/he';
import { en as overviewEn } from '../lib/i18n/messages/overview/en';
import { he as overviewHe } from '../lib/i18n/messages/overview/he';
import { en as receivingEn } from '../lib/i18n/messages/receiving/en';
import { he as receivingHe } from '../lib/i18n/messages/receiving/he';
import { en as viewsEn } from '../lib/i18n/messages/views/en';
import { he as viewsHe } from '../lib/i18n/messages/views/he';

/**
 * The demo, click by click (docs/client-ready/DEMO-PACK.md §4), exactly as the
 * presenter runs it — against a PRODUCTION build (`next start`), at desktop
 * 1366 and phone 390, in Hebrew and English (playwright.demo.config.ts).
 *
 *   A. landing + the "watch 60 seconds" promo dialog (logged out)
 *   B. owner: hero ₪ / %, leak detective, approvals, breakdown → claims, monthly
 *      report, chain (this month + ?p=last_month), branches
 *   C. receiver: /login?lang=…, the HaSharon Produce order, photo → dev OCR stub →
 *      review (sections, banners — no ₪ for the receiver) → Delivery Check (one
 *      hand count, the rest "as ordered" after the blind spot check) → confirm
 *   D. bookkeeper: CSV + uniform-file (1000) exports
 *
 * Every page: zero console errors / uncaught exceptions, no horizontal overflow,
 * <html lang dir> right for the locale, no error boundary. The ₪ figures are
 * asserted CONSISTENT across pages (and across the four projects) rather than
 * pinned: they scale with DEMO_TODAY (the pack quotes the 10-18 seed).
 *
 * Run: e2e/run-demo-path.sh (seeds, builds, serves, runs). Skips itself when
 * DEMO_BASE_URL is unset, so the regular `playwright.config.ts` suite ignores it.
 */

type Locale = 'he' | 'en';

const BASE = process.env.DEMO_BASE_URL;
const STUB = process.env.DEMO_STUB_URL;
const DB_URL = process.env.DEMO_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/restomatch_demoqa';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const DEMO_TODAY = process.env.DEMO_TODAY ?? '2026-10-25';
const OWNER = 'owner@kfar-hazeitim.test';
const RECEIVER = 'receiver@kfar-hazeitim.test';
const BOOKKEEPER = 'bookkeeper@kfar-hazeitim.test';
const MAIN_BRANCH = 'כפר הזיתים';
const HASHARON_EN = 'HaSharon Produce';

test.skip(!BASE, 'DEMO_BASE_URL unset — run e2e/run-demo-path.sh');

const M = {
  he: {
    common: commonHe,
    landing: landingHe,
    overview: overviewHe,
    approvals: approvalsHe,
    leaks: leaksHe,
    views: viewsHe,
    chain: chainHe,
    nav: navHe,
    receiving: receivingHe,
    accounting: accountingHe,
  },
  en: {
    common: commonEn,
    landing: landingEn,
    overview: overviewEn,
    approvals: approvalsEn,
    leaks: leaksEn,
    views: viewsEn,
    chain: chainEn,
    nav: navEn,
    receiving: receivingEn,
    accounting: accountingEn,
  },
} as const;

const localeOf = (info: TestInfo): Locale => (info.project.use.locale?.startsWith('en') ? 'en' : 'he');
const isPhone = (info: TestInfo) => !!info.project.use.isMobile;

/* ───────────────────────────── page-level checks ───────────────────────────── */

/** Everything that would show red in DevTools on the presenter's screen. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  // #418 (hydration mismatch) forensics: keep the last server-rendered document and,
  // when React reports #418, save it next to the post-hydration DOM for a diff.
  // Keep the body PROMISE with its URL: reading the text is async, and #418 can fire
  // before it resolves — storing the string would pair the new URL with the old page.
  let lastDoc: Promise<string> = Promise.resolve('');
  let lastDocUrl = '';
  page.on('response', (res) => {
    if (res.request().resourceType() !== 'document') return;
    lastDocUrl = res.url();
    lastDoc = res.text().catch(() => '');
  });
  page.on('pageerror', (err) => {
    if (!/Minified React error #4(18|19|21|22|23|25)/.test(err.message)) return;
    const info = test.info();
    const dir = join(info.project.outputDir, 'hydration');
    const tag = `${info.project.name.replace(/[^\w-]+/g, '_')}-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    const docUrl = lastDocUrl;
    void lastDoc.then((body) => writeFileSync(join(dir, `${tag}-server.html`), `<!-- ${docUrl} -->\n${body}`));
    page
      .evaluate(() => document.documentElement.outerHTML)
      .then((html) => writeFileSync(join(dir, `${tag}-client.html`), `<!-- ${lastDocUrl} -->\n${html}`))
      .catch(() => {});
    info.annotations.push({ type: 'hydration', description: `${err.message.slice(0, 80)} → ${join(dir, tag)}-{server,client}.html` });
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location()?.url;
    errors.push(`console.error: ${msg.text()}${where ? ` (${where})` : ''}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

const shotDir = (info: TestInfo) => join(info.project.outputDir, 'demo-path-shots', info.project.name);

/**
 * The per-screen gate: lang/dir, no error boundary, no horizontal scroll, no
 * console errors since the last check. Saves a screenshot of every step (the
 * path goes into the failure message, for the bug report).
 */
async function checkScreen(page: Page, errors: string[], locale: Locale, step: string) {
  const info = test.info();
  await page.waitForLoadState('networkidle').catch(() => {});
  const dir = shotDir(info);
  mkdirSync(dir, { recursive: true });
  const shot = join(dir, `${step.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const where = `[${info.project.name}] ${step} — ${page.url()} — screenshot ${shot}`;

  const html = page.locator('html');
  await expect(html, `lang · ${where}`).toHaveAttribute('lang', locale);
  await expect(html, `dir · ${where}`).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');

  for (const title of [commonHe.errorPage.title, commonEn.errorPage.title, commonHe.notFound.title, commonEn.notFound.title]) {
    await expect(page.getByRole('heading', { name: title, exact: true }), `error boundary · ${where}`).toHaveCount(0);
  }

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const over = doc.scrollWidth - window.innerWidth;
    if (over <= 1) return null;
    // Name the widest offenders so the report says WHAT overflows.
    const vw = window.innerWidth;
    const culprits = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > vw + 1 || r.left < -1);
      })
      .filter((el) => {
        // Skip descendants of an element that clips/scrolls horizontally.
        for (let p = el.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return false;
        }
        return true;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`);
    return `${over}px wider than the viewport; e.g. ${culprits.join(', ')}`;
  });
  expect(overflow, `horizontal overflow · ${where}`).toBeNull();

  expect(errors, `console errors · ${where}`).toEqual([]);
  errors.length = 0;
}

/* ───────────────────────────── reading numbers ───────────────────────────── */

const BIDI = /[‎‏‪-‮⁦-⁩ ]/g;

/** "‏1,234.50 ‏₪" / "₪1,234.50" / "-₪3" → 1234.5. Throws when there is no number. */
function num(text: string): number {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(text.replace(BIDI, ' '));
  if (!m) throw new Error(`no number in ${JSON.stringify(text)}`);
  return Number(m[0].replace(/,/g, ''));
}

/** All ₪ amounts in a string, in order. */
function amounts(text: string): number[] {
  const clean = text.replace(BIDI, ' ');
  // Same-line whitespace only: "October 2026\n₪760" must not read as ₪2026.
  const re = /₪[^\S\n]*(-?\d[\d,]*(?:\.\d+)?)|(-?\d[\d,]*(?:\.\d+)?)[^\S\n]*₪/g;
  const out: number[] = [];
  for (let m = re.exec(clean); m; m = re.exec(clean)) out.push(Number((m[1] ?? m[2])!.replace(/,/g, '')));
  return out;
}

/**
 * The value of a KPI tile/stat: finds the element whose own text is exactly
 * `label`, walks up to its card and returns the first line after the label
 * that holds a digit. Works for the dt/dd hero stats and the tile KPIs alike.
 */
async function valueAfter(scope: Page | Locator, label: string): Promise<string> {
  const root = 'goto' in scope ? scope.locator('body') : scope;
  const read = () => root.evaluate((el, label) => {
    const leaves = [...el.querySelectorAll('*')].filter((e) => e.textContent?.trim() === label && ![...e.children].some((c) => c.textContent?.trim() === label));
    for (const leaf of leaves) {
      let node: Element | null = leaf;
      for (let i = 0; i < 4 && node; i += 1) {
        node = node.parentElement;
        if (!node) break;
        const txt = (node as HTMLElement).innerText;
        const after = txt.slice(txt.indexOf(label) + label.length);
        const line = after.split('\n').find((l) => /\d/.test(l));
        if (line) return line.trim();
      }
    }
    return '';
  }, label);
  // Soft navigations commit the URL before the new page renders: poll.
  let value = '';
  await expect
    .poll(async () => (value = await read()), { message: `a value after the label ${JSON.stringify(label)}`, timeout: 15_000 })
    .not.toBe('');
  return value;
}

/* ───────────────────────────── navigation helpers ───────────────────────────── */

async function setLocaleCookie(context: BrowserContext, locale: Locale, ...urls: (string | undefined)[]) {
  await context.addCookies(
    urls.filter((u): u is string => !!u).map((url) => ({ name: 'rm_locale', value: locale, url })),
  );
}

/** Logs in through the real /login form, like the presenter (password, no magic link). */
async function login(page: Page, base: string, email: string, locale: Locale) {
  await page.goto(`${base}/login?lang=${locale}`);
  await dismissCookieBanner(page);
  const form = page.locator('form', { has: page.locator('input[name="password"]') });
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page, `${email} should land on the dashboard`).toHaveURL(/\/dashboard/);
}

async function goto(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'load' });
  expect(res?.status() ?? 0, `${path} HTTP status`).toBeLessThan(400);
  expect(new URL(page.url()).pathname, `${path} bounced to /login`).not.toBe('/login');
  await dismissCookieBanner(page);
}

/**
 * A clean browser shows the cookie-consent bar; on a phone it covers the bottom
 * nav until answered. The presenter answers it once ("essential only").
 */
async function dismissCookieBanner(page: Page) {
  for (const msgs of [marketingHe, marketingEn]) {
    const bar = page.getByRole('dialog', { name: msgs.cookie.label });
    if (await bar.isVisible().catch(() => false)) {
      await bar.getByRole('button', { name: msgs.cookie.necessary }).click();
      await expect(bar).toBeHidden();
    }
  }
}

/** Click a visible link (desktop sidebar / phone bottom nav or menu) like the presenter would; else navigate. */
async function clickNav(page: Page, name: string, path: string) {
  const link = page.getByRole('link', { name, exact: true }).filter({ visible: true }).first();
  if (await link.count()) {
    await link.click();
    await page.waitForURL((u) => u.pathname === path.split('?')[0], { timeout: 30_000 });
  } else {
    await goto(page, path);
  }
}

/* ───────────────────── cross-project ₪ consistency ledger ───────────────────── */

type Ledger = Record<string, Record<string, number>>;
const ledgerFile = () => join(test.info().project.outputDir, 'demo-path-numbers.json');

/** The same seed must show the same ₪ in every project (he/en, desktop/phone). */
function recordNumbers(numbers: Record<string, number>) {
  const info = test.info();
  let ledger: Ledger = {};
  try {
    ledger = JSON.parse(readFileSync(ledgerFile(), 'utf8')) as Ledger;
  } catch {
    /* first project */
  }
  for (const [project, other] of Object.entries(ledger)) {
    if (project === info.project.name) continue;
    for (const [k, v] of Object.entries(numbers)) {
      if (k in other) expect(v, `"${k}" in ${info.project.name} vs ${project}`).toBe(other[k]);
    }
  }
  ledger[info.project.name] = { ...ledger[info.project.name], ...numbers };
  mkdirSync(info.project.outputDir, { recursive: true });
  writeFileSync(ledgerFile(), JSON.stringify(ledger, null, 2));
  info.annotations.push({ type: 'numbers', description: JSON.stringify(numbers) });
}

/* ───────────────────────────── fixtures (DB) ───────────────────────────── */

function db() {
  return postgres(DB_URL, { max: 1, onnotice: () => {} });
}

async function withDb<T>(fn: (sql: ReturnType<typeof db>) => Promise<T>): Promise<T> {
  const sql = db();
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** Today's date in Israel — what the app's "today" means. */
function israelToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/**
 * The seeded HaSharon order the presenter receives, plus a fresh CLONE of it
 * (same lines, delivery a month out so it never shows in today's inbox) for
 * this project to actually receive — confirming closes an order, and each of
 * the four projects must start from the untouched state.
 */
async function hasharonOrders(projectName: string): Promise<{ original: string; clone: string }> {
  const sql = db();
  try {
    const [po] = await sql<{ id: string }[]>`
      select po.id from purchase_orders po join suppliers s on s.id = po.supplier_id
      join restaurants r on r.id = po.restaurant_id
      where s.name_en = ${HASHARON_EN} and r.name = ${MAIN_BRANCH} and po.status = 'sent'
        and po.notes is distinct from 'demo-qa clone'
      order by po.expected_delivery_at limit 1`;
    if (!po) throw new Error('seed has no open HaSharon Produce order (seed with DEMO_TODAY, then seed-demo)');
    const [clone] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, total_estimated,
                                   created_by, notes, sent_at, sent_channel, vat_rate, customer_ref, buyer_name)
      select restaurant_id, supplier_id, expected_delivery_at + interval '30 days', status, source, total_estimated,
             created_by, 'demo-qa clone', sent_at, sent_channel, vat_rate, ${projectName}, buyer_name
      from purchase_orders where id = ${po.id}
      returning id`;
    await sql`
      insert into po_lines (po_id, product_id, raw_description, raw_description_en, qty_ordered, unit, unit_price_expected, notes, supplier_sku)
      select ${clone!.id}, product_id, raw_description, raw_description_en, qty_ordered, unit, unit_price_expected, notes, supplier_sku
      from po_lines where po_id = ${po.id} order by id`;
    return { original: po.id, clone: clone!.id };
  } finally {
    await sql.end();
  }
}

/** A photographed paper invoice: rendered once per test, uploaded as a JPEG. */
async function invoicePhoto(browser: Browser): Promise<Buffer> {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1100 } });
  const p = await ctx.newPage();
  await p.setContent(
    `<div dir="rtl" style="font:22px sans-serif;padding:40px;background:#fff;color:#111">
       <h2>ירקות השרון בע״מ — חשבונית מס</h2><p>עגבניות שרי 15 ק״ג × 12.96</p><p>חצילים 9 ק״ג</p><p>סה״כ לתשלום</p></div>`,
  );
  const buf = await p.screenshot({ type: 'jpeg', quality: 80 });
  await ctx.close();
  return buf;
}

/** Pick the photo; the scan step's input is server-rendered, so re-pick once if it raced hydration. */
async function uploadInvoice(page: Page, photo: Buffer, processLabel: string) {
  await page.waitForLoadState('networkidle').catch(() => {});
  const process = page.getByRole('button', { name: processLabel });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator('input[type="file"]').setInputFiles({ name: 'invoice.jpg', mimeType: 'image/jpeg', buffer: photo });
    if (await process.isVisible({ timeout: 5_000 }).catch(() => false)) return;
  }
  await expect(process, 'the picked photo never reached "Process invoice"').toBeVisible();
}

/* ═══════════════════════════════ A. landing ═══════════════════════════════ */

test('A · landing + 60-second promo (logged out)', async ({ page }, info) => {
  const L = localeOf(info);
  const t = M[L].landing;
  const errors = watchErrors(page);

  await test.step('landing', async () => {
    await goto(page, `/?lang=${L}`);
    await expect(page.locator('h1')).toBeVisible();
    // Pack 0:00 — the ₪ example and "from ₪349 / month" are on the page.
    await expect(page.locator('main')).toContainText('349');
    await checkScreen(page, errors, L, 'A1-landing');
  });

  await test.step('scroll to the lead form ("free leak check")', async () => {
    await page.getByRole('link', { name: t.hero.ctaPrimary }).first().click();
    await expect(page.locator('#lead')).toBeInViewport();
    await checkScreen(page, errors, L, 'A2-lead-form');
  });

  await test.step('promo dialog opens, has the film, closes on Esc', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: t.hero.ctaWatch }).click();
    const dialog = page.getByRole('dialog', { name: t.hero.watchTitle });
    await expect(dialog).toBeVisible();
    const video = dialog.locator('video');
    await expect(video).toHaveCount(1);
    const src = await video.getAttribute('src');
    expect(src, 'promo <video src>').toBeTruthy();
    const media = await page.request.get(src!, { headers: { Range: 'bytes=0-1023' } });
    expect(media.status(), `promo film ${src}`).toBeLessThan(300);
    expect(media.headers()['content-type'] ?? '').toMatch(/^video\//);
    await checkScreen(page, errors, L, 'A3-promo-open');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(dialog.locator('video')).toHaveCount(0); // unmounted → playback stops
  });

  await test.step('pricing', async () => {
    await goto(page, '/pricing');
    for (const price of ['349', '590', '1,490']) await expect(page.locator('main')).toContainText(price);
    await checkScreen(page, errors, L, 'A4-pricing');
  });
});

/* ═══════════════════════════════ B. owner ═══════════════════════════════ */

test('B · owner: hero ₪, leak detective, approvals, claims, report, chain, branches', async ({ page, context }, info) => {
  const L = localeOf(info);
  const m = M[L];
  const errors = watchErrors(page);
  await setLocaleCookie(context, L, BASE);
  const n: Record<string, number> = {};

  await test.step('login → /dashboard of the main branch', async () => {
    await login(page, BASE!, OWNER, L);
    await expect(page.locator('header').first()).toContainText(MAIN_BRANCH);
    await checkScreen(page, errors, L, 'B1-login-dashboard');
  });

  await test.step('dashboard hero: ₪ leak, % of spend, caught, claimed, pending approvals', async () => {
    // Pack 2:30: if the "engine unavailable" banner shows, the worker is down.
    await expect(page.getByText(m.nav.worker.title), 'worker-offline banner on the demo dashboard').toHaveCount(0);
    const hero = page.locator('section[aria-labelledby="leak-hero-label"]');
    await expect(hero.locator('#leak-hero-label')).toHaveText(m.overview.hero.leakedLabel);
    // The one number sits above the fold (1366×768 and 390×844): no extra hero tile may push it down.
    await page.evaluate(() => window.scrollTo(0, 0));
    const leakBox = await hero.getByTestId('leak-hero-amount').boundingBox();
    const fold = page.viewportSize()!.height;
    expect(leakBox, 'hero ₪ is rendered').not.toBeNull();
    expect(leakBox!.y + leakBox!.height, `hero ₪ bottom vs the ${fold}px fold`).toBeLessThanOrEqual(fold);
    const heroText = await hero.innerText();
    n.leak = num(await hero.getByTestId('leak-hero-amount').innerText());
    n.pct = num(/(\d+(?:\.\d+)?)\s*%/.exec(heroText.replace(BIDI, ''))![1]!);
    n.spend = num(await hero.getByTestId('leak-hero-base').innerText());
    // The split boxes are desktop-only (the phone reads them as one sentence): read the DOM text.
    // The hero split is by payment status (unpaid / paid invoices) and adds up to the hero.
    n.unpaid = num((await hero.getByTestId('hero-unpaid').textContent())!.replace(m.overview.hero.unpaid, ''));
    n.paid = num((await hero.getByTestId('hero-paid').textContent())!.replace(m.overview.hero.paid, ''));
    // "מחכה לך": the decisions waiting for the viewer, in ₪ and count (the old count-only KPI is gone).
    n.pendingApprovals = num(await page.getByTestId('needs-decide-sub').innerText());
    n.decide = num(await page.getByTestId('needs-decide-value').innerText());
    expect(n.leak, 'hero leak > 0 (the demo needs a number)').toBeGreaterThan(0);
    // The % is leak ÷ spend, rounded to one decimal (no target line: R-14 default).
    expect(Math.abs(n.pct - Math.round((n.leak / n.spend) * 1000) / 10), `hero % (${n.pct}) vs ₪${n.leak} ÷ ₪${n.spend}`).toBeLessThanOrEqual(0.1);
    // The leak splits into "on unpaid invoices" + "on paid invoices" (by payment status).
    expect(Math.abs(n.unpaid + n.paid - n.leak), `unpaid ₪${n.unpaid} + paid ₪${n.paid} vs leak ₪${n.leak}`).toBeLessThanOrEqual(1);
    await checkScreen(page, errors, L, 'B2-hero');
  });

  await test.step('leak detective (בלש דליפות): same ₪ / % / spend, price creep', async () => {
    await clickNav(page, m.nav.links.leaks, '/dashboard/leaks');
    await expect(page.locator('main h1, main h2').first()).toBeVisible();
    expect(num(await valueAfter(page, m.views.kpis.leak)), 'leak detective ₪ vs dashboard hero').toBe(n.leak);
    expect(num(await valueAfter(page, m.views.kpis.pct)), 'leak detective % vs dashboard hero').toBe(n.pct);
    expect(num(await valueAfter(page, m.views.kpis.spend)), 'leak detective spend vs dashboard hero').toBe(n.spend);
    // Price creep: the beer keg (+10.6% in the pack) is the worst offender.
    await expect(page.locator('main')).toContainText('%');
    await checkScreen(page, errors, L, 'B3-leaks');
  });

  await test.step('approvals: queue count + ₪ at risk match the hero', async () => {
    await clickNav(page, m.nav.links.approvals, '/dashboard/approvals');
    const inQueue = num(await valueAfter(page, m.approvals.summary.inQueue));
    n.atRisk = num(await valueAfter(page, m.approvals.summary.atRisk));
    expect(inQueue, 'approvals "in queue" vs dashboard "waiting for your decision"').toBe(n.pendingApprovals);
    expect(n.atRisk, 'approvals "amount at risk" vs dashboard "waiting for your decision" ₪').toBe(n.decide);
    // Owner sees Approve / Reject, never "escalate to owner" (pack 5:30).
    // W1-07: the approve label carries the claim ₪ ("דרוש {amount} מהספק"), so match around it.
    const approveName = new RegExp(
      '^' + m.approvals.decision.approve.split('{amount}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$',
    );
    await expect(page.getByRole('button', { name: approveName }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: m.approvals.decision.escalate })).toHaveCount(0);
    await checkScreen(page, errors, L, 'B4-approvals');
  });

  await test.step('what is behind the number → credit letters', async () => {
    await goto(page, '/dashboard/leaks/breakdown');
    const total = amounts(await page.locator('main').last().innerText())[0];
    expect(total, 'breakdown headline ₪ vs dashboard hero').toBe(n.leak);
    await checkScreen(page, errors, L, 'B5-breakdown');

    await page.getByRole('link', { name: m.leaks.claims.open }).first().click();
    await page.waitForURL(/\/dashboard\/leaks\/claims/);
    // Decision 18: undecided (open / escalated) lines are never put in a letter — they are the
    // claims page's "decide" banner. So the approvals "amount at risk" (still undecided) is that
    // banner's ₪, not Σ letters. Demo-seed invariant (the approvals queue could in general hold
    // other months), as strict as before: to the agora.
    const undecided = page.getByTestId('claims-undecided');
    await expect(undecided).toBeVisible();
    expect(Number(await undecided.getAttribute('data-amount')), 'claims "undecided" ₪ vs approvals "amount at risk"').toBe(n.atRisk);
    // The letters themselves (what WAS decided to claim): one total per letter, and the page summary is their Σ.
    const lt = await page.getByTestId('letter-total').evaluateAll((es) => es.map((e) => Number(e.getAttribute('data-amount'))));
    expect(lt.length, 'credit letters on the claims page').toBeGreaterThan(0);
    n.claimsTotal = Math.round(lt.reduce((a, b) => a + Math.round(b * 100), 0)) / 100;
    expect(n.claimsTotal, 'Σ credit letters vs the claims page summary').toBe(Number(await page.getByTestId('claims-summary').getAttribute('data-amount')));
    // The "From:" line must be the restaurant presenting, not another branch (pack 7:30 risk).
    const froms = await page.getByText(new RegExp(`^${m.leaks.claims.from.replace('{restaurant}', '')}`)).allInnerTexts();
    for (const f of froms) expect(f.trim(), 'credit letter "From:" line').toBe(m.leaks.claims.from.replace('{restaurant}', MAIN_BRANCH));
    await checkScreen(page, errors, L, 'B6-claims');
  });

  await test.step('monthly leak report: same headline ₪', async () => {
    await goto(page, '/dashboard/leaks/report');
    const reportText = await page.locator('main').last().innerText();
    expect(reportText).toContain(m.leaks.report.headline);
    const afterHeadline = reportText.slice(reportText.indexOf(m.leaks.report.headline));
    expect(amounts(afterHeadline)[0], 'report headline ₪ vs dashboard hero').toBe(n.leak);
    await expect(page.locator('main').last()).toContainText(MAIN_BRANCH);
    await checkScreen(page, errors, L, 'B7-report');
  });

  await test.step('chain dashboard: main branch row = dashboard; ranking sums to the chain total', async () => {
    await goto(page, '/dashboard/chain');
    const rows = page.getByTestId('chain-branch-row');
    await expect(rows).toHaveCount(3);
    const active = rows.filter({ hasText: m.chain.dashboard.ranking.active });
    await expect(active).toHaveCount(1);
    const cells = await active.locator('td').allInnerTexts();
    expect(num(cells[2]!), 'chain: main-branch leak vs dashboard hero').toBe(n.leak);
    expect(num(cells[3]!), 'chain: main-branch % vs dashboard hero').toBe(n.pct);
    expect(num(cells[4]!), 'chain: main-branch spend vs dashboard hero').toBe(n.spend);
    expect(num(cells[5]!), 'chain: main-branch open items vs approvals queue').toBe(n.pendingApprovals);
    n.chainLeak = num(await page.getByTestId('chain-leak').innerText());
    let rowSum = 0;
    for (const row of await rows.all()) rowSum += num((await row.locator('td').nth(2).innerText()));
    // Rows are rounded to whole ₪ each; allow one shekel per row of drift.
    expect(Math.abs(rowSum - n.chainLeak), `Σ branch rows ₪${rowSum} vs chain total ₪${n.chainLeak}`).toBeLessThanOrEqual(1);
    for (const id of ['chain-kpis', 'chain-worst', 'chain-ranking', 'chain-heatmap']) await expect(page.getByTestId(id)).toBeVisible();
    await checkScreen(page, errors, L, 'B8-chain');
  });

  await test.step('chain, last month (?p=last_month): main row = the dashboard "last month"', async () => {
    await goto(page, '/dashboard/chain?p=last_month');
    const active = page.getByTestId('chain-branch-row').filter({ hasText: m.chain.dashboard.ranking.active });
    const cells = await active.locator('td').allInnerTexts();
    n.lastMonthChainRow = num(cells[2]!);
    if (n.lastMonthLeak !== undefined) expect(n.lastMonthChainRow, 'chain last-month main row vs dashboard "last month"').toBe(n.lastMonthLeak);
    await checkScreen(page, errors, L, 'B9-chain-last-month');
  });

  await test.step('branches: 3 branches, the main one active', async () => {
    await goto(page, '/dashboard/branches');
    const items = page.getByTestId('branches-list').locator('li');
    await expect(items).toHaveCount(3);
    await checkScreen(page, errors, L, 'B10-branches');
  });

  recordNumbers(n);
});

/* ═══════════════════════════════ C. receiver ═══════════════════════════════ */

test('C · receiver: HaSharon Produce → photo → OCR → review → Delivery Check → confirm', async ({ page, browser }, info) => {
  test.skip(!STUB, 'DEMO_STUB_URL unset — the dev OCR stub only runs outside NODE_ENV=production');
  const L = localeOf(info);
  const r = M[L].receiving;
  const errors = watchErrors(page);
  const { original, clone } = await hasharonOrders(info.project.name);

  await test.step('/login?lang=… as the receiver', async () => {
    await login(page, STUB!, RECEIVER, L);
    await checkScreen(page, errors, L, 'C1-login');
  });

  await test.step('receiving inbox lists HaSharon Produce today', async () => {
    await clickNav(page, M[L].nav.links.receiving, '/dashboard/receiving');
    // The board shows the next truck enlarged (its own card) and the rest as rows.
    const card = page
      .locator('[data-testid="receiving-po-card"], [data-testid="board-next"]')
      .filter({ hasText: L === 'en' ? HASHARON_EN : 'ירקות השרון' });
    if (israelToday() === DEMO_TODAY) {
      await expect(card, `HaSharon card in the receiving inbox on ${DEMO_TODAY}`).toHaveCount(1);
      await expect(card.locator('xpath=self::a | .//a').first()).toHaveAttribute('href', new RegExp(original));
    } else {
      info.annotations.push({ type: 'note', description: `inbox check skipped: today is ${israelToday()}, seed is for ${DEMO_TODAY}` });
    }
    await checkScreen(page, errors, L, 'C2-inbox');
  });

  await test.step('photograph the invoice → OCR (stub) → "Check result"', async () => {
    await goto(page, `${STUB}/dashboard/receiving/${clone}`);
    await expect(page.getByRole('heading', { name: r.steps.scan.title })).toBeVisible();
    await checkScreen(page, errors, L, 'C3-scan');
    await uploadInvoice(page, await invoicePhoto(browser), r.steps.scan.process);
    await page.getByRole('button', { name: r.steps.scan.process }).click();
    await expect(page.getByRole('heading', { name: r.steps.recon.title })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid^="ocr-notice"]'), 'OCR fell back to the order (stub/worker not running?)').toHaveCount(0);
    // Next's route announcer is an always-present, empty role=alert — only a worded alert is an error.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ }), 'error alert on the review').toHaveCount(0);
  });

  await test.step('review: sections, English names + Hebrew original — and no ₪ for the receiver', async () => {
    const cards = page.getByTestId('recon-cards');
    const table = page.getByTestId('recon-table');
    // Exactly ONE rendering of the review: cards on a phone, the table on desktop
    // (main@145023c rendered both on desktop — the double list fixed by #67).
    await expect(cards.or(table).filter({ visible: true }).first()).toBeVisible();
    const shown = [await cards.isVisible(), await table.isVisible()].filter(Boolean).length;
    expect(shown, 'exactly one of recon-cards / recon-table visible (double list, see #67)').toBe(1);
    if (!isPhone(info)) await expect(table, 'desktop review shows the table').toBeVisible();
    else await expect(cards, 'phone review shows the cards').toBeVisible();
    const view = (await cards.isVisible()) ? cards : table;
    await expect(view.getByTestId('recon-section-both')).toBeVisible();
    await expect(page.getByTestId('recon-mismatch-banner'), 'right supplier → no "nothing matched" banner').toHaveCount(0);
    if (L === 'en') {
      await expect(view.getByTestId('item-name-en').first()).toBeVisible();
      await expect(view).toContainText('Cherry tomatoes');
    }
    // Owner decision: the receiver sees no ₪ — no prices, no totals, no "potential loss".
    await expect(page.locator('main'), 'no ₪ on the receiver\'s review').not.toContainText('₪');
    await expect(page.getByText(r.steps.recon.potentialLoss)).toHaveCount(0);
    await checkScreen(page, errors, L, 'C4-review');
  });

  await test.step('Delivery Check: one line counted by hand, the rest "as ordered" after the blind spot check', async () => {
    await page.getByTestId('continue-adjust').click();
    await expect(page.getByTestId('delivery-check')).toBeVisible();
    // Nothing is pre-resolved — "invoice = order" is not "arrived".
    await expect(page.getByTestId('count-line').first()).toHaveAttribute('data-resolved', 'false');
    // The hand count: the first line, one less than ordered.
    const first = page.getByTestId('count-line').first();
    if (await first.getByTestId('count-edit').count()) await first.getByTestId('count-edit').click();
    const qty = first.getByTestId('count-qty');
    const before = Number((await qty.inputValue()).replace(',', '.'));
    await qty.fill(String(before - 1));
    await qty.press('Enter');
    if (await first.getByTestId('count-confirm-qty').isVisible().catch(() => false)) await first.getByTestId('count-confirm-qty').click();
    await expect(first).toHaveAttribute('data-resolved', 'true');
    // The rest "as ordered" — only after two random lines are counted blind.
    await page.getByTestId('mark-rest').click();
    const panel = page.getByTestId('spot-check');
    await expect(panel).toBeVisible();
    const rows = panel.getByTestId('spot-line');
    for (let i = 0; i < (await rows.count()); i += 1) {
      const id = (await rows.nth(i).getAttribute('data-key'))!.replace(/^po-/, '');
      const [pl] = await withDb((sql) => sql<{ q: string }[]>`select qty_ordered::text as q from po_lines where id = ${id}`);
      await rows.nth(i).getByTestId('spot-qty').fill(String(Number(pl!.q)));
    }
    await panel.getByTestId('spot-confirm').click();
    await expect(page.getByTestId('count-bulk-tag').first()).toBeVisible();
    await expect(page.getByTestId('close-receipt')).toBeEnabled();
    await checkScreen(page, errors, L, 'C5-adjust');
  });

  await test.step('confirm → receipt saved', async () => {
    // The clone is dated a month out (kept out of today's inbox); the matcher only
    // pairs an invoice with an order due within ±7 days of it. Date it like the
    // original while it is received; restored after the dock-slip step.
    await withDb((sql) => sql`
      update purchase_orders c set expected_delivery_at = o.expected_delivery_at
      from purchase_orders o where c.id = ${clone} and o.id = ${original}`);
    await page.getByTestId('close-receipt').click();
    await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: r.steps.confirmed.title })).toBeVisible();
    // Who received it is on the receipt; the ₪-full invoice page is not linked for the receiver.
    await expect(page.getByTestId('confirmed-received-by')).toBeVisible();
    await expect(page.getByTestId('confirmed-invoice-link')).toHaveCount(0);
    await checkScreen(page, errors, L, 'C6-confirmed');
  });

  await test.step('dock slip: quantities only for the receiver; the worker re-matches after the count', async () => {
    // The demo tenant has every feature on (dockSlip included). submitReceipt
    // enqueues the re-match; the real worker runs it against the actual count.
    const slip = page.getByTestId('dock-slip');
    await expect(slip).toBeVisible();
    // The receiver sees no ₪ (owner decision): no line amounts, no total.
    await expect(slip.getByTestId('dock-slip-amount')).toHaveCount(0);
    await expect(slip.getByTestId('dock-slip-total')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('₪');
    // The engine's ₪ (what the owner sees) comes from ONE run after the close.
    await expect
      .poll(
        async () =>
          (await withDb((sql) => sql<{ runs: number }[]>`
            select count(distinct mr.id)::int as runs from goods_receipts gr
            join match_runs mr on mr.gr_id = gr.id where gr.po_id = ${clone}`))[0]!.runs,
        { timeout: 90_000, message: 'the worker re-matched the closed receipt' },
      )
      .toBe(1);
    // The run behind it is from after the close, and saw the count: no line read as received 0.
    const sql = db();
    try {
      const rows = await sql<{ after: boolean; zeroShort: number; runs: number }[]>`
        select bool_and(mr.run_at >= gr.updated_at) as after,
               count(*) filter (where d.type = 'QTY_SHORT' and d.actual_value = 0)::int as "zeroShort",
               count(distinct mr.id)::int as runs
        from goods_receipts gr
        join match_runs mr on mr.gr_id = gr.id
        left join discrepancies d on d.match_run_id = mr.id
        where gr.po_id = ${clone}`;
      expect(rows[0]!.runs, 'one match run for the receipt').toBe(1);
      expect(rows[0]!.after, 'the run is from after the receipt was closed').toBe(true);
      expect(rows[0]!.zeroShort, 'no line matched as "received 0"').toBe(0);
    } finally {
      await sql.end();
    }
    await checkScreen(page, errors, L, 'C7-dock-slip');
  }).finally(() =>
    withDb((sql) => sql`
      update purchase_orders set expected_delivery_at = expected_delivery_at + interval '30 days'
      where id = ${clone} and expected_delivery_at < now() + interval '20 days'`),
  );
});

/* ═══════════════════════════════ D. bookkeeper ═══════════════════════════════ */

test('D · bookkeeper: CSV + uniform-file exports', async ({ page, context }, info) => {
  const L = localeOf(info);
  const a = M[L].accounting;
  const errors = watchErrors(page);
  await setLocaleCookie(context, L, BASE);

  await test.step('login → exports', async () => {
    await login(page, BASE!, BOOKKEEPER, L);
    await clickNav(page, M[L].nav.links.exports, '/dashboard/exports');
    await expect(page.getByRole('heading', { name: a.title })).toBeVisible();
    await checkScreen(page, errors, L, 'D1-exports');
  });

  for (const kind of ['csv', 'uniform'] as const) {
    await test.step(`download ${kind}`, async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: a[kind].button }).click(),
      ]);
      const path = await download.path();
      const body = readFileSync(path!);
      expect(body.length, `${kind} export is empty`).toBeGreaterThan(0);
      if (kind === 'csv') {
        const lines = body.toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
        expect(lines.length, 'CSV has a header + at least one invoice').toBeGreaterThan(1);
        // The status line reports the same row count as the file.
        await expect(page.getByText(new RegExp(a.downloaded.replace('{count}', String(lines.length - 1)).replace(/[.—]/g, '.')))).toBeVisible();
      }
      await checkScreen(page, errors, L, `D2-${kind}`);
    });
  }

  // Phone: the exports page is reachable from the bottom nav / menu too.
  if (isPhone(info)) await expect(page.locator('html')).toHaveAttribute('dir', L === 'he' ? 'rtl' : 'ltr');
});

/* ═════════════════════ C′. receiver OCR race (opt-in stress) ═════════════════════ */

/**
 * DEMO_OCR_ROUNDS=N: N fresh uploads in a row (each on its own clone of the
 * HaSharon order). Counts how many fall back to "still reading" instead of the
 * review — the OCR-job-vs-invoice-commit race (#72) hit ~1 in 10. Must be 0.
 * Runs in one project only (desktop-en:receiver).
 */
test('C · receiver OCR race: N uploads all reach "Check result"', async ({ page, browser }, info) => {
  const rounds = Number(process.env.DEMO_OCR_ROUNDS ?? 0);
  test.skip(!STUB || rounds <= 0 || info.project.name !== 'desktop-en:receiver', 'set DEMO_OCR_ROUNDS (runs on desktop-en:receiver)');
  test.setTimeout(rounds * 90_000 + 60_000);
  const r = M.en.receiving;
  await login(page, STUB!, RECEIVER, 'en');
  const photo = await invoicePhoto(browser);
  const outcomes: { round: number; outcome: string; ms: number }[] = [];
  for (let i = 1; i <= rounds; i += 1) {
    const { clone } = await hasharonOrders(`${info.project.name}#race${i}`);
    await goto(page, `${STUB}/dashboard/receiving/${clone}`);
    await uploadInvoice(page, photo, r.steps.scan.process);
    const t0 = Date.now();
    await page.getByRole('button', { name: r.steps.scan.process }).click();
    const review = page.getByRole('heading', { name: r.steps.recon.title });
    const notice = page.locator('[data-testid^="ocr-notice"]');
    await expect(review.or(notice).first()).toBeVisible({ timeout: 75_000 });
    const outcome = (await notice.count()) ? ((await notice.first().getAttribute('data-testid')) ?? 'ocr-notice') : 'review';
    outcomes.push({ round: i, outcome, ms: Date.now() - t0 });
  }
  const bad = outcomes.filter((o) => o.outcome !== 'review');
  info.annotations.push({ type: 'ocr-race', description: `${bad.length}/${rounds} fell back: ${JSON.stringify(outcomes)}` });
  writeFileSync(join(info.project.outputDir, 'demo-path-ocr-race.json'), JSON.stringify(outcomes, null, 2));
  console.log(`[ocr-race] ${bad.length}/${rounds} uploads fell back to the order: ${JSON.stringify(outcomes)}`);
  expect(bad, `uploads that did not reach "Check result" (${bad.length}/${rounds})`).toEqual([]);
});
