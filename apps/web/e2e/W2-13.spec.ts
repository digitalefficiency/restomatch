import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { interpolate } from '../lib/i18n/translate';
import { OWNER_STATE } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * W2-13 copy system: the activity feed (owner: in the bell panel since W2-08 I1 moved
 * "מה קרה" off the home) renders from v2 metadata (grouped per invoice,
 * linked, relative time, he + en), the receiver home shows no ₪, and the bidi isolation
 * keeps a Latin supplier name contiguous in a Hebrew sentence (Lab I).
 */
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** The owner reuses the session auth.setup saved (one magic link per run: the link is rate-limited). */
async function asRole(browser: Browser, email: string, opts: Parameters<Browser['newContext']>[0], baseURL: string) {
  const owner = email === 'owner@kfar-hazeitim.test';
  const context = await browser.newContext({ ...opts, baseURL, ...(owner ? { storageState: OWNER_STATE } : {}) });
  await context.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL }]);
  const page = await context.newPage();
  if (!owner) await loginViaMagicLink(page, email);
  return { context, page };
}

/** The owner's activity feed lives in the bell panel (W2-08 I1). Opens it and returns the feed section. */
async function openFeed(page: Page) {
  await page.getByTestId('bell-trigger').click();
  const feed = page.getByTestId('bell-activity');
  await expect(feed).toBeVisible();
  return feed;
}

async function axeSerious(page: Page, selector: string) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async (sel) => {
    const w = window as unknown as {
      axe: { run: (d: Element, o: object) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> };
    };
    const r = await w.axe.run(document.querySelector(sel)!, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    });
    return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.nodes.length})`);
  }, selector);
}

test.describe('owner activity feed, bell panel (W2-13)', () => {
  for (const [label, opts] of [
    ['he 1440', DESKTOP],
    ['he 390', PHONE],
  ] as const) {
    test(`grouped, linked, relative time, glossary words — ${label}`, async ({ browser, baseURL }) => {
      const { context, page } = await asRole(browser, 'owner@kfar-hazeitim.test', opts, baseURL!);
      try {
        await page.goto('/dashboard');
        const feed = await openFeed(page);
        const rows = feed.locator('li');
        await expect(rows.first()).toBeVisible();
        const n = await rows.count();
        const titles: string[] = [];
        for (let i = 0; i < n; i += 1) {
          const row = rows.nth(i);
          const link = row.getByRole('link');
          if ((await link.count()) > 0) {
            await expect(link).toHaveAttribute('href', /^\/dashboard\/invoices\/[0-9a-f-]{36}$/);
            titles.push((await link.innerText()).replace(/[⁦-⁩]/g, ''));
          }
          const time = row.locator('time');
          await expect(time).not.toHaveClass(/font-mono/);
          await expect(time).toHaveAttribute('title', /\d/);
        }
        expect(titles.length).toBeGreaterThan(0);
        // One row per invoice: no invoice number appears twice.
        const numbers = titles.map((t) => /\S*\d\S*/.exec(t)?.[0]).filter(Boolean);
        expect(new Set(numbers).size).toBe(numbers.length);
        const text = await feed.innerText();
        expect(text).not.toMatch(/חריג|הפסד|חיסכון|ריכוז/);
        expect(await axeSerious(page, '[data-testid="bell-activity"]')).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test('English renders the feed from metadata (no stored Hebrew sentences) — en 1440', async ({ browser, baseURL }) => {
    const { context, page } = await asRole(browser, 'owner@kfar-hazeitim.test', DESKTOP, baseURL!);
    try {
      await page.goto('/dashboard?lang=en');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      const feed = await openFeed(page);
      const links = feed.getByRole('link');
      await expect(links.first()).toBeVisible();
      const rows = await links.evaluateAll((els) =>
        els.map((a) => ({ title: (a as HTMLElement).innerText.replace(/[⁦-⁩]/g, ''), href: a.getAttribute('href') ?? '' })),
      );
      const NUMBERED = /^(Consolidated invoice|Invoice) \S+ (matched|received)$/;
      // An invoice whose events carry no number (an OCR-failed photo, e.g. invoice-manual-lines earlier in the
      // run) reads as the plain English type label: still rendered from metadata, never a stored sentence.
      const NUMBERLESS = /^(Invoice (matched|received)|Consolidated invoice received)$/;
      const sql = e2eSql();
      try {
        for (const { title, href } of rows) {
          if (NUMBERED.test(title)) continue;
          expect(title, `feed row "${title}" is neither "Invoice <number> …" nor the numberless label`).toMatch(NUMBERLESS);
          // …and only when the metadata really has no number to show.
          const id = href.split('/').pop() ?? '';
          const [r] = await sql<{ n: number }[]>`
            select count(*)::int as n from activity_events
            where event_type in ('invoice_received', 'invoice_matched')
              and (metadata ->> 'invoiceId' = ${id} or (entity_type = 'invoice' and entity_id::text = ${id}))
              and coalesce(metadata ->> 'invoiceNumber', '') <> ''`;
          expect(r!.n, `"${title}" (${href}) dropped an invoice number its metadata carries`).toBe(0);
        }
      } finally {
        await sql.end();
      }
      // The seeded invoices carry numbers: the numbered metadata path is what renders most of the feed.
      expect(rows.filter((r) => NUMBERED.test(r.title)).length).toBeGreaterThan(0);
      expect(await feed.innerText()).not.toMatch(/הותאמה|התקבלה|חריג|הפסד/);
      expect(await axeSerious(page, '[data-testid="bell-activity"]')).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test('receiver home: no ₪ text anywhere (owner decision)', async ({ browser, baseURL }) => {
  const { context, page } = await asRole(browser, 'receiver@kfar-hazeitim.test', PHONE, baseURL!);
  try {
    await page.goto('/dashboard');
    await expect(page.locator('main')).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(/₪/);
  } finally {
    await context.close();
  }
});

test('Lab I: a Latin supplier stays contiguous with its period in a Hebrew sentence (bbox order)', async ({ page }) => {
  const sentence = interpolate('בהזמנה מ-{supplier} הפריט לא הגיע.', { supplier: 'Coca-Cola Ltd.' });
  await page.setContent(`<!doctype html><html dir="rtl" lang="he"><body style="font-size:20px"><p id="s"></p></body></html>`);
  await page.evaluate((s) => {
    document.getElementById('s')!.textContent = s;
  }, sentence);
  const order = await page.evaluate(() => {
    const node = document.getElementById('s')!.firstChild as Text;
    const text = node.data;
    const rectOf = (needle: string, offset = 0) => {
      const i = text.indexOf(needle) + offset;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      return r.getBoundingClientRect();
    };
    const dot = rectOf('Ltd.', 3); // the period that belongs to "Ltd."
    const d = rectOf('Ltd.', 2);
    const c = rectOf('Coca');
    return { dotLeft: dot.left, dRight: d.right, cLeft: c.left };
  });
  // LTR run inside the isolate: C … d . from left to right, with the period right after "d".
  expect(order.cLeft).toBeLessThan(order.dRight);
  expect(Math.abs(order.dotLeft - order.dRight)).toBeLessThan(2);
});
