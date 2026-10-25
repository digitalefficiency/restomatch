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
    // (4×10 + 5×11 + 2×5 + 1×25 = ₪130.00 estimated).
    const cat = await sql<{ product_id: string; name: string; unit: string | null }[]>`
      select c.product_id, c.supplier_name_raw as name, c.unit from supplier_catalog_items c
      where c.supplier_id = ${supplierA.id} and c.active and c.product_id is not null
      order by c.supplier_name_raw limit 2`;
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
                values (${reorderPo}, ${c.product_id}, ${c.name}, ${4 + i}, ${c.unit ?? 'יח׳'}, ${10 + i})`;
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
  await page.addScriptTag({ content: AXE_SOURCE });
  const res = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: unknown[] }> }> } }).axe;
    return axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
  });
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}`);
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

    await taps.tap(page.getByTestId('cart-primary')); // → review
    await expect(page.getByTestId('delivery-chip').first()).toBeVisible();
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
      const lines = await sql<{ raw: string | null }[]>`select raw_description as raw from po_lines where po_id = ${poId}`;
      expect(lines.map((l) => l.raw)).toContain('W1-11 שורה חופשית');
      expect(lines.map((l) => l.raw)).not.toContain(goneItem);
      expect(lines).toHaveLength(3);
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
    await page.getByTestId('cart-primary').tap();
    await expect(page.getByTestId('delivery-chip').first()).toBeVisible();
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
    await page.getByTestId('cart-primary').click();
    await expect(page.getByTestId('cart-primary')).toContainText('Send to');
    await expect(page.getByTestId('delivery-reason').or(page.getByText(MSG.en.wizard.noSchedule))).toBeVisible();
    expect(await axeSeriousOrWorse(page), 'axe on review (en)').toEqual([]);
  });
});
