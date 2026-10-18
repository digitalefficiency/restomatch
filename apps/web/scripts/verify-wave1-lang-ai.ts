/**
 * S14 layer-2 verification (receiver languages + AI assistant) against a running
 * PRODUCTION build (`next start`, NODE_ENV=production, RLS app role):
 *   BASE_URL=http://localhost:3100 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     pnpm exec tsx scripts/verify-wave1-lang-ai.ts
 * Password login as seeded users (DEMO_PASSWORD). Fails on HTTP ≥ 400, a wrong
 * <html lang/dir>, console errors, or a missing translation; writes screenshots
 * to docs/client-ready/screenshots/wave1-lang-ai/.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const OUT = path.resolve(process.cwd(), '../../docs/client-ready/screenshots/wave1-lang-ai');
const failures: string[] = [];
const checks: string[] = [];

function check(ok: boolean, msg: string) {
  (ok ? checks : failures).push(msg);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
}

const SCRIPT: Record<string, RegExp> = {
  ar: /[؀-ۿ]/,
  ru: /[Ѐ-ӿ]/,
  th: /[฀-๿]/,
  ti: /[ሀ-᎟]/,
  he: /[֐-׿]/,
  en: /[A-Za-z]/,
};

async function session(browser: Browser, locale: string, mobile: boolean) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
  });
  await ctx.addCookies([
    { name: 'rm_locale', value: locale, url: BASE },
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE },
  ]);
  const page = await ctx.newPage();
  // Dismiss the cookie banner (first-party consent cookie) so it doesn't cover the screenshots.
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return { ctx, page, errors };
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.fill('form input[name="email"] >> nth=0', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 30_000 }), page.click('form button[type="submit"] >> nth=0')]);
}

async function expectHtml(page: Page, lang: string, dir: string, label: string) {
  const got = await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]);
  check(got[0] === lang && got[1] === dir, `${label}: <html lang=${got[0]} dir=${got[1]}> (want ${lang}/${dir})`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });

  // 1. Receiver languages. Login page signed out (per locale), then ONE receiver
  //    session switching locale by cookie (per-email login rate limits).
  for (const [locale, dir] of [['ar', 'rtl'], ['ru', 'ltr'], ['th', 'ltr'], ['ti', 'ltr']] as const) {
    const { ctx, page, errors } = await session(browser, locale, true);
    const res = await page.goto(`${BASE}/login`);
    check((res?.status() ?? 500) < 400, `${locale} /login HTTP ${res?.status()}`);
    await expectHtml(page, locale, dir, `${locale} /login`);
    const loginTitle = await page.locator('h1').first().innerText();
    check(SCRIPT[locale]!.test(loginTitle), `${locale} login title in ${locale}: "${loginTitle}"`);
    await page.screenshot({ path: `${OUT}/${locale}-login.png`, fullPage: true });
    check(errors.length === 0, `${locale} /login: zero console errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await session(browser, 'ar', true);
    await login(page, 'receiver@kfar-hazeitim.test');
    for (const [locale, dir] of [['ar', 'rtl'], ['ru', 'ltr'], ['th', 'ltr'], ['ti', 'ltr']] as const) {
      await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }]);
      const inbox = await page.goto(`${BASE}/dashboard/receiving`);
      check((inbox?.status() ?? 500) < 400, `${locale} /dashboard/receiving HTTP ${inbox?.status()}`);
      await expectHtml(page, locale, dir, `${locale} inbox`);
      const h1 = await page.locator('#main-content h1, #main-content h2').first().innerText();
      check(SCRIPT[locale]!.test(h1), `${locale} inbox heading in ${locale}: "${h1}"`);
      check((await page.locator('[data-testid="language-picker"]:visible').count()) > 0, `${locale} language picker visible`);
      await page.screenshot({ path: `${OUT}/${locale}-receiving-inbox.png`, fullPage: true });

      const href = await page.locator('a[href^="/dashboard/receiving/"]').first().getAttribute('href');
      if (href) {
        const po = await page.goto(`${BASE}${href}`);
        check((po?.status() ?? 500) < 400, `${locale} PO page HTTP ${po?.status()}`);
        await page.waitForTimeout(800);
        const body = await page.locator('#main-content').innerText();
        check(SCRIPT[locale]!.test(body), `${locale} PO page has ${locale} text`);
        // Line names were localized server-side (glossary/cache) and sent to the wizard.
        const html = await page.content();
        const localNames = (html.match(/rawDescriptionEn\\*":\\*"[^"\\]+/g) ?? []).filter((m) => SCRIPT[locale]!.test(m));
        check(localNames.length > 0, `${locale} PO lines carry ${locale} names (${localNames.length} found)`);
        await page.screenshot({ path: `${OUT}/${locale}-receiving-po.png`, fullPage: true });
      } else {
        check(false, `${locale} inbox has a PO link`);
      }
      await page.goto(`${BASE}/dashboard/settings`);
      const settingsText = await page.locator('#main-content').innerText();
      check(/[A-Za-z]{4,}/.test(settingsText), `${locale} settings (non-receiver screen) renders (English fallback)`);
      const askRes = await page.goto(`${BASE}/dashboard/ask`);
      check(
        (askRes?.status() ?? 0) === 404 || !page.url().includes('/dashboard/ask'),
        `${locale} receiver cannot open /dashboard/ask (status ${askRes?.status()}, url ${page.url()})`,
      );
    }
    check(errors.length === 0, `receiver flow (4 locales): zero console errors / 5xx ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
    await ctx.close();
  }

  // 2. Assistant (offline mode — no key in the sandbox) as owner + manager, he + en.
  for (const [locale, dir, email] of [
    ['he', 'rtl', 'owner@kfar-hazeitim.test'],
    ['en', 'ltr', 'owner@kfar-hazeitim.test'],
    ['en', 'ltr', 'manager@kfar-hazeitim.test'],
  ] as const) {
    const who = email.split('@')[0];
    const { ctx, page, errors } = await session(browser, locale, false);
    await login(page, email);
    const nav = await page.locator('a[href="/dashboard/ask"]').count();
    check(nav > 0, `${locale}/${who} nav shows the assistant`);
    const res = await page.goto(`${BASE}/dashboard/ask`);
    check((res?.status() ?? 500) < 400, `${locale}/${who} /dashboard/ask HTTP ${res?.status()}`);
    await expectHtml(page, locale, dir, `${locale}/${who} ask`);
    for (const k of ['leakChange', 'claimWeek', 'priceRaise']) {
      await page.click(`[data-testid="ask-suggestion-${k}"]`);
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="ask-answer"]').length >= n &&
          !document.querySelector('[data-testid="ask-answer"] .animate-spin'),
        ['leakChange', 'claimWeek', 'priceRaise'].indexOf(k) + 1,
        { timeout: 30_000 },
      );
    }
    const answers = await page.locator('[data-testid="ask-answer"]').allInnerTexts();
    check(answers.length === 3, `${locale}/${who} 3 answers rendered`);
    check(answers.every((a) => /₪/.test(a) || /אין|no /i.test(a)), `${locale}/${who} answers cite ₪ figures`);
    check(answers.every((a) => SCRIPT[locale]!.test(a)), `${locale}/${who} answers in ${locale}`);
    check((await page.locator('[data-testid="ask-source"]').count()) > 0, `${locale}/${who} answers link to source screens`);
    const firstSource = await page.locator('[data-testid="ask-source"]').first().getAttribute('href');
    check(Boolean(firstSource?.startsWith('/dashboard')), `${locale}/${who} source link is internal: ${firstSource}`);
    if (who === 'owner') await page.screenshot({ path: `${OUT}/ask-${locale}.png`, fullPage: true });
    if (who === 'owner') await page.waitForTimeout(0);
    if (firstSource) {
      const s = await page.goto(`${BASE}${firstSource}`);
      check((s?.status() ?? 500) < 400, `${locale}/${who} source screen ${firstSource} HTTP ${s?.status()}`);
    }
    check(errors.length === 0, `${locale}/${who} ask: zero console errors / 5xx ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${checks.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
