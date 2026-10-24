/**
 * S14: "Ask RestoMatch" on a CHAIN, against a production build (`next start`),
 * no ANTHROPIC_API_KEY (the deterministic offline answers). The owner of the
 * three demo branches asks "how much leaked this month?" in each branch, in he
 * and en: the answer's ₪ figure must equal THAT branch's dashboard hero, and
 * every answer must link only to /dashboard screens. Zero console errors / 5xx.
 *   BASE_URL=http://localhost:3100 PW_CHROMIUM_PATH=… VIEWPORT=1366 \
 *     pnpm exec tsx scripts/verify-ask-chain.ts
 */
import { chromium, type Page } from '@playwright/test';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const OUT = path.resolve(process.cwd(), '../../docs/client-ready/screenshots/wave1-lang-ai');
const WIDTH = Number(process.env.VIEWPORT ?? 1366);
const failures: string[] = [];
let passed = 0;
function check(ok: boolean, msg: string) {
  if (ok) passed += 1;
  else failures.push(msg);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
}
/** "₪1,234" / "1,234 ₪" → 1234 (first ₪ figure in the text). */
function firstIls(raw0: string): number | null {
  const text = raw0.replace(/[\u200e\u200f\u2066-\u2069]/g, '').replace(/\u00a0/g, ' ');
  const m = text.match(/₪\s?([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s?₪/);
  const raw = m?.[1] ?? m?.[2];
  return raw ? Number(raw.replace(/,/g, '')) : null;
}

async function heroLeak(page: Page): Promise<number | null> {
  await page.goto(`${BASE}/dashboard`);
  const el = page.locator('section[aria-labelledby="leak-hero-label"] p.font-mono').first();
  await el.waitFor({ timeout: 30_000 });
  return firstIls(await el.innerText());
}

async function askLeak(page: Page): Promise<{ ils: number | null; text: string; hrefs: string[] }> {
  await page.goto(`${BASE}/dashboard/ask`);
  await page.click('[data-testid="ask-suggestion-leakTotal"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="ask-answer"]').length > 0 && !document.querySelector('[data-testid="ask-answer"] .animate-spin'),
    undefined,
    { timeout: 30_000 },
  );
  const answer = page.locator('[data-testid="ask-answer"]').last();
  const text = await answer.innerText();
  const hrefs = await answer.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  return { ils: firstIls(text), text: text.replace(/\s+/g, ' ').slice(0, 160), hrefs };
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
  for (const locale of ['he', 'en'] as const) {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
    await ctx.addCookies([
      { name: 'rm_locale', value: locale, url: BASE },
      { name: 'rm_cookie_consent', value: 'necessary', url: BASE },
    ]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text().slice(0, 200)} @ ${page.url()}`));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));

    await page.goto(`${BASE}/login`);
    await page.fill('form input[name="email"] >> nth=0', 'owner@kfar-hazeitim.test');
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 30_000 }), page.click('form button[type="submit"] >> nth=0')]);

    // The header switcher is desktop-only (on a phone it sits in the menu): switch
    // branches at 1366, then ask at the target width.
    const wide = () => page.setViewportSize({ width: 1366, height: 900 });
    const target = () => page.setViewportSize({ width: WIDTH, height: WIDTH === 390 ? 844 : 900 });
    await wide();
    await page.goto(`${BASE}/dashboard`);
    const switcher = page.getByTestId('branch-switcher').first();
    await switcher.waitFor({ timeout: 30_000 });
    await switcher.click();
    const names = (await page.getByTestId('branch-option').allInnerTexts()).map((s) => s.trim());
    await page.keyboard.press('Escape');
    check(names.length >= 2, `${locale}: owner sees ${names.length} branches`);

    const seen: number[] = [];
    for (let i = 0; i < names.length; i += 1) {
      if (i > 0) {
        await wide();
        await page.goto(`${BASE}/dashboard`);
        await page.getByTestId('branch-switcher').first().click();
        // The switcher calls a server action, then window.location.assign('/dashboard').
        await Promise.all([
          page.waitForEvent('framenavigated', { timeout: 30_000 }),
          page.getByTestId('branch-option').nth(i).click(),
        ]);
        await page.waitForLoadState('load');
        const active = await page.getByTestId('branch-switcher').first().innerText();
        check(active.includes(names[i]!.split('\n')[0]!), `${locale}: switched to branch ${i + 1} ("${names[i]!.split('\n')[0]}")`);
      }
      await target();
      const hero = await heroLeak(page);
      const a = await askLeak(page);
      check(hero !== null && a.ils === hero, `${locale} branch ${i + 1}: ask leak ₪${a.ils} = dashboard hero ₪${hero} ("${a.text}")`);
      check(a.hrefs.length > 0 && a.hrefs.every((h) => h.startsWith('/dashboard')), `${locale} branch ${i + 1}: sources are internal screens ${JSON.stringify(a.hrefs)}`);
      if (a.ils !== null) seen.push(a.ils);
      await page.screenshot({ path: `${OUT}/ask-chain-${locale}-${i + 1}.png`, fullPage: true });
    }
    check(new Set(seen).size === seen.length, `${locale}: each branch answers with its own figure (${seen.join(' / ')})`);
    check(errors.length === 0, `${locale}: zero console errors / 5xx ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
    await ctx.close();
  }
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
