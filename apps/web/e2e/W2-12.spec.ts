import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { he } from '../lib/i18n/messages/contracts/he';
import { en } from '../lib/i18n/messages/contracts/en';
import { E2E_DATABASE_URL } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * W2-12 · Contracts and price intelligence: one ₪ queue.
 *
 *   - "לטיפול" is the default tab; the header ₪ = Σ of the billed over-contract
 *     cards (₪152.50 on the demo: entrecôte ₪100.00 + salmon ₪52.50), alerts are
 *     never added; the math line and the money-named primary;
 *   - legacy ?tab= keys still render; chef/receiver get a 404;
 *   - update contract price + undo; dismiss an alert + undo; the threshold
 *     preview; the import diff with a per-row exclude;
 *   - money and bidi: ₪ sits left of its digits in he, no font-mono / dir=ltr
 *     on money; axe 0 serious; no horizontal scroll at 390.
 *
 * Data: the e2e DB has seed + seed-demo; this spec adds the contracts demo
 * (seed-wave1-contracts-demo.ts — additive, idempotent, leak total unchanged).
 */

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;
const DESK = { viewport: { width: 1440, height: 900 } } as const;
const OWNER = 'owner@kfar-hazeitim.test';
const MANAGER = 'manager@kfar-hazeitim.test';
const BOOKKEEPER = 'bookkeeper@kfar-hazeitim.test';
const SHOTS = path.join(__dirname, '__screenshots__', 'W2-12');

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  execFileSync('pnpm', ['--filter', '@restomatch/worker', 'exec', 'tsx', 'scripts/seed-wave1-contracts-demo.ts'], {
    cwd: path.join(__dirname, '..', '..', '..'),
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'pipe',
  });
});

async function as(page: Page, email: string, locale: 'he' | 'en', to = '/dashboard/contracts') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  await loginViaMagicLink(page, email, to);
  await page.goto(to, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: Document, o: object) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> };
    };
    const r = await w.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      exclude: [['[data-worker-banner]']],
    });
    return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id);
  });
}

/** Every ₪ figure in `scope`: the glyph's box is left of the first digit's box (he). */
async function shekelLeftOfDigits(page: Page, scope: string): Promise<{ checked: number; bad: string[] }> {
  return page.evaluate((sel) => {
    const bad: string[] = [];
    let checked = 0;
    const root = document.querySelector(sel);
    if (!root) return { checked, bad: ['no scope'] };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      const glyph = text.indexOf('₪');
      const digit = text.search(/\d/);
      if (glyph < 0 || digit < 0) continue;
      const range = document.createRange();
      range.setStart(n, glyph);
      range.setEnd(n, glyph + 1);
      const g = range.getBoundingClientRect();
      range.setStart(n, digit);
      range.setEnd(n, digit + 1);
      const d = range.getBoundingClientRect();
      if (g.width === 0 || d.width === 0) continue;
      checked += 1;
      if (!(g.right <= d.left + 0.5)) bad.push(text.trim());
    }
    return { checked, bad };
  }, scope);
}

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'horizontal overflow (px)').toBeLessThanOrEqual(1);
}

test.describe('W2-12 queue (owner, he 1440)', () => {
  test.use(DESK);

  test('header ₪152.50 = Σ billed cards; math line; unpaid primary; legacy tabs; money/bidi; axe', async ({ page }) => {
    await as(page, OWNER, 'he');
    await expect(page.getByRole('link', { name: he.tabs.queue })).toHaveAttribute('aria-current', 'page');
    const header = page.getByTestId('queue-header');
    await expect(header).toContainText('152.50');
    await expect(header).toContainText(he.queue.billed);
    await expect(header).toContainText('2 שורות');
    await expect(header).toContainText('התראת מחיר אחת');

    const cards = page.getByTestId('over-card');
    await expect(cards).toHaveCount(2);
    const sum = (await cards.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-over-agorot'))))).reduce((a, b) => a + b, 0);
    expect(sum).toBe(15_250);
    // Ranked by ₪: entrecôte ₪100.00 first; its math line and money-named primary (unpaid → offset).
    const first = cards.first();
    await expect(first).toContainText('אנטריקוט');
    await expect(first.getByTestId('over-math')).toContainText('149.00');
    await expect(first.getByTestId('over-math')).toContainText('139.00');
    await expect(first.getByTestId('over-math')).toContainText('10.00');
    await expect(first.getByTestId('over-math')).toContainText('100.00');
    const primary = first.getByTestId('over-primary');
    await expect(primary).toContainText(he.queue.over.offset);
    await expect(primary).toHaveAttribute('href', /\/dashboard\/approvals\?invoice=/);
    // The alert: "מחירים שעלו", never "דליפה"; ≈₪/month estimate.
    const alert = page.getByTestId('alert-card');
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText(he.queue.alert.kicker);
    await expect(alert).not.toContainText('דליפה');
    await expect(alert).toContainText(he.queue.alert.monthly);
    await expect(page.locator('main')).not.toContainText('1.5%');

    // Money and bidi.
    expect(await page.locator('main .font-mono').count()).toBe(0);
    expect(await page.locator('main [dir="ltr"]').count()).toBe(0);
    const bidi = await shekelLeftOfDigits(page, 'main');
    expect(bidi.checked).toBeGreaterThan(5);
    expect(bidi.bad).toEqual([]);
    expect(await axeSerious(page)).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'queue__owner__1440-he.png'), fullPage: true });

    for (const tab of ['contracts', 'alerts', 'thresholds'] as const) {
      const res = await page.goto(`/dashboard/contracts?tab=${tab}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole('link', { name: he.tabs[tab] })).toHaveAttribute('aria-current', 'page');
    }
  });
});

test.describe('W2-12 queue (en 1440, bookkeeper reads)', () => {
  test.use(DESK);
  test('en header and cards; bookkeeper sees no write actions; axe', async ({ page }) => {
    await as(page, BOOKKEEPER, 'en');
    const header = page.getByTestId('queue-header');
    await expect(header).toContainText('152.50');
    await expect(header).toContainText(en.queue.billed);
    await expect(page.getByTestId('over-card')).toHaveCount(2);
    await expect(page.getByTestId('over-primary')).toHaveCount(0);
    await expect(page.getByTestId('alert-dismiss')).toHaveCount(0);
    expect(await axeSerious(page)).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'queue__bookkeeper__1440-en.png'), fullPage: true });
  });
});

test.describe('W2-12 queue (manager, he 390)', () => {
  test.use(PHONE);
  test('no horizontal scroll; ₪ left of digits; adopt price + undo; dismiss + undo', async ({ page }) => {
    const sql = e2eSql();
    try {
      const before = await sql`select count(*)::int n from supplier_contract_prices`;
      await as(page, MANAGER, 'he');
      await noHorizontalScroll(page);
      expect((await shekelLeftOfDigits(page, 'main')).bad).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, 'queue__manager__390-he.png'), fullPage: true });

      // ⋯ → "עדכנו מחיר חוזה ל-₪149.00" → a row from today → undo removes it.
      const first = page.getByTestId('over-card').first();
      await first.getByRole('button', { name: he.queue.over.more }).click();
      await page.getByRole('menuitem', { name: /149\.00/ }).click();
      await expect(page.getByText(he.queue.over.adopted)).toBeVisible();
      await expect.poll(async () => (await sql`select count(*)::int n from supplier_contract_prices`)[0]!.n).toBe(before[0]!.n + 1);
      const [row] = await sql`select valid_from::text d from supplier_contract_prices order by created_at desc limit 1`;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
      expect(row!.d).toBe(today);
      await page.getByRole('button', { name: he.queue.over.undo }).click();
      await expect.poll(async () => (await sql`select count(*)::int n from supplier_contract_prices`)[0]!.n).toBe(before[0]!.n);

      // Dismiss the alert → undo reopens it.
      await page.getByTestId('alert-dismiss').click();
      await expect(page.getByText(he.queue.alert.dismissed)).toBeVisible();
      await expect.poll(async () => (await sql`select status from price_alerts limit 1`)[0]!.status).toBe('dismissed');
      await page.getByRole('button', { name: he.queue.alert.undo }).click();
      await expect.poll(async () => (await sql`select status from price_alerts limit 1`)[0]!.status).toBe('open');
      expect(await axeSerious(page)).toEqual([]);
    } finally {
      await sql.end();
    }
  });
});

test.describe('W2-12 thresholds and import (manager, he 1440)', () => {
  test.use(DESK);
  test('threshold preview counts without writing', async ({ page }) => {
    const sql = e2eSql();
    try {
      await as(page, MANAGER, 'he', '/dashboard/contracts?tab=thresholds');
      await expect(page.getByTestId('t2-floor')).toContainText('50');
      await page.locator('#th-pct').fill('10');
      await page.locator('#th-window').fill('21');
      await expect(page.getByTestId('threshold-preview')).toContainText('ב-90 הימים האחרונים');
      expect((await sql`select count(*)::int n from price_alert_thresholds`)[0]!.n).toBe(0);
      await page.screenshot({ path: path.join(SHOTS, 'thresholds__manager__1440-he.png'), fullPage: true });
    } finally {
      await sql.end();
    }
  });

  test('import diff with a per-row exclude; the commit names its effect', async ({ page }) => {
    const sql = e2eSql();
    try {
      const [sup] = await sql`select s.id from suppliers s join supplier_contract_prices c on c.supplier_id = s.id limit 1`;
      const [prod] = await sql`select p.canonical_name name from supplier_contract_prices c join products p on p.id = c.product_id where c.supplier_id = ${sup!.id} limit 1`;
      await as(page, MANAGER, 'he', `/dashboard/contracts/import?supplierId=${sup!.id}`);
      const csv = `תיאור,מחיר חוזה\n${prod!.name},"1,250"\nפריט שאינו קיים,5\n`;
      await page.locator('input[type="file"]').setInputFiles({ name: 'p.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await page.getByRole('button', { name: he.import.analyze }).click();
      await page.getByRole('button', { name: he.import.review }).click();
      const diff = page.getByTestId('import-diff');
      await expect(diff.locator('[data-chip="up"]')).toHaveCount(1);
      await expect(diff.locator('[data-chip="unmatched"]')).toHaveCount(1);
      await expect(diff).toContainText('1,250.00');
      await expect(page.getByTestId('import-commit')).toContainText('עדכנו מחיר אחד');
      const before = (await sql`select count(*)::int n from supplier_contract_prices`)[0]!.n;
      await diff.getByRole('checkbox').first().uncheck();
      await expect(page.getByTestId('import-commit')).toBeDisabled();
      expect((await sql`select count(*)::int n from supplier_contract_prices`)[0]!.n).toBe(before);
      await page.screenshot({ path: path.join(SHOTS, 'import__manager__1440-he.png'), fullPage: true });
    } finally {
      await sql.end();
    }
  });
});

test.describe('W2-12 roles: chef and receiver → 404', () => {
  for (const email of ['chef@kfar-hazeitim.test', 'receiver@kfar-hazeitim.test']) {
    test(email, async ({ page }) => {
      await loginViaMagicLink(page, email, '/dashboard');
      const res = await page.goto('/dashboard/contracts?tab=queue');
      // The middleware may redirect to /dashboard/forbidden; either way, no contracts page.
      expect([200, 404]).toContain(res?.status() ?? 0);
      await expect(page.getByTestId('queue-header')).toHaveCount(0);
      expect(await page.locator('main').innerText()).not.toContain('152.50');
    });
  }
});
