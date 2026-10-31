import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { he as ovHe } from '../lib/i18n/messages/overview/he';
import { en as ovEn } from '../lib/i18n/messages/overview/en';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * W1-05 · Role homes ("Today") and the receiving board, with an honest leak hero.
 *
 *  - /dashboard renders by role: the receiver gets the board, the chef the
 *    kitchen — no leak hero, no restaurant spend, no view toolbar for either.
 *  - Owner: "מחכה לך" in ₪ + a compact hero; the layout gates at 375×667 and
 *    1440×900; each Needs-you row lands on a list showing the same ₪.
 *  - A card that fails shows "לא נטען · נסו שוב" while the hero still renders.
 *  - The board: closed receipts read "התקבל ✓" and open read-only; an open one
 *    is neutral; a past-dated open PO is late.
 */

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const BIDI = /[‎‏‪-‮⁦-⁩]/g;
const amount = (text: string) => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(text.replace(BIDI, ' '));
  if (!m) throw new Error(`no number in ${JSON.stringify(text)}`);
  return Number(m[0].replace(/,/g, ''));
};
const PHONE_SMALL = { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

let restaurantId = '';

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) throw new Error('no demo restaurant');
    restaurantId = r.id;
    // The lab worker banner would sit above the fold: mock a healthy worker.
    await sql`insert into worker_heartbeats (worker_id, host, pid, workers, started_at, beat_at)
              values ('e2e-w1-05', 'e2e', 1, 1, now(), now() + interval '1 day')
              on conflict (worker_id) do update set beat_at = now() + interval '1 day'`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await sql`delete from worker_heartbeats where worker_id = 'e2e-w1-05'`;
  } finally {
    await sql.end();
  }
});

async function consent(page: Page, base: string) {
  await page.context().addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: base }]);
}

async function asRole(browser: Browser, email: string, opts: Parameters<Browser['newContext']>[0], baseURL: string) {
  const context = await browser.newContext({ ...opts, baseURL });
  const page = await context.newPage();
  await consent(page, baseURL);
  await loginViaMagicLink(page, email);
  return { context, page };
}

async function axeSerious(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.nodes.length})`);
  });
}

function messagesOf(lang: string | null) {
  return lang === 'en' ? ovEn : ovHe;
}

test.describe('staff homes: no owner money', () => {
  test('receiver lands on the receiving board — next truck CTA ≥56 px, no hero, no spend, no toolbar', async ({ browser, baseURL }) => {
    const { context, page } = await asRole(browser, 'receiver@kfar-hazeitim.test', PHONE_SMALL, baseURL!);
    try {
      await page.goto('/dashboard');
      await expect(page.locator('[data-home="receiver"]')).toBeVisible();
      const m = messagesOf(await page.locator('html').getAttribute('lang'));
      await expect(page.locator('main h1')).toHaveText(m.homeTitle.receiver);
      await expect(page.getByTestId('receiving-board')).toBeVisible();
      await expect(page.getByTestId('leak-hero')).toHaveCount(0);
      await expect(page.getByTestId('needs-you')).toHaveCount(0);
      await expect(page.getByTestId('home-view-toggle')).toHaveCount(0);
      // The back door never sees the restaurant's money (the server side — which
      // procedures the home calls — is pinned by staff-homes.server.test.ts).
      await expect(page.locator('main')).not.toContainText('₪');
      await expect(page.getByTestId('home-activity')).toHaveCount(0);
      const cta = page.getByTestId('board-next-cta');
      if (await cta.count()) {
        const box = (await cta.boundingBox())!;
        expect(box.height, 'next-truck CTA height').toBeGreaterThanOrEqual(56);
        expect(box.y + box.height, 'next-truck CTA above the fold at 375×667').toBeLessThanOrEqual(667);
      } else {
        await expect(page.getByTestId('board-empty')).toBeVisible();
      }
      await expect(page.getByTestId('board-no-po')).toBeVisible();
      expect(await axeSerious(page)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('chef lands on the kitchen — count tile and dishes over target, no hero, no spend', async ({ browser, baseURL }) => {
    const { context, page } = await asRole(browser, 'chef@kfar-hazeitim.test', PHONE_SMALL, baseURL!);
    try {
      await page.goto('/dashboard');
      await expect(page.locator('[data-home="chef"]')).toBeVisible();
      await expect(page.getByTestId('chef-count')).toBeVisible();
      await expect(page.getByTestId('chef-dishes')).toBeVisible();
      await expect(page.getByTestId('leak-hero')).toHaveCount(0);
      await expect(page.getByTestId('home-view-toggle')).toHaveCount(0);
      const m = messagesOf(await page.locator('html').getAttribute('lang'));
      await expect(page.locator('main')).not.toContainText(m.hero.leakedLabel);
      // Food-cost % only: no ₪ and no activity feed on the kitchen home.
      await expect(page.locator('main')).not.toContainText('₪');
      await expect(page.getByTestId('home-activity')).toHaveCount(0);
      expect(await axeSerious(page)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe('owner home', () => {
  test.use({ storageState: OWNER_STATE });
  test.beforeEach(async ({ page, baseURL }) => consent(page, baseURL!));

  test('375×667: the hero ₪ and the first Needs-you row are visible without scrolling', async ({ page }) => {
    await page.setViewportSize(PHONE_SMALL.viewport);
    await page.goto('/dashboard');
    const amountBox = (await page.getByTestId('leak-hero-amount').boundingBox())!;
    const firstRow = page.locator('[data-testid="needs-you"] li a, [data-testid="needs-you-zero"]').first();
    await expect(firstRow).toBeVisible();
    const rowBox = (await firstRow.boundingBox())!;
    // Under the fixed bottom nav, not the raw viewport.
    const navTop = await page.evaluate(() => {
      const nav = [...document.querySelectorAll('nav')].find((n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().top > 300);
      return nav ? nav.getBoundingClientRect().top : window.innerHeight;
    });
    expect(amountBox.y + amountBox.height, 'hero ₪ bottom').toBeLessThanOrEqual(navTop);
    expect(rowBox.y + rowBox.height, 'first Needs-you row bottom').toBeLessThanOrEqual(navTop);
    // The view toolbar is behind one chip on the phone, not a filter form above the money.
    await expect(page.getByTestId('home-view-toggle')).toBeVisible();
    await expect(page.locator('#home-view-toolbar')).toBeHidden();

    // The split tiles are real targets on the phone (≥48 px), and the ⓘ note opens inside the viewport.
    for (const id of ['hero-unpaid', 'hero-paid']) {
      const tile = page.getByTestId(id);
      if (await tile.count()) expect((await tile.boundingBox())!.height, `${id} target height`).toBeGreaterThanOrEqual(48);
    }
    const info = page.locator(`[data-testid="leak-hero"] summary[aria-label="${ovHe.hero.howCalc}"]`);
    if (await info.count()) {
      await info.click();
      const note = page.locator('[data-testid="leak-hero"] details[open] > p').first();
      await expect(note).toBeVisible();
      const box = (await note.boundingBox())!;
      expect(box.x, 'ⓘ note left edge').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'ⓘ note right edge').toBeLessThanOrEqual(PHONE_SMALL.viewport.width);
    }
  });

  test('1440×900: strip ≤330 px, compact hero ≤260 px, page ≤1,800 px, trend collapsed, no target line', async ({ page }) => {
    await page.setViewportSize(DESKTOP.viewport);
    await page.goto('/dashboard');
    await expect(page.getByTestId('leak-hero')).toBeVisible();
    // Each card streams on its own: wait for the strip itself before measuring it.
    await expect(page.getByTestId('needs-you')).toBeVisible();
    const strip = (await page.getByTestId('needs-you').boundingBox())!;
    expect(strip.y + strip.height, 'Needs-you strip bottom').toBeLessThanOrEqual(330);
    const hero = (await page.getByTestId('leak-hero').boundingBox())!;
    expect(hero.height, 'hero height').toBeLessThanOrEqual(260);
    await page.waitForLoadState('networkidle');
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height, 'desktop home height').toBeLessThanOrEqual(1800);
    await expect(page.getByTestId('home-trend')).not.toHaveAttribute('open', /.*/);
    // No target line (R-14 default) and no full-month "חודש קודם" caption in the hero.
    await expect(page.getByTestId('leak-hero')).not.toContainText('יעד');
    await expect(page.getByTestId('leak-hero')).not.toContainText('חודש קודם');
    // The delta compares the same day-span ("לעומת 1–25 בספטמבר"), never the whole previous month.
    const delta = page.getByTestId('leak-hero-delta');
    await expect(delta).toBeVisible();
    if ((await delta.getAttribute('data-direction')) !== 'none') await expect(delta).toContainText(/לעומת \d+–\d+ ב/);
    // DoD-4: in Hebrew the ₪ glyph sits left of the first digit.
    const shekelLeft = await page.getByTestId('leak-hero-amount').evaluate((el) => {
      const text = el.textContent ?? '';
      const node = (function find(n: Node): Text | null {
        if (n.nodeType === Node.TEXT_NODE && /₪/.test(n.textContent ?? '')) return n as Text;
        for (const c of n.childNodes) {
          const f = find(c);
          if (f) return f;
        }
        return null;
      })(el);
      if (!node) return { ok: false, text };
      const t = node.textContent!;
      const rect = (i: number) => {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        return r.getBoundingClientRect();
      };
      const sh = rect(t.indexOf('₪'));
      const dg = rect(t.search(/\d/));
      return { ok: sh.right <= dg.left + 1, text };
    });
    expect(shekelLeft.ok, `₪ left of the digits in "${shekelLeft.text}"`).toBe(true);
    expect(await axeSerious(page)).toEqual([]);
  });

  test('undecided money is a T2 Needs-you row (not a gold "נתפס" tile), and 3 rows land on the same ₪', async ({ page }) => {
    await page.setViewportSize(DESKTOP.viewport);
    await page.goto('/dashboard');
    const hero = page.getByTestId('leak-hero');
    await expect(hero).toBeVisible();
    await expect(hero).not.toContainText('נתפס לפני תשלום');
    // The hero's two parts (by payment status) add up to the hero.
    if (await hero.getByTestId('hero-unpaid').count()) {
      const part = async (id: string, label: string) => amount((await hero.getByTestId(id).innerText()).replace(label, ''));
      const sum = (await part('hero-unpaid', ovHe.hero.unpaid)) + (await part('hero-paid', ovHe.hero.paid));
      expect(Math.abs(sum - amount(await hero.getByTestId('leak-hero-amount').innerText())), 'unpaid + paid = hero ₪').toBeLessThanOrEqual(1);
    }
    const rows = page.locator('[data-testid="needs-you"] [data-needs-row] a');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const a of await rows.all()) {
      const box = (await a.boundingBox())!;
      expect(box.height, 'Needs-you row target').toBeGreaterThanOrEqual(48);
    }

    const checked: string[] = [];
    // decide → approvals "סכום בסיכון"
    if (await page.getByTestId('needs-decide').count()) {
      const v = amount(await page.getByTestId('needs-decide-value').innerText());
      await page.getByTestId('needs-decide').click();
      await page.waitForURL(/\/dashboard\/approvals/);
      await expect(page.locator('main')).toContainText('סכום בסיכון');
      const tile = page.locator('main').getByText('סכום בסיכון', { exact: true }).locator('xpath=..');
      expect(amount(await tile.innerText()), 'approvals ₪ at risk vs the Needs-you row').toBe(v);
      checked.push('decide');
      await page.goto('/dashboard');
    }
    // claims → recovery overdue banner
    if (await page.getByTestId('needs-claims').count()) {
      const v = amount(await page.getByTestId('needs-claims-value').innerText());
      await page.getByTestId('needs-claims').click();
      await page.waitForURL(/\/dashboard\/recovery/);
      const text = (await page.locator('main').innerText()).replace(BIDI, ' ');
      expect(text.replace(/[\s,]/g, ''), 'recovery page repeats the overdue ₪').toContain(String(v));
      checked.push('claims');
      await page.goto('/dashboard');
    }
    // VAT → the invoice (or the card) with the same ₪
    if (await page.getByTestId('needs-vat').count()) {
      const v = amount(await page.getByTestId('needs-vat-value').innerText());
      await page.getByTestId('needs-vat').click();
      await page.waitForLoadState('load');
      const text = (await page.locator('main').innerText()).replace(BIDI, ' ');
      expect(text.replace(/[\s,]/g, ''), 'VAT landing repeats the ₪').toContain(String(v));
      checked.push('vat');
      await page.goto('/dashboard');
    }
    // pay run → its "to pay" total
    if (checked.length < 3 && (await page.getByTestId('needs-payRun').count())) {
      const v = amount(await page.getByTestId('needs-payRun-value').innerText());
      await page.getByTestId('needs-payRun').click();
      await page.waitForURL(/pay-run/);
      const text = (await page.locator('main').innerText()).replace(BIDI, ' ');
      expect(text.replace(/[\s,]/g, ''), 'pay run repeats the ₪ to pay').toContain(String(v));
      checked.push('payRun');
    }
    expect(checked.length, `rows checked against their landing: ${checked.join(', ')}`).toBeGreaterThanOrEqual(3);
  });

  test('a card that fails shows "לא נטען · נסו שוב" — never ₪0 — and the hero still renders', async ({ page }) => {
    await page.setViewportSize(DESKTOP.viewport);
    await page.goto('/dashboard?homeFail=vat,activity');
    await expect(page.getByTestId('leak-hero')).toBeVisible();
    for (const name of ['vat', 'activity']) {
      const failed = page.getByTestId(`home-section-failed-${name}`);
      await expect(failed).toBeVisible();
      await expect(failed).toContainText(ovHe.section.failed);
      await expect(failed.getByRole('button', { name: ovHe.section.retry })).toBeVisible();
    }
    // "נסו שוב" never drops focus to <body> (it fails again here: the new retry button takes it).
    await page.getByTestId('home-section-failed-vat').getByRole('button', { name: ovHe.section.retry }).click();
    await expect(page.getByTestId('home-section-failed-vat').getByRole('button', { name: ovHe.section.retry })).toBeFocused();
    await expect(page.getByTestId('needs-you')).toBeVisible();
  });
});

test.describe('receiving board', () => {
  test.use({ storageState: OWNER_STATE });
  const created: { receipts: string[]; pos: string[] } = { receipts: [], pos: [] };

  test.afterEach(async () => {
    const sql = e2eSql();
    try {
      if (created.receipts.length) await sql`delete from goods_receipts where id in ${sql(created.receipts)}`;
      if (created.pos.length) {
        await sql`delete from po_lines where po_id in ${sql(created.pos)}`;
        await sql`delete from purchase_orders where id in ${sql(created.pos)}`;
      }
    } finally {
      created.receipts = [];
      created.pos = [];
      await sql.end();
    }
  });

  async function newPo(daysFromToday: number): Promise<{ id: string; supplier: string }> {
    const sql = e2eSql();
    try {
      const [s] = await sql<{ id: string; name: string }[]>`
        select id, name from suppliers where restaurant_id = ${restaurantId} order by name desc limit 1`;
      const [po] = await sql<{ id: string }[]>`
        insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source)
        values (${restaurantId}, ${s!.id}, date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem' + ${`${daysFromToday} days`}::interval + interval '9 hours', 'sent', 'manual')
        returning id`;
      await sql`insert into po_lines (po_id, raw_description, qty_ordered, unit, unit_price_expected) values (${po!.id}, 'e2e W1-05', '1', 'יח׳', '10')`;
      created.pos.push(po!.id);
      return { id: po!.id, supplier: s!.name };
    } finally {
      await sql.end();
    }
  }

  async function receipt(poId: string, status: 'pending' | 'completed') {
    const sql = e2eSql();
    try {
      const [gr] = await sql<{ id: string }[]>`
        insert into goods_receipts (restaurant_id, po_id, status) values (${restaurantId}, ${poId}, ${status}) returning id`;
      created.receipts.push(gr!.id);
    } finally {
      await sql.end();
    }
  }

  test('closed receipts read "התקבל ✓" and open read-only; open is neutral; past-dated open POs are late', async ({ page, baseURL }) => {
    await consent(page, baseURL!);
    const closed = await newPo(0);
    await receipt(closed.id, 'completed');
    const open = await newPo(0);
    await receipt(open.id, 'pending');
    const late = await newPo(-1);

    await page.goto('/dashboard/receiving');
    await expect(page.getByTestId('receiving-board')).toBeVisible();
    await expect(page.getByTestId('board-summary')).toContainText('היום:');

    const closedCard = page.locator(`[data-po="${closed.id}"]`);
    await expect(closedCard).toHaveAttribute('data-state', 'received');
    await expect(closedCard).toContainText(ovHe.board.cta.received);
    await expect(closedCard).toHaveAttribute('href', `/dashboard/receiving?receipt=${closed.id}`);

    // In progress: the "בקבלה" badge is neutral, never the warning tone.
    const openCard = page.locator(`[data-po="${open.id}"]`).first();
    await expect(openCard).toContainText(ovHe.board.state.inProgress);
    const badgeClass = await openCard.getByText(ovHe.board.state.inProgress, { exact: true }).getAttribute('class');
    expect(badgeClass).not.toMatch(/warn/);

    // Yesterday's open PO is under "באיחור" (or is the next truck itself).
    const lateGroup = page.getByTestId('board-group-late');
    const next = page.getByTestId('board-next');
    const inLate = (await lateGroup.locator(`[data-po="${late.id}"]`).count()) > 0;
    const isNext = (await next.getAttribute('data-po')) === late.id;
    expect(inLate || isNext, 'yesterday’s open PO is late').toBe(true);

    // The closed receipt opens read-only, never the wizard.
    await closedCard.click();
    await page.waitForURL(new RegExp(`receipt=${closed.id}`));
    await expect(page.getByTestId('receipt-view')).toBeVisible();
    await expect(page.getByTestId('receipt-view')).toContainText(ovHe.board.receipt.readOnly);
    await expect(page.locator('input[type="number"], input[inputmode="decimal"]')).toHaveCount(0);
    expect(await axeSerious(page)).toEqual([]);
  });
});
