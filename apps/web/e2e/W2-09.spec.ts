import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { OWNER_STATE } from './env';
import { collectPageErrors } from './helpers';
import { explorerQuery, seededLeakMonth } from './seededMonth';

/**
 * W2-09 · every leak ₪ explains itself and opens its rows, on the seeded demo:
 *  - the drill contract: every [data-drill] on the leak routes lands on a page whose
 *    header shows the same ₪, to the agora;
 *  - the old period grammar answers a 308 to `p` / `from` / `to`, keeping the other params;
 *  - the breakdown's two decision-19 groups add up to the total, and the CTA follows the
 *    invoice state (unpaid → approvals?inv=, paid → claims?sup=);
 *  - every line shows its basis (one why-line), never "חויב";
 *  - in Hebrew the ₪ sits left of the first digit; no sideways scroll at 390; axe clean.
 * Amounts come from the seed (dated relative to today), so the spec checks invariants,
 * not the lab's ₪759.54.
 */
test.use({ storageState: OWNER_STATE });
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL! }]);
});

const agora = (n: number) => Math.round(n * 100);
const LEAK_ROUTES = ['/dashboard/leaks', '/dashboard/leaks/breakdown', '/dashboard/leaks/report'];

async function viewQuery(page: Page): Promise<string> {
  return explorerQuery(await seededLeakMonth(page.request, { mix: true }));
}

test('the drill contract: every door on the leak routes lands on the same ₪', async ({ page }) => {
  const q = await viewQuery(page);
  const doors: { from: string; href: string; total: number }[] = [];
  for (const route of LEAK_ROUTES) {
    await page.goto(`${route}${q}`);
    const found = await page.locator('a[data-drill]').evaluateAll((els) =>
      els.map((e) => ({ href: (e as HTMLAnchorElement).getAttribute('href') ?? '', total: Number(e.getAttribute('data-drill-total')) })),
    );
    for (const d of found) doors.push({ from: route, ...d });
  }
  expect(doors.length, 'at least the explorer leak tile is a door').toBeGreaterThan(0);
  for (const d of doors) {
    expect(Number.isSafeInteger(d.total), `${d.from} → ${d.href}: integer agorot`).toBe(true);
    if (d.href.startsWith('#')) {
      // In-page doors (heatmap → its table row): the row carries the same ₪.
      await page.goto(`${d.from}${q}`);
      const row = page.locator(d.href);
      await expect(row).toHaveCount(1);
      expect(agora(Number(await row.getAttribute('data-amount'))), `${d.from} ${d.href}`).toBe(d.total);
      continue;
    }
    const url = new URL(d.href, 'http://x');
    if (url.pathname !== '/dashboard/leaks/breakdown' || url.searchParams.has('sup')) continue; // driver chips: filtered landings
    await page.goto(d.href);
    const landing = Number(await page.getByTestId('breakdown-total').getAttribute('data-amount'));
    expect(agora(landing), `${d.from} → ${d.href}: the landing echoes the clicked ₪`).toBe(d.total);
  }
});

test('the old period grammar answers a 308 to p / from / to, keeping other params', async ({ page }) => {
  const r1 = await page.request.get('/dashboard/leaks/breakdown?m=-1&d=compact', { maxRedirects: 0 });
  expect(r1.status()).toBe(308);
  const l1 = new URL(r1.headers()['location']!, 'http://x');
  expect([l1.pathname, l1.searchParams.get('p'), l1.searchParams.get('d'), l1.searchParams.has('m')]).toEqual([
    '/dashboard/leaks/breakdown',
    'last_month',
    'compact',
    false,
  ]);

  const r2 = await page.request.get('/dashboard/leaks/report?month=2026-02', { maxRedirects: 0 });
  expect(r2.status()).toBe(308);
  const l2 = new URL(r2.headers()['location']!, 'http://x');
  expect([l2.searchParams.get('p'), l2.searchParams.get('from'), l2.searchParams.get('to')]).toEqual(['custom', '2026-02-01', '2026-02-28']);

  const r3 = await page.request.get('/dashboard/leaks/proof?m=0', { maxRedirects: 0 });
  expect(r3.status()).toBe(308);
  // The new grammar renders without a redirect.
  const ok = await page.request.get('/dashboard/leaks/breakdown?p=last_month', { maxRedirects: 0 });
  expect(ok.status()).toBe(200);
});

test('breakdown: the two groups sum to the total and each CTA follows the invoice state', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/leaks/breakdown${await viewQuery(page)}`);
  const total = Number(await page.getByTestId('breakdown-total').getAttribute('data-amount'));
  const groups = await page
    .locator('[data-testid^="breakdown-group-"]')
    .evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid'), amount: Number(e.getAttribute('data-amount')) })));
  expect(groups.length).toBeGreaterThan(0);
  const rowsTotal = Number(await page.getByTestId('breakdown-rows-total').getAttribute('data-amount'));
  expect(groups.reduce((s, g) => s + agora(g.amount), 0)).toBe(agora(rowsTotal));
  expect(agora(rowsTotal)).toBeLessThanOrEqual(agora(total));

  const unpaid = page.getByTestId('breakdown-group-unpaid');
  if (await unpaid.count()) {
    for (const href of await unpaid.getByTestId('breakdown-cta-decide').evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
      expect(href).toMatch(/^\/dashboard\/approvals\?inv=[0-9a-f-]{36}$/);
    }
    await expect(unpaid.getByTestId('breakdown-cta-claim')).toHaveCount(0); // decision 19: one channel per state
  }
  const paid = page.getByTestId('breakdown-group-paid');
  if (await paid.count()) {
    for (const href of await paid.getByTestId('breakdown-cta-claim').evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
      expect(href).toMatch(/^\/dashboard\/leaks\/claims\?sup=[0-9a-f-]{36}$/);
    }
    await expect(paid.getByTestId('breakdown-cta-decide')).toHaveCount(0);
  }
  // Every money line explains itself in one line — and never with "חויב".
  const why = page.getByTestId('why-line');
  expect(await why.count()).toBeGreaterThan(0);
  for (const text of await why.allInnerTexts()) expect(text).not.toMatch(/חויב/);
  expect(errors).toEqual([]);
});

test('he: the ₪ sits left of the first digit (bbox), and nothing scrolls sideways at 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const q = await viewQuery(page);
  for (const route of LEAK_ROUTES) {
    await page.goto(`${route}${q}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route}: horizontal overflow at 390`).toBeLessThanOrEqual(0);
  }
  await page.goto(`/dashboard/leaks/breakdown${q}`);
  const total = page.getByTestId('breakdown-total').locator('bdi').first();
  const sides = await total.evaluate((el) => {
    const text = el.textContent ?? '';
    const range = document.createRange();
    const node = el.firstChild!;
    const at = (i: number) => {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      return range.getBoundingClientRect().left;
    };
    return { shekel: at(text.indexOf('₪')), digit: at(text.search(/\d/)) };
  });
  expect(sides.shekel, '₪ is left of the first digit').toBeLessThan(sides.digit);
});

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

test('axe: no critical or serious WCAG 2.2 AA violations on the leak routes (he, en)', async ({ page, context, baseURL }) => {
  const q = await viewQuery(page);
  for (const lang of ['he', 'en'] as const) {
    await context.addCookies([{ name: 'rm_locale', value: lang, url: baseURL! }]);
    for (const route of [...LEAK_ROUTES, '/dashboard/leaks/proof']) {
      await page.goto(`${route}${q}`);
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.addScriptTag({ content: AXE_SOURCE });
      const bad = await page.evaluate(async () => {
        const w = window as unknown as {
          axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
        };
        const res = await w.axe.run(
          { exclude: [['nextjs-portal'], ['[data-worker-banner]']] },
          { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } },
        );
        return res.violations
          .filter((v) => v.impact === 'critical' || v.impact === 'serious')
          .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
      });
      expect(bad, `${lang} ${route}`).toEqual([]);
    }
  }
});
