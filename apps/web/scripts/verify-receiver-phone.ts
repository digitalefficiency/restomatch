/**
 * S14: the receiver phone flow, end to end, in each receiver language
 * (ar is RTL) on a 390 px viewport, against a PRODUCTION build:
 *   inbox → PO → "use demo invoice" → process → reconciliation → adjust (settle
 *   every line) → close receipt → confirmed.
 *   BASE_URL=http://localhost:3100 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     pnpm exec tsx scripts/verify-receiver-phone.ts [ar ru th ti]
 * Checks on every step: <html lang/dir>, the page never scrolls sideways,
 * no button/link/badge text is clipped, the step text is in the locale's
 * script, Arabic blocks compute `direction: rtl`, zero console errors / 5xx.
 * Screenshots: docs/client-ready/screenshots/wave1-lang-ai/phone-<locale>-<n>-<step>.png
 * NOTE: completes one receipt per locale on the seeded dev DB.
 */
import { chromium, type Page } from '@playwright/test';
import path from 'node:path';
import { receiving } from '../lib/i18n/messages/receiving';
import { lookup, type MessageTree } from '../lib/i18n/translate';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const OUT = path.resolve(process.cwd(), '../../docs/client-ready/screenshots/wave1-lang-ai');
/** VIEWPORT=1366 runs the same flow on a laptop width (screenshots get a "-1366" suffix). */
const WIDTH = Number(process.env.VIEWPORT ?? 390);
const SUFFIX = WIDTH === 390 ? '' : `-${WIDTH}`;
const LOCALES = (process.argv.slice(2).length ? process.argv.slice(2) : ['ar', 'ru', 'th', 'ti']) as Array<
  'ar' | 'ru' | 'th' | 'ti'
>;
const SCRIPT: Record<string, RegExp> = {
  ar: /[؀-ۿ]/,
  ru: /[Ѐ-ӿ]/,
  th: /[฀-๿]/,
  ti: /[ሀ-᎟]/,
};
const failures: string[] = [];
let passed = 0;
function check(ok: boolean, msg: string) {
  if (ok) passed += 1;
  else failures.push(msg);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
}

/** The overlay string for a receiving key, with {placeholders} cut (prefix match). */
function label(locale: string, key: string): string {
  const v = lookup((receiving.extra as Record<string, MessageTree>)[locale], key) ?? lookup(receiving.en as MessageTree, key)!;
  return v.split('{')[0]!.trim();
}

async function layoutChecks(page: Page, locale: string, step: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const clipped: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('#main-content button, #main-content a, #main-content [class*="rounded-full"]'),
    )) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || el.offsetParent === null) continue;
      if (el.scrollWidth > el.clientWidth + 2 && s.overflowX !== 'visible') clipped.push((el.innerText || '').slice(0, 40));
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth + 1 || rect.left < -1) clipped.push(`offscreen: ${(el.innerText || '').slice(0, 40)}`);
    }
    const main = document.querySelector('#main-content');
    return {
      lang: doc.lang,
      dir: doc.dir,
      hScroll: doc.scrollWidth > window.innerWidth + 1,
      clipped,
      mainDir: main ? getComputedStyle(main).direction : null,
      text: (main as HTMLElement | null)?.innerText ?? '',
    };
  });
  const wantDir = locale === 'ar' ? 'rtl' : 'ltr';
  check(r.lang === locale && r.dir === wantDir, `${locale} ${step}: <html lang=${r.lang} dir=${r.dir}>`);
  check(!r.hScroll, `${locale} ${step}: no horizontal page scroll at ${WIDTH} px`);
  check(r.clipped.length === 0, `${locale} ${step}: no clipped/off-screen buttons ${r.clipped.length ? JSON.stringify(r.clipped) : ''}`);
  check(SCRIPT[locale]!.test(r.text), `${locale} ${step}: text in ${locale}`);
  if (locale === 'ar') check(r.mainDir === 'rtl', `ar ${step}: main content computes direction rtl`);
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
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));

  await page.goto(`${BASE}/login`);
  await page.fill('form input[name="email"] >> nth=0', 'receiver@kfar-hazeitim.test');
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 30_000 }), page.click('form button[type="submit"] >> nth=0')]);

  for (const [i, locale] of LOCALES.entries()) {
    await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }]);
    const shot = (n: number, step: string) => page.screenshot({ path: `${OUT}/phone-${locale}-${n}-${step}${SUFFIX}.png` });

    await page.goto(`${BASE}/dashboard/receiving`);
    await page.locator('a[href^="/dashboard/receiving/"]').first().waitFor({ timeout: 30_000 });
    await layoutChecks(page, locale, 'inbox');
    await shot(1, 'inbox');

    const hrefs = await page.locator('a[href^="/dashboard/receiving/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    const href = hrefs[i % Math.max(1, hrefs.length)];
    if (!href) {
      check(false, `${locale}: inbox has a PO`);
      continue;
    }
    await page.goto(`${BASE}${href}`);
    await page.waitForTimeout(500);
    await layoutChecks(page, locale, 'scan');
    await shot(2, 'scan');

    await page.getByRole('button', { name: label(locale, 'steps.scan.useDemo') }).click();
    await page.getByRole('button', { name: label(locale, 'steps.scan.process') }).click();
    await page.getByTestId('continue-adjust').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    await layoutChecks(page, locale, 'reconciliation');
    const names = await page.locator('[data-testid="item-name-en"]').allInnerTexts();
    check(names.some((n) => SCRIPT[locale]!.test(n)), `${locale} reconciliation: line names in ${locale} (${names.slice(0, 2).join(' | ')})`);
    if (locale === 'ar') {
      const dirs = await page
        .locator('[data-testid="item-name-en"]')
        .evaluateAll((els) => els.map((e) => getComputedStyle(e).direction));
      check(dirs.length > 0 && dirs.every((d) => d === 'rtl'), `ar reconciliation: Arabic item names lay out RTL`);
    }
    // Review sections / banners (main #64–#66) come from the overlay, never English.
    const reconText = await page.locator('#main-content').innerText();
    const sectionKeys = ['steps.recon.sectionBoth', 'steps.recon.sectionInvoiceOnly', 'steps.recon.sectionOrderOnly'];
    const shown = sectionKeys.filter((k) => reconText.includes(label(locale, k)));
    // The demo invoice has no uploaded scan, so this is the order-only review: its
    // subtitle must be translated (sections are covered by verify-receiver-review.ts).
    check(
      shown.length > 0 || reconText.includes(label(locale, 'steps.recon.subtitleNoInvoice')),
      `${locale} reconciliation: review header in ${locale} (${shown.length ? shown.map((k) => k.split('.').pop()).join(', ') : 'order-only subtitle'})`,
    );
    const english = ['On the order and the invoice', 'Only on the invoice', 'Only on the order', 'were not matched automatically', 'No invoice line matched', 'Check by hand', 'Matched', 'Quantity differs', 'Price differs', 'Not ordered'];
    const leaked = english.filter((w) => reconText.includes(w));
    check(leaked.length === 0, `${locale} reconciliation: no English UI left ${leaked.length ? JSON.stringify(leaked) : ''}`);
    // qty × price: the quantity comes first in reading order (right of the price in RTL).
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#main-content span.inline-flex'))
        .filter((s) => Array.from(s.children).some((c) => c.textContent === '×'))
        .filter((s) => (s as HTMLElement).offsetParent !== null)
        .map((s) => {
          const bdis = s.querySelectorAll(':scope > bdi');
          const q = bdis[0]!.getBoundingClientRect();
          const p = bdis[bdis.length - 1]!.getBoundingClientRect();
          return { qtyRight: q.left > p.left, text: (s as HTMLElement).innerText };
        }),
    );
    const wantRight = locale === 'ar';
    check(
      order.length > 0 && order.every((o) => o.qtyRight === wantRight),
      `${locale} reconciliation: qty × price reads qty first (${order.length} lines${order.length ? `, e.g. "${order[0]!.text}"` : ''})`,
    );
    await shot(3, 'reconciliation');

    await page.getByTestId('continue-adjust').click();
    await page.getByTestId('close-receipt').waitFor({ timeout: 15_000 });
    await layoutChecks(page, locale, 'adjust');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(4, 'adjust');

    // Settle every pending line: open each card and take its first action.
    const asOrdered = label(locale, 'steps.adjust.asOrdered');
    const missing = label(locale, 'steps.adjust.missing');
    // Each line card has its own action row; settle them in order (cards may
    // reveal progressively), falling back to "missing" when a line has no PO qty.
    let done = 0;
    for (let guard = 0; guard < 60 && (await page.getByTestId('close-receipt').isDisabled()); guard += 1) {
      const btns = page.locator('button', { hasText: asOrdered });
      if (done < (await btns.count())) {
        await btns.nth(done).scrollIntoViewIfNeeded();
        await btns.nth(done).click();
        done += 1;
      } else {
        const m = page.locator('button', { hasText: missing });
        if (done >= (await m.count())) break;
        await m.nth(done).click();
        done += 1;
      }
      await page.waitForTimeout(120);
    }
    check(!(await page.getByTestId('close-receipt').isDisabled()), `${locale} adjust: every line settled`);
    await page.getByTestId('close-receipt').click();
    await page.getByTestId('receipt-confirmed').waitFor({ timeout: 20_000 });
    await layoutChecks(page, locale, 'confirmed');
    await shot(5, 'confirmed');
  }
  check(errors.length === 0, `phone flow: zero console errors / 5xx ${errors.length ? JSON.stringify(errors.slice(0, 4)) : ''}`);
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
