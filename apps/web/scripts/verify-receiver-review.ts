/**
 * S14: the receiving REVIEW screen (main #64–#66: sections both / invoice only /
 * order only, pending + mismatch banners, qty × price) in each receiver language.
 * Needs an invoice that was actually read, so it runs against `next dev`
 * (local scan storage + the dev OCR stub, which bills line 1 ~8% over price and
 * line 2 one unit over — see packages/api/src/receiving/devOcrStub.ts) with the
 * worker running:
 *   BASE_URL=http://localhost:3200 PW_CHROMIUM_PATH=… VIEWPORT=390 \
 *     pnpm exec tsx scripts/verify-receiver-review.ts [ar ru th ti]
 * Opens a new receipt per locale (does not close it).
 */
import { chromium, type Page } from '@playwright/test';
import path from 'node:path';
import { receiving } from '../lib/i18n/messages/receiving';
import { lookup, type MessageTree } from '../lib/i18n/translate';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const OUT = path.resolve(process.cwd(), '../../docs/client-ready/screenshots/wave1-lang-ai');
const WIDTH = Number(process.env.VIEWPORT ?? 390);
const IMAGE = path.resolve(OUT, 'ar-login.png'); // any image: the dev stub ignores the pixels
const LOCALES = (process.argv.slice(2).length ? process.argv.slice(2) : ['ar', 'ru', 'th', 'ti']) as Array<
  'ar' | 'ru' | 'th' | 'ti'
>;
const SCRIPT: Record<string, RegExp> = { ar: /[؀-ۿ]/, ru: /[Ѐ-ӿ]/, th: /[฀-๿]/, ti: /[ሀ-᎟]/ };
const failures: string[] = [];
let passed = 0;
function check(ok: boolean, msg: string) {
  if (ok) passed += 1;
  else failures.push(msg);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
}
function label(locale: string, key: string): string {
  const v = lookup((receiving.extra as Record<string, MessageTree>)[locale], key) ?? lookup(receiving.en as MessageTree, key)!;
  return v.split('{')[0]!.trim();
}

async function qtyOrder(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#main-content span.inline-flex'))
      .filter((s) => Array.from(s.children).some((c) => c.textContent === '×'))
      .filter((s) => (s as HTMLElement).offsetParent !== null)
      .map((s) => {
        const bdis = s.querySelectorAll(':scope > bdi');
        const q = bdis[0]!.getBoundingClientRect();
        const p = bdis[bdis.length - 1]!.getBoundingClientRect();
        return { qtyRight: q.left > p.left, text: (s as HTMLElement).innerText.replace(/\s+/g, ' ') };
      }),
  );
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
  const ctx = await browser.newContext(
    WIDTH === 390
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: WIDTH, height: 900 } },
  );
  await ctx.addCookies([
    { name: 'rm_locale', value: LOCALES[0]!, url: BASE },
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE },
  ]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()} @ ${page.url()}`));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));

  await page.goto(`${BASE}/login`);
  await page.fill('form input[name="email"] >> nth=0', 'receiver@kfar-hazeitim.test');
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 60_000 }), page.click('form button[type="submit"] >> nth=0')]);

  for (const [i, locale] of LOCALES.entries()) {
    await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }]);
    await page.goto(`${BASE}/dashboard/receiving`);
    const link = page.locator('a[href^="/dashboard/receiving/"]');
    await link.first().waitFor({ timeout: 60_000 });
    const hrefs = await link.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    await page.goto(`${BASE}${hrefs[i % hrefs.length]}`);
    await page.locator('input[type="file"]').setInputFiles(IMAGE);
    await page.getByRole('button', { name: label(locale, 'steps.scan.process') }).click();
    await page.getByTestId('continue-adjust').waitFor({ timeout: 90_000 });
    await page.waitForTimeout(500);

    const text = await page.locator('#main-content').innerText();
    const dir = await page.evaluate(() => document.documentElement.dir);
    check(dir === (locale === 'ar' ? 'rtl' : 'ltr'), `${locale} review: <html dir=${dir}>`);
    check(!text.includes(label(locale, 'steps.recon.subtitleNoInvoice')), `${locale} review: built from the read invoice (not order-only)`);
    const sections = await page.locator('[data-testid^="recon-section-"]:visible').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('recon-section-', '')),
    );
    check(sections.length > 0, `${locale} review: sections rendered (${sections.join(', ')})`);
    for (const [key, k] of [['both', 'sectionBoth'], ['invoice_only', 'sectionInvoiceOnly'], ['order_only', 'sectionOrderOnly']] as const) {
      if (!sections.some((s) => s.replace('-', '_') === key)) continue;
      check(text.includes(label(locale, `steps.recon.${k}`)), `${locale} review: "${k}" header in ${locale} ("${label(locale, `steps.recon.${k}`)}")`);
    }
    for (const id of ['recon-pending-banner', 'recon-mismatch-banner']) {
      const b = page.getByTestId(id);
      if (await b.isVisible()) {
        const t = await b.innerText();
        check(SCRIPT[locale]!.test(t), `${locale} review: ${id} in ${locale}`);
      }
    }
    const english = ['On the order and the invoice', 'Only on the invoice', 'Only on the order', 'not matched automatically', 'No invoice line matched', 'Check by hand', 'Quantity differs', 'Price differs', 'Not ordered', 'Missing on invoice'];
    const leaked = english.filter((w) => text.includes(w));
    check(leaked.length === 0, `${locale} review: no English UI left ${leaked.length ? JSON.stringify(leaked) : ''}`);
    const order = await qtyOrder(page);
    const want = locale === 'ar';
    const bad = order.filter((o) => o.qtyRight !== want);
    check(order.length > 0 && bad.length === 0, `${locale} review: qty × price reads qty first in ${want ? 'RTL' : 'LTR'} (${order.length} lines${bad.length ? `, wrong: ${JSON.stringify(bad.slice(0, 2))}` : order.length ? `, e.g. "${order[0]!.text}"` : ''})`);
    const h = await page.evaluate(() => ({ h: document.documentElement.scrollWidth > window.innerWidth + 1 }));
    check(!h.h, `${locale} review: no horizontal scroll at ${WIDTH} px`);
    if (locale === 'ar') {
      const fonts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#main-content bdi span.font-sans')).map((s) => getComputedStyle(s).fontFamily),
      );
      check(fonts.length > 0 && fonts.every((f) => f.includes('Noto Sans Arabic')), `ar review: unit labels use Noto Sans Arabic (${fonts.length})`);
    }
    await page.screenshot({ path: `${OUT}/review-${locale}-${WIDTH}.png`, fullPage: true });
  }
  check(errors.length === 0, `review: zero console errors / 5xx ${errors.length ? JSON.stringify(errors.slice(0, 4)) : ''}`);
  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
