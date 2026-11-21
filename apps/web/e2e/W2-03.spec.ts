import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * W2-03 · the pay run as a due-date desk (docs/ux/wave2/W2-03.md §6). Seeded demo tenant
 * ("כפר הזיתים", all flags on). The seed is relative to its run date, so this spec asserts
 * structure and relationships (buckets, Σ selected = BatchBar, held-row copy, roles, axe),
 * not lab-day ₪ values. Mark-paid stays behind PAY_RUN_MARK_PAID (off) — asserted absent.
 */

type Role = 'owner' | 'manager' | 'bookkeeper' | 'chef' | 'receiver';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 } };
const PATH = '/dashboard/approvals/pay-run';
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
const states = new Map<Role, StorageState>();

async function stateFor(browser: Browser, baseURL: string, role: Role): Promise<StorageState> {
  if (!states.has(role)) {
    const ctx = await browser.newContext({ baseURL });
    await ctx.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL }]);
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.locator('form:has(#password) [name=email]').fill(`${role}@kfar-hazeitim.test`);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('form:has(#password) button[type=submit]').click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    states.set(role, await ctx.storageState());
    await ctx.close();
  }
  return states.get(role)!;
}

async function open(browser: Browser, baseURL: string, role: Role, locale: 'he' | 'en', device: typeof PHONE | typeof DESK) {
  const ctx = await browser.newContext({ ...device, baseURL, storageState: await stateFor(browser, baseURL, role) });
  await ctx.addCookies([
    { name: 'rm_locale', value: locale, url: baseURL },
    { name: 'rm_cookie_consent', value: 'necessary', url: baseURL },
  ]);
  const page = await ctx.newPage();
  const res = await page.goto(PATH);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  return { page, status: res?.status() ?? 0 };
}

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal'], ['#main-content [role=status]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}

/** The (last) 2-dp ₪ amount in a text, e.g. "נבחרו 2 · ₪1,234.56" → 123456 agorot. */
function agorotOf(text: string): number {
  const all = text.match(/\d{1,3}(?:,\d{3})*\.\d{2}/g) ?? [];
  return Math.round(Number((all[all.length - 1] ?? 'NaN').replace(/,/g, '')) * 100);
}

test.describe.configure({ mode: 'serial' });

test('desktop he (bookkeeper): due buckets, ordered by due date, held rows explain themselves', async ({ browser, baseURL }) => {
  const { page, status } = await open(browser, baseURL!, 'bookkeeper', 'he', DESK);
  expect(status).toBe(200);
  const buckets = page.locator('[data-testid^="payrun-bucket-"]');
  await expect(buckets.first()).toBeVisible();
  // Bucket order is fixed: overdue → this week → next week → later → no due date.
  const order = ['overdue', 'this_week', 'next_week', 'later', 'unknown'];
  const ids = await buckets.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('payrun-bucket-', '')));
  expect(ids).toEqual(order.filter((b) => ids.includes(b)));
  // A held row says why, as text (never only a colour).
  const held = page.locator('[data-testid="payrun-invoice"][data-status="hold"]').first();
  if (await held.count()) {
    await expect(held.getByTestId('payrun-status')).toContainText(/ממתין|ממתינה|חסר|עותק|לבדיקה|מחכה|אפשר שחויב/);
    // Held rows can't be selected.
    await expect(held.getByTestId('payrun-select')).toHaveCount(0);
  }
  // The credit is a sentence, never a ₪0 tile; tiles use MetricTile (no font-mono money).
  await expect(page.getByTestId('payrun-credit')).toBeVisible();
  expect(await page.locator('[data-testid="payrun-kpis"] .font-mono').count()).toBe(0);
  // Mark-paid stays behind the server flag (off).
  await expect(page.getByRole('button', { name: 'סמנו כשולם…' })).toHaveCount(0);
  expect(await axeSerious(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.context().close();
});

test('select payable rows → BatchBar Σ equals the selected rows, Esc clears', async ({ browser, baseURL }) => {
  const { page } = await open(browser, baseURL!, 'owner', 'he', DESK);
  const boxes = page.getByTestId('payrun-select');
  const n = Math.min(await boxes.count(), 2);
  test.skip(n === 0, 'no payable row in this seed run');
  let expected = 0;
  for (let i = 0; i < n; i++) {
    const row = page.locator('[data-testid="payrun-invoice"][data-status="pay"]').filter({ has: page.getByTestId('payrun-select') }).nth(i);
    await row.getByTestId('payrun-select').check();
    expected += agorotOf((await row.locator('td').nth(5).innerText()).trim());
  }
  const bar = page.locator('[data-batchbar]');
  await expect(bar).toBeVisible();
  expect(agorotOf(await bar.innerText())).toBe(expected);
  // Esc from inside the bar (focus its last control) clears the selection.
  await bar.getByRole('button').last().focus();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await page.context().close();
});

test('a decision hold links to "החליטו" for a role that can decide', async ({ browser, baseURL }) => {
  const { page } = await open(browser, baseURL!, 'owner', 'he', DESK);
  const decide = page.getByRole('link', { name: 'החליטו' }).first();
  test.skip((await decide.count()) === 0, 'no decision hold in this seed run');
  await expect(decide).toHaveAttribute('href', /\/dashboard\/approvals\?invoice=[0-9a-f-]{36}$/);
  await page.context().close();
});

test('phone he: one summary line, held rows first, no overflow, axe', async ({ browser, baseURL }) => {
  const { page } = await open(browser, baseURL!, 'bookkeeper', 'he', PHONE);
  await expect(page.getByTestId('payrun-summary')).toContainText('ניתן לשלם');
  const statuses = await page.locator('[data-testid="payrun-phone"] [data-testid="payrun-invoice"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-status')),
  );
  const firstPay = statuses.indexOf('pay');
  if (firstPay >= 0) expect(statuses.slice(firstPay)).not.toContain('hold');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(await axeSerious(page)).toEqual([]);
  await page.context().close();
});

test('en desktop renders with English copy and axe-clean', async ({ browser, baseURL }) => {
  const { page, status } = await open(browser, baseURL!, 'owner', 'en', DESK);
  expect(status).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay run');
  expect(await axeSerious(page)).toEqual([]);
  await page.context().close();
});

test('he: the ₪ glyph renders left of the digits in a total cell (RTL money order)', async ({ browser, baseURL }) => {
  const { page } = await open(browser, baseURL!, 'owner', 'he', DESK);
  const cell = page.locator('[data-testid="payrun-invoice"] td').nth(5);
  test.skip((await cell.count()) === 0, 'no rows in this seed run');
  const pos = await cell.evaluate((td) => {
    const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let glyph: DOMRect | null = null;
    let digit: DOMRect | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = n.textContent ?? '';
      for (let i = 0; i < s.length; i++) {
        if (!glyph && s[i] === '₪') {
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          glyph = range.getBoundingClientRect();
        }
        if (!digit && /\d/.test(s[i]!)) {
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          digit = range.getBoundingClientRect();
        }
      }
    }
    return glyph && digit ? { glyph: glyph.left, digit: digit.left } : null;
  });
  expect(pos).not.toBeNull();
  expect(pos!.glyph).toBeLessThan(pos!.digit);
  await page.context().close();
});

for (const role of ['receiver', 'chef'] as const) {
  test(`${role}: the pay run is forbidden (403) and shows no ₪`, async ({ browser, baseURL }) => {
    const { page, status } = await open(browser, baseURL!, role, 'he', DESK);
    expect(status).toBe(403);
    await expect(page.locator('[data-testid="payrun-invoice"]')).toHaveCount(0);
    await page.context().close();
  });
}
