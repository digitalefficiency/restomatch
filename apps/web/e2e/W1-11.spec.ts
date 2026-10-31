import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { en as ordersEn } from '../lib/i18n/messages/orders/en';
import { he as ordersHe } from '../lib/i18n/messages/orders/he';
import { DEMO_RESTAURANT_NAME } from './env';
import { collectPageErrors, e2eSql, loginViaMagicLink } from './helpers';

/**
 * W1-11 · Orders on the manager's phone: "order again" in ≤4 taps, a draft that
 * survives a supplier switch and a reload, send with a 10 s undo (and a visible
 * draft when the page closes inside it), the reminder link alias, cancel behind ⋯
 * naming supplier/₪/date with a supplier notice, the list's #ref search and one
 * link per row — plus thumb-zone, ₪-side and axe checks. Hebrew at 390 (manager),
 * English and desktop 1440 where the screen differs.
 */

const MANAGER_EMAIL = 'manager@kfar-hazeitim.test';
/** The manager's session cookies, signed in once in beforeAll and added to every test's context. */
let managerCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;
const MSG = { he: ordersHe, en: ordersEn } as const;
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

test.describe.configure({ mode: 'serial' });

let supplierA = { id: '', name: '' };
let supplierB = { id: '', name: '' };
let reorderPo = '';
let goneItem = '';
/** Catalog list prices of the two reorderable lines (what "order again" must price at). */
let todaysPrices: number[] = [];

test.beforeAll(async ({ browser }) => {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) throw new Error('demo restaurant missing from the e2e DB');
    // Two suppliers with ≥2 active catalog products, no order schedule, no server
    // drafts (so the reorder lands without the attach/replace choice) — A has e-mail.
    const sups = await sql<{ id: string; name: string; email: string | null }[]>`
      select s.id, s.name, s.contact_email as email from suppliers s
      where s.restaurant_id = ${r.id} and s.active and s.order_schedule is null
        and (select count(*) from supplier_catalog_items c
             where c.supplier_id = s.id and c.active and c.product_id is not null) >= 2
        and not exists (select 1 from purchase_orders p where p.supplier_id = s.id and p.status = 'draft')
      order by (s.contact_email is null), s.name limit 2`;
    if (sups.length < 2 || !sups[0]!.email) throw new Error('seed needs 2 catalog suppliers (one with e-mail) and no drafts');
    supplierA = { id: sups[0]!.id, name: sups[0]!.name };
    supplierB = { id: sups[1]!.id, name: sups[1]!.name };

    // A sent PO to A: two catalog products, one product A doesn't sell, one free line
    // (the estimate below is a fixed placeholder total; only its ₪ rendering is asserted).
    // Priced in the catalog, no contract: "today's price" is the list price, and the
    // seeded last price (list + ₪1) must NOT come back.
    const cat = await sql<{ product_id: string; name: string; unit: string | null; list: string }[]>`
      select c.product_id, c.supplier_name_raw as name, c.unit, c.list_price::text as list
      from supplier_catalog_items c
      where c.supplier_id = ${supplierA.id} and c.active and c.product_id is not null
        and c.list_price is not null and c.unit is not null
        and not exists (select 1 from supplier_contract_prices k
                        where k.supplier_id = c.supplier_id and k.product_id = c.product_id)
      order by c.supplier_name_raw limit 2`;
    if (cat.length < 2) throw new Error('seed needs 2 priced, uncontracted catalog products for supplier A');
    todaysPrices = cat.map((c) => Number(c.list));
    const [gone] = await sql<{ id: string; name: string }[]>`
      select p.id, p.canonical_name as name from products p
      where p.restaurant_id = ${r.id}
        and not exists (select 1 from supplier_catalog_items c where c.supplier_id = ${supplierA.id} and c.product_id = p.id)
      order by p.canonical_name limit 1`;
    if (!gone) throw new Error('seed needs a product supplier A does not sell');
    goneItem = `W1-11 גמור ${gone.name}`;
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes, sent_at, sent_channel, total_estimated)
      values (${r.id}, ${supplierA.id}, now() - interval '2 days', 'sent', 'manual', 'e2e-W1-11', now() - interval '3 days', null, '130.00')
      returning id`;
    reorderPo = po!.id;
    for (const [i, c] of cat.entries()) {
      await sql`insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
                values (${reorderPo}, ${c.product_id}, ${c.name}, ${4 + i}, ${c.unit ?? 'יח׳'}, ${Number(c.list) + 1})`;
    }
    await sql`insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
              values (${reorderPo}, ${gone.id}, ${goneItem}, 2, 'יח׳', 5)`;
    await sql`insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
              values (${reorderPo}, null, 'W1-11 שורה חופשית', 1, 'ארגז', 25)`;
  } finally {
    await sql.end();
  }

  // Sign the demo manager in once for this file.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  await loginViaMagicLink(page, MANAGER_EMAIL, '/dashboard');
  managerCookies = await ctx.cookies();
  await ctx.close();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(managerCookies);
});

async function setLocale(page: Page, locale: 'he' | 'en') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

/** Counts every tap the test makes — the acceptance is a tap budget. */
function tapper() {
  let n = 0;
  return {
    get count() {
      return n;
    },
    async tap(l: Locator) {
      n += 1;
      await l.tap();
    },
  };
}

async function axeSeriousOrWorse(page: Page): Promise<string[]> {
  // Scan a settled page: a list refetch dims rows (opacity) for a moment, and
  // contrast measured mid-fade is not what the user reads.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running')).catch(() => {});
  await page.addScriptTag({ content: AXE_SOURCE });
  const res = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe;
    return axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
  });
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

/** In Hebrew the ₪ glyph renders to the LEFT of the first digit (DoD-4). */
async function shekelLeftOfDigits(l: Locator): Promise<boolean> {
  return l.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let shekel: DOMRect | null = null;
    let digit: DOMRect | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (!shekel && ch === '₪') {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 1);
          shekel = r.getBoundingClientRect();
        }
        if (!digit && /\d/.test(ch)) {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 1);
          digit = r.getBoundingClientRect();
        }
      }
    }
    return !!shekel && !!digit && shekel.right <= digit.left + 1;
  });
}

async function expectThumbZonePrimary(page: Page) {
  const box = await page.getByTestId('cart-primary').boundingBox();
  expect(box, 'the primary is on screen').not.toBeNull();
  const vp = page.viewportSize()!;
  expect(box!.height, 'primary ≥ 56 px').toBeGreaterThanOrEqual(56);
  expect(box!.width, 'primary ≥ viewport − 40 px').toBeGreaterThanOrEqual(vp.width - 40);
  expect(box!.y, 'primary in the bottom third').toBeGreaterThanOrEqual((vp.height * 2) / 3);
}

async function poStatus(id: string): Promise<string | null> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ status: string }[]>`select status::text as status from purchase_orders where id = ${id}`;
    return row?.status ?? null;
  } finally {
    await sql.end();
  }
}

async function poLines(id: string): Promise<Array<{ qty: number; raw: string | null }>> {
  const sql = e2eSql();
  try {
    return await sql<{ qty: number; raw: string | null }[]>`
      select qty_ordered::float as qty, raw_description as raw from po_lines where po_id = ${id} order by raw_description`;
  } finally {
    await sql.end();
  }
}

/** POs for a supplier created since `since` (this test's own), by status. */
async function posSince(supplierId: string, since: Date): Promise<Array<{ id: string; status: string }>> {
  const sql = e2eSql();
  try {
    return await sql<{ id: string; status: string }[]>`
      select id, status::text as status from purchase_orders
      where supplier_id = ${supplierId} and created_at >= ${since} order by created_at`;
  } finally {
    await sql.end();
  }
}

type StoredCarts = { carts: Record<string, { lines: unknown[]; draftId: string | null }> };
async function deviceCarts(page: Page): Promise<StoredCarts['carts']> {
  const raw = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('rm:orders:cart:v1:'));
    return k ? localStorage.getItem(k) : null;
  });
  return raw ? (JSON.parse(raw) as StoredCarts).carts : {};
}

test.describe('phone 390 · manager · he', () => {
  test.use(PHONE);

  test('order again from the list card in ≤4 taps: today’s prices, free line verbatim, dropped item named, undo window, sent', async ({ page }) => {
    test.setTimeout(150_000);
    const m = MSG.he;
    const errors = collectPageErrors(page);
    await setLocale(page, 'he');
    await page.goto('/dashboard/orders');
    const taps = tapper();

    const card = page.getByTestId('order-card').filter({ has: page.locator(`a[href="/dashboard/orders/${reorderPo}"]`) });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await taps.tap(card.getByTestId('card-reorder'));

    // Prefilled: 2 catalog lines + the free line; the product A no longer sells is named, not added.
    await expect(page.getByTestId('order-line')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByTestId('reorder-unavailable')).toContainText(goneItem);
    await expect(page.locator('input[value="W1-11 שורה חופשית"]')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`supplierId=${supplierA.id}`));
    // Field mode: no bottom nav inside the task; the primary sits in the thumb zone.
    await expect(page.locator(`nav[aria-label="ניווט מהיר"]`)).toBeHidden();
    await expectThumbZonePrimary(page);
    expect(await shekelLeftOfDigits(page.getByTestId('cart-summary')), '₪ left of the digits in he').toBe(true);

    await expect(page.getByTestId('delivery-chip').first()).toBeVisible();
    await taps.tap(page.getByTestId('cart-primary')); // → review
    await expect(page.getByTestId('order-document-preview')).toBeVisible({ timeout: 30_000 });
    const send = page.getByTestId('cart-primary');
    await expect(send).toHaveText(m.send.cta.email.replace('{supplier}', supplierA.name));
    expect(await axeSeriousOrWorse(page), 'axe on review').toEqual([]);
    await taps.tap(send);

    await expect(page.getByTestId('send-undo')).toBeVisible();
    const sentTitle = m.wizard.sentTitle.replace('{supplier}', supplierA.name).replace('{channel}', m.detail.channelNames.email);
    await expect(page.getByRole('status').filter({ hasText: sentTitle })).toBeVisible({ timeout: 30_000 });
    expect(taps.count, 'routine reorder taps').toBeLessThanOrEqual(4);

    const href = await page.getByRole('link', { name: m.wizard.viewOrder }).getAttribute('href');
    const poId = href!.split('/').pop()!;
    expect(await poStatus(poId)).toBe('sent');
    const sql = e2eSql();
    try {
      const lines = await sql<{ raw: string | null; price: string | null; product: string | null }[]>`
        select raw_description as raw, unit_price_expected::text as price, product_id as product
        from po_lines where po_id = ${poId}`;
      expect(lines.map((l) => l.raw)).toContain('W1-11 שורה חופשית');
      expect(lines.map((l) => l.raw)).not.toContain(goneItem);
      expect(lines).toHaveLength(3);
      // Today's prices: the catalog list price, not the last order's (list + ₪1); the free line keeps ₪25.
      const productPrices = lines.filter((l) => l.product).map((l) => Number(l.price)).sort((a, b) => a - b);
      expect(productPrices).toEqual([...todaysPrices].sort((a, b) => a - b));
      expect(Number(lines.find((l) => !l.product)!.price)).toBe(25);
    } finally {
      await sql.end();
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a draft survives a supplier switch (with a 10 s undo) and a reload, and is offered back', async ({ page }) => {
    test.setTimeout(150_000);
    const m = MSG.he;
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());

    await page.goto(`/dashboard/orders/new?supplierId=${supplierA.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    await items.nth(1).tap();
    await expect(page.getByTestId('order-line')).toHaveCount(2);

    // Switch to B: A's 2 lines are kept, the switch can be undone for 10 s.
    await page.getByTestId('change-supplier').tap();
    await page.getByRole('dialog').getByTestId('supplier-row').filter({ hasText: supplierB.name }).tap();
    await expect(page.getByTestId('switch-undo')).toBeVisible();
    await expect(page.getByTestId('order-line')).toHaveCount(0);
    await page.getByTestId('switch-undo').getByRole('button', { name: m.draft.undo }).tap();
    await expect(page.getByTestId('order-line')).toHaveCount(2);

    // Switch again, add one line at B, reload: B's cart is back.
    await page.getByTestId('change-supplier').tap();
    await page.getByRole('dialog').getByTestId('supplier-row').filter({ hasText: supplierB.name }).tap();
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    await expect(page.getByTestId('order-line')).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`supplierId=${supplierB.id}`));
    await page.reload();
    await expect(page.getByTestId('order-line')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId('draft-restored')).toBeVisible();

    // A fresh wizard offers the last unsent order; A's draft is still there.
    await page.goto('/dashboard/orders/new');
    const offer = page.getByTestId('resume-offer');
    await expect(offer).toBeVisible({ timeout: 30_000 });
    await expect(offer.getByRole('button', { name: m.draft.resume.replace('{count}', '1') })).toBeVisible();
    await expect(page.getByTestId('supplier-row').filter({ hasText: supplierA.name })).toContainText(
      m.draft.hasDraft.replace('{count}', '2'),
    );
    await page.getByTestId('supplier-row').filter({ hasText: supplierA.name }).tap();
    await expect(page.getByTestId('order-line')).toHaveCount(2);
  });

  test('send with undo: undo keeps a draft; closing the page inside the window leaves a visible draft', async ({ page, context }) => {
    test.setTimeout(150_000);
    const m = MSG.he;
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierB.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    // The day is settled while building (before any server draft exists).
    await expect(page.getByTestId('delivery-chip').first()).toBeVisible();
    await page.getByTestId('cart-primary').tap();
    await page.locator('#ord-channel').selectOption('none');

    await page.getByTestId('cart-primary').tap();
    const undo = page.getByTestId('send-undo');
    await expect(undo).toBeVisible({ timeout: 30_000 });
    await undo.getByRole('button', { name: m.send.undo }).tap();
    await expect(undo).toBeHidden();
    // The order was saved as a server draft before the window; undo leaves it a draft.
    const draftLink = await page.evaluate(() => {
      const raw = Object.keys(localStorage).find((k) => k.startsWith('rm:orders:cart:v1:'));
      return raw ? (JSON.parse(localStorage.getItem(raw)!) as { carts: Record<string, { draftId: string | null }> }) : null;
    });
    const draftId = Object.values(draftLink?.carts ?? {}).map((c) => c.draftId).find(Boolean)!;
    expect(draftId).toBeTruthy();
    await page.waitForTimeout(11_000);
    expect(await poStatus(draftId)).toBe('draft');

    // Send again and leave inside the window: nothing is sent, the draft stays visible.
    await page.getByTestId('cart-primary').tap();
    await expect(undo).toBeVisible();
    await page.goto('about:blank');
    await page.waitForTimeout(11_000);
    expect(await poStatus(draftId)).toBe('draft');
    const list = await context.newPage();
    await list.goto('/dashboard/orders');
    await list.getByRole('button', { name: m.filters.draft, exact: true }).click();
    await expect(list.locator(`a[href="/dashboard/orders/${draftId}"]`).first()).toBeAttached({ timeout: 30_000 });
  });

  test('the reminder e-mail link: ?supplier= (old) and ?supplierId= both land on the supplier', async ({ page }) => {
    await setLocale(page, 'he');
    for (const q of [`supplier=${supplierA.id}`, `supplierId=${supplierA.id}`]) {
      await page.goto(`/dashboard/orders/new?${q}`);
      await expect(page.getByTestId('catalog-item').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('heading', { level: 1 })).toContainText(supplierA.name);
    }
  });

  test('detail: #ref, "order again", cancel behind ⋯ naming supplier, ₪ and date with the notice on by default', async ({ page }) => {
    const m = MSG.he;
    const errors = collectPageErrors(page);
    await setLocale(page, 'he');
    await page.goto(`/dashboard/orders/${reorderPo}`);
    const ref = reorderPo.replace(/-/g, '').slice(0, 8).toUpperCase();
    await expect(page.getByTestId('order-ref')).toHaveText(`#${ref}`);
    await expect(page.getByTestId('order-again')).toHaveAttribute('href', `/dashboard/orders/new?from=${reorderPo}`);
    // Cancel is not a header button any more — it lives in ⋯.
    await expect(page.getByRole('button', { name: m.detail.cancel })).toHaveCount(0);
    await page.getByRole('button', { name: m.detail.more }).tap();
    await page.getByRole('menuitem', { name: m.detail.cancel }).tap();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(supplierA.name);
    await expect(dialog.getByTestId('cancel-facts')).toContainText(`#${ref}`);
    await expect(dialog.getByTestId('cancel-facts')).toContainText('₪');
    const notify = dialog.getByTestId('cancel-notify');
    if (await notify.count()) await expect(notify).toBeChecked();
    // Keep the order (the reorder test above still points at it).
    await dialog.getByRole('button', { name: m.detail.keepOrder }).tap();
    await expect(dialog).toBeHidden();
    expect(await axeSeriousOrWorse(page), 'axe on detail').toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('phone 390 · manager · review fixes', () => {
  test.use(PHONE);

  test('"order again" never erases this device\'s unsent cart, even on a reload at the attach/replace choice', async ({ page }) => {
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierA.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    await items.nth(1).tap();
    await expect(page.getByTestId('order-line')).toHaveCount(2);

    await page.goto(`/dashboard/orders/new?from=${reorderPo}`);
    await expect(page.getByTestId('reorder-choice')).toBeVisible({ timeout: 30_000 });
    expect((await deviceCarts(page))[supplierA.id]?.lines, 'cart kept while the choice is open').toHaveLength(2);
    await page.reload();
    await expect(page.getByTestId('reorder-choice')).toBeVisible({ timeout: 30_000 });
    expect((await deviceCarts(page))[supplierA.id]?.lines, 'cart kept across a reload').toHaveLength(2);
    // Attach merges both: the 2 cart lines + the reorder's lines (its 2 catalog lines overlap).
    await page.getByRole('button', { name: MSG.he.reorder.attach }).tap();
    await expect(page.getByTestId('order-line').first()).toBeVisible();
    expect((await page.getByTestId('order-line').count())).toBeGreaterThanOrEqual(2);
  });

  test('a saved cart whose draft was sent elsewhere is never offered (or sent) again', async ({ page }) => {
    test.setTimeout(150_000);
    const since = new Date(Date.now() - 1000);
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierB.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    await page.getByTestId('cart-primary').tap(); // review → the server draft
    await expect.poll(async () => (await deviceCarts(page))[supplierB.id]?.draftId ?? null, { timeout: 30_000 }).not.toBeNull();
    const draftId = (await deviceCarts(page))[supplierB.id]!.draftId!;

    // Someone sends it from the order page on another device.
    const sql = e2eSql();
    try {
      await sql`update purchase_orders set status = 'sent', sent_at = now() where id = ${draftId}`;
    } finally {
      await sql.end();
    }

    await page.goto('/dashboard/orders/new');
    await expect(page.getByTestId('stale-draft')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('stale-draft').locator(`a[href="/dashboard/orders/${draftId}"]`)).toBeVisible();
    await expect(page.getByTestId('resume-offer')).toHaveCount(0);
    expect((await deviceCarts(page))[supplierB.id], 'the stale cart is dropped').toBeUndefined();
    await page.goto(`/dashboard/orders/new?supplierId=${supplierB.id}`);
    await expect(page.getByTestId('catalog-item').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('order-line')).toHaveCount(0);
    expect((await posSince(supplierB.id, since)).map((p) => p.id), 'no second PO').toEqual([draftId]);
  });

  test('the day is settled before the draft: picking another day sends ONE order, no phantom cancelled row', async ({ page }) => {
    test.setTimeout(150_000);
    const since = new Date(Date.now() - 1000);
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierB.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    const chips = page.getByTestId('delivery-chip');
    await expect(chips.nth(1)).toBeVisible();
    await chips.nth(1).tap();
    await expect(chips.nth(1)).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('cart-primary').tap(); // review
    await page.locator('#ord-channel').selectOption('none');
    await page.getByTestId('cart-primary').tap();
    await expect(page.getByRole('status').filter({ hasText: MSG.he.wizard.markedTitle })).toBeVisible({ timeout: 30_000 });
    const pos = await posSince(supplierB.id, since);
    expect(pos.map((p) => p.status)).toEqual(['sent']);
  });

  test('edits after the draft exists reach it; a draft replaced by an added line stays out of the list', async ({ page }) => {
    test.setTimeout(150_000);
    const since = new Date(Date.now() - 1000);
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierB.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    await items.nth(1).tap();
    await page.getByTestId('cart-primary').tap(); // review → draft D
    await expect.poll(async () => (await deviceCarts(page))[supplierB.id]?.draftId ?? null, { timeout: 30_000 }).not.toBeNull();
    const d = (await deviceCarts(page))[supplierB.id]!.draftId!;
    await page.getByRole('button', { name: MSG.he.wizard.back }).tap();

    // Edit qty of line 1, remove line 2: both reach D without a send (the order page shows them).
    const lines = page.getByTestId('order-line');
    await lines.nth(0).getByRole('textbox', { name: /כמות/ }).fill('7');
    await lines.nth(1).getByRole('button', { name: /הסרת/ }).tap();
    await expect.poll(async () => (await poLines(d)).map((l) => l.qty), { timeout: 15_000 }).toEqual([7]);

    // Adding a line after the draft exists replaces it at the next review: the old one
    // is cancelled and never shows in the orders list.
    await items.nth(1).tap(); // re-add the removed product: a new line for the draft
    await expect(page.getByTestId('order-line')).toHaveCount(2);
    await page.getByTestId('cart-primary').tap();
    await expect.poll(async () => (await deviceCarts(page))[supplierB.id]?.draftId, { timeout: 30_000 }).not.toBe(d);
    expect(await poStatus(d)).toBe('cancelled');
    await page.goto('/dashboard/orders');
    await expect(page.getByTestId('order-card').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`a[href="/dashboard/orders/${d}"]`)).toHaveCount(0);
    expect((await posSince(supplierB.id, since)).filter((p) => p.status === 'draft')).toHaveLength(1);
  });
});

test.describe('phone 390 · manager · verifier fixes', () => {
  test.use(PHONE);

  test('"order again" offers to keep my draft: the device cart stays exactly as it was', async ({ page }) => {
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierA.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    await expect(page.getByTestId('order-line')).toHaveCount(1);
    const before = await page.getByTestId('order-line').first().innerText();

    await page.goto(`/dashboard/orders/new?from=${reorderPo}`);
    await page.getByRole('button', { name: MSG.he.reorder.keep }).tap();
    await expect(page.getByTestId('order-line')).toHaveCount(1);
    expect(await page.getByTestId('order-line').first().innerText()).toBe(before);
    await expect(page.getByTestId('reorder-notice')).toHaveCount(0);
    expect((await deviceCarts(page))[supplierA.id]?.lines).toHaveLength(1);
  });

  test('a line removed on the order page meanwhile is re-paired, not a stuck save', async ({ page }) => {
    test.setTimeout(150_000);
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierB.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    await items.nth(1).tap();
    await page.getByTestId('cart-primary').tap(); // review → draft D
    await expect.poll(async () => (await deviceCarts(page))[supplierB.id]?.draftId ?? null, { timeout: 30_000 }).not.toBeNull();
    const d = (await deviceCarts(page))[supplierB.id]!.draftId!;
    await page.getByRole('button', { name: MSG.he.wizard.back }).tap();

    // Someone deletes line 2 on the order page (another tab / device).
    const second = await page.getByTestId('order-line').nth(1).locator('p').first().innerText();
    const sql = e2eSql();
    try {
      await sql`delete from po_lines where po_id = ${d} and raw_description = ${second}`;
    } finally {
      await sql.end();
    }
    // Editing that line here must still land: the next save re-pairs and carries qty 9.
    await page.getByTestId('order-line').nth(1).getByRole('textbox', { name: /כמות/ }).fill('9');
    await page.waitForTimeout(2_000); // the background sync meets the NOT_FOUND
    await page.getByTestId('cart-primary').tap();
    // No save error (the wizard's own alerts; Next's route announcer is also role=alert).
    await expect(page.locator('p.text-danger[role="alert"]')).toHaveCount(0);
    await expect.poll(async () => {
      const id = (await deviceCarts(page))[supplierB.id]?.draftId;
      return id ? (await poLines(id)).find((l) => l.raw === second)?.qty ?? null : null;
    }, { timeout: 30_000 }).toBe(9);
  });

  test('the fixed cart bar never hides the focused control (WCAG 2.4.11)', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto(`/dashboard/orders/new?supplierId=${supplierA.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    await items.nth(1).tap();
    const bar = await page.getByTestId('cart-bar').boundingBox();
    // Walk the tab order through the build step; every focused control clears the bar.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || el.closest('[data-testid="cart-bar"]')) return null;
        if (el.tagName.toLowerCase() === 'nextjs-portal') return null; // next dev's overlay, not in production
        const b = el.getBoundingClientRect();
        if (b.height === 0) return null;
        return {
          top: b.top,
          bottom: b.bottom,
          name: `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 30) ?? ''}`,
        };
      });
      if (!r || r.bottom <= 0) continue;
      expect(r.bottom, `focused "${r.name}" (top ${Math.round(r.top)}) is not under the cart bar`).toBeLessThanOrEqual(bar!.y + 1);
    }
  });
});

test.describe('phone 390 · manager · scope fixes', () => {
  test.use(PHONE);

  test('a send retried after a reload re-uses the persisted draft: exactly one PO', async ({ page }) => {
    test.setTimeout(150_000);
    const since = new Date(Date.now() - 1000);
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierB.id}`);
    const items = page.getByTestId('catalog-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    await items.nth(0).tap();
    await page.getByTestId('cart-primary').tap(); // review
    await page.locator('#ord-channel').selectOption('none');
    await page.getByTestId('cart-primary').tap(); // send → countdown
    await expect(page.getByTestId('send-undo')).toBeVisible({ timeout: 30_000 });
    // The tab reloads inside the window (crash, swipe-refresh): nothing was sent yet.
    await page.reload();
    await expect(page.getByTestId('order-line')).toHaveCount(1, { timeout: 30_000 });
    const draftId = (await deviceCarts(page))[supplierB.id]?.draftId;
    expect(draftId, 'the draft id survived the reload').toBeTruthy();
    // Retry: review → send again, let it go through.
    await page.getByTestId('cart-primary').tap();
    await page.locator('#ord-channel').selectOption('none');
    await page.getByTestId('cart-primary').tap();
    await expect(page.getByRole('status').filter({ hasText: MSG.he.wizard.markedTitle })).toBeVisible({ timeout: 30_000 });
    const pos = await posSince(supplierB.id, since);
    expect(pos.map((p) => p.status), 'one PO, sent — never a second draft').toEqual(['sent']);
    expect(pos[0]!.id).toBe(draftId);
  });

  test('a unit price typed as "1,250" is ₪1,250 (and "0,250" is ₪0.25)', async ({ page }) => {
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierA.id}`);
    await expect(page.getByTestId('catalog-item').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('catalog-item').first().tap();
    const price = page.getByTestId('order-line').first().getByRole('textbox', { name: /מחיר ליח׳/ });
    await price.fill('1,250');
    await page.getByTestId('order-line').first().getByRole('textbox', { name: /כמות/ }).fill('1');
    await expect(page.getByTestId('order-total')).toContainText('1,250.00');
    await price.fill('0,250');
    await expect(page.getByTestId('order-total')).toContainText('0.25');
  });
});

test.describe('desktop 1440 · manager · keyboard', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('send-with-undo is reachable from the keyboard: focus lands on the undo, Enter undoes', async ({ page }) => {
    test.setTimeout(150_000);
    await setLocale(page, 'he');
    page.on('dialog', (d) => void d.accept());
    await page.goto(`/dashboard/orders/new?supplierId=${supplierB.id}`);
    await expect(page.getByTestId('catalog-item').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('catalog-item').first().click();
    await page.getByTestId('cart-primary').click();
    await page.locator('#ord-channel').selectOption('none');
    await page.getByTestId('cart-primary').focus();
    await page.keyboard.press('Enter');
    const undo = page.getByTestId('send-undo').getByRole('button', { name: MSG.he.send.undo });
    await expect(undo).toBeFocused({ timeout: 30_000 });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('send-undo')).toHaveCount(0);
    const id = (await deviceCarts(page))[supplierB.id]!.draftId!;
    await page.waitForTimeout(11_000);
    expect(await poStatus(id)).toBe('draft');
  });
});

test.describe('desktop 1440 · manager', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const locale of ['he', 'en'] as const) {
    test(`${locale}: list rows are one link each, #ref is searchable, status chips carry an icon`, async ({ page }) => {
      const m = MSG[locale];
      const errors = collectPageErrors(page);
      await setLocale(page, locale);
      await page.goto('/dashboard/orders');
      const ref = reorderPo.replace(/-/g, '').slice(0, 8).toUpperCase();
      const row = page.getByTestId('order-row').filter({ has: page.locator(`a[href="/dashboard/orders/${reorderPo}"]`) });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row.locator('a[href^="/dashboard/orders/"]')).toHaveCount(1);
      await expect(row.getByTestId('order-status').locator('svg')).toHaveCount(1);
      await expect(row.getByTestId('order-ref')).toHaveText(`#${ref}`);

      await page.getByTestId('orders-search').fill(`#${ref.slice(0, 6)}`);
      await expect(page.getByTestId('order-row')).toHaveCount(1);
      await page.getByTestId('orders-search').fill('zzzz-nothing');
      await expect(page.getByText(m.list.noSearchResults)).toBeVisible();
      expect(await axeSeriousOrWorse(page), 'axe on list').toEqual([]);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('en: the wizard review names supplier and channel on the send button', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto(`/dashboard/orders/new?supplierId=${supplierA.id}`);
    await expect(page.getByTestId('catalog-item').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('catalog-item').first().click();
    await expect(page.getByTestId('delivery-reason').or(page.getByText(MSG.en.wizard.noSchedule))).toBeVisible();
    await page.getByTestId('cart-primary').click();
    await expect(page.getByTestId('cart-primary')).toContainText('Send to');
    expect(await axeSeriousOrWorse(page), 'axe on review (en)').toEqual([]);
  });
});
