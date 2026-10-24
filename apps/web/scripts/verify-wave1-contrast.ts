/**
 * S14 light theme: axe `color-contrast` (WCAG AA 4.5:1) on the wave-1 screens —
 * login (language picker), the receiving inbox, the wizard (scan → review →
 * adjust, with the demo invoice) as the receiver, and /dashboard/ask (empty +
 * answered) as the owner — in he / en / ar at 1366 and 390, on `next start`.
 *   BASE_URL=http://localhost:3400 PW_CHROMIUM_PATH=… pnpm exec tsx scripts/verify-wave1-contrast.ts
 * Uses one fresh PO per locale (leaves its receipt open).
 */
import { chromium, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { receiving } from '../lib/i18n/messages/receiving';
import { lookup, type MessageTree } from '../lib/i18n/translate';

const BASE = process.env.BASE_URL ?? 'http://localhost:3400';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const OUT = path.resolve(process.cwd(), '../../docs/client-ready/screenshots/wave1-lang-ai');
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const LOCALES = ['he', 'en', 'ar'] as const;
const WIDTHS = [1366, 390] as const;

type Row = { locale: string; width: number; screen: string; violations: number; nodes: string[] };
const rows: Row[] = [];
const errors: string[] = [];

function label(locale: string, key: string): string {
  const tree =
    locale === 'he' ? receiving.he : locale === 'en' ? receiving.en : (receiving.extra as Record<string, MessageTree>)[locale];
  const v = lookup(tree as MessageTree, key) ?? lookup(receiving.en as MessageTree, key)!;
  return v.split('{')[0]!.trim();
}

async function contrast(page: Page, locale: string, screen: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    // Measure the settled screen: entry animations (staggered fade-ins) report
    // half-transparent text otherwise. Infinite ones (spinners, flow line) are skipped.
    await page.evaluate(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => undefined)),
        ),
        new Promise((r) => setTimeout(r, 5000)),
      ]),
    );
    // GSAP entrances (the review's staggered rows) run in JS, outside getAnimations():
    // wait until no inline-styled element is still fading in.
    await page
      .waitForFunction(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>('[style*="opacity"]')).every(
            (e) => parseFloat(getComputedStyle(e).opacity) >= 0.999 || e.offsetParent === null,
          ),
        undefined,
        { timeout: 8000 },
      )
      .catch(() => undefined);
    await page.waitForTimeout(250);
    await page.addScriptTag({ path: AXE });
    const r = await page.evaluate(async () => {
      // @ts-expect-error injected
      const res = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
      return res.violations.flatMap((v: { nodes: Array<{ target: string[]; any: Array<{ message: string }> }> }) =>
        v.nodes.map((n) => `${n.target.join(' ')} — ${n.any[0]?.message ?? ''}`),
      );
    });
    rows.push({ locale, width, screen, violations: r.length, nodes: r });
    console.log(`${r.length ? 'FAIL' : 'PASS'} ${locale} ${width} ${screen}: ${r.length} color-contrast violations`);
    for (const n of r.slice(0, 6)) console.log(`     ${n.slice(0, 240)}`);
    await page.screenshot({ path: `${OUT}/light-${locale}-${width}-${screen}.png`, fullPage: true });
  }
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.fill('form input[name="email"] >> nth=0', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 30_000 }), page.click('form button[type="submit"] >> nth=0')]);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
  for (const [i, locale] of LOCALES.entries()) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addCookies([
      { name: 'rm_locale', value: locale, url: BASE },
      { name: 'rm_cookie_consent', value: 'necessary', url: BASE },
    ]);
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`${locale}: ${m.text().slice(0, 160)} @ ${page.url()}`));
    page.on('response', (r) => r.status() >= 500 && errors.push(`${locale}: ${r.status()} ${r.url()}`));

    await page.goto(`${BASE}/login`);
    await page.locator('form').first().waitFor();
    await contrast(page, locale, 'login');

    // Receiver: inbox → wizard (demo invoice) → review → adjust.
    await login(page, 'receiver@kfar-hazeitim.test');
    await page.goto(`${BASE}/dashboard/receiving`);
    const links = page.locator('a[href^="/dashboard/receiving/"]');
    await links.first().waitFor({ timeout: 30_000 });
    await contrast(page, locale, 'inbox');
    const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`${BASE}${hrefs[i % hrefs.length]}`);
    await page.getByRole('button', { name: label(locale, 'steps.scan.useDemo') }).waitFor({ timeout: 30_000 });
    await contrast(page, locale, 'scan');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.getByRole('button', { name: label(locale, 'steps.scan.useDemo') }).click();
    await page.getByRole('button', { name: label(locale, 'steps.scan.process') }).click();
    await page.getByTestId('continue-adjust').waitFor({ timeout: 60_000 });
    await contrast(page, locale, 'review');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.getByTestId('continue-adjust').click();
    await page.getByTestId('close-receipt').waitFor({ timeout: 30_000 });
    // Open one line so its action row (asOrdered / missing / damaged) is measured too.
    await page.locator('button', { hasText: label(locale, 'steps.adjust.asOrdered') }).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await contrast(page, locale, 'adjust');
    await ctx.clearCookies();

    // Owner: the assistant, empty and answered (offline, no key).
    await ctx.addCookies([
      { name: 'rm_locale', value: locale, url: BASE },
      { name: 'rm_cookie_consent', value: 'necessary', url: BASE },
    ]);
    await page.setViewportSize({ width: 1366, height: 900 });
    await login(page, 'owner@kfar-hazeitim.test');
    await page.goto(`${BASE}/dashboard/ask`);
    await page.getByTestId('ask-page').waitFor({ timeout: 30_000 });
    await contrast(page, locale, 'ask-empty');
    await page.setViewportSize({ width: 1366, height: 900 });
    for (const k of ['leakTotal', 'claimWeek']) {
      await page.click(`[data-testid="ask-suggestion-${k}"]`);
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="ask-answer"]').length >= n && !document.querySelector('[data-testid="ask-answer"] .animate-spin'),
        k === 'leakTotal' ? 1 : 2,
        { timeout: 30_000 },
      );
    }
    await contrast(page, locale, 'ask-answers');
    await ctx.close();
  }
  await browser.close();
  const total = rows.reduce((s, r) => s + r.violations, 0);
  console.log(`\naxe color-contrast: ${total} violations across ${rows.length} screen×locale×width checks`);
  console.log(`console errors / 5xx: ${errors.length}${errors.length ? ` ${JSON.stringify(errors.slice(0, 4))}` : ''}`);
  if (total || errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
