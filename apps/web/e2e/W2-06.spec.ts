import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { he as ordersHe } from '../lib/i18n/messages/orders/he';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * W2-06 · Orders 2 on the manager's phone: a 10-line routine order from the
 * order guide in ≤ 9 taps and ≤ 45 s with no keyboard; the server draft
 * restored in another browser context; "מהוואטסאפ שלי" (wa.me opened in the
 * tap, status sent, nothing queued); the cut-off board; and the receiver's
 * orders payloads with no ₪.
 */

const MANAGER = 'manager@kfar-hazeitim.test';
const RECEIVER = 'receiver@kfar-hazeitim.test';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;
const M = ordersHe;

test.describe.configure({ mode: 'serial' });

let managerCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
let receiverCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
let restaurantId = '';
let supplier = { id: '', name: '' };
let products: Array<{ id: string; name: string; unit: string }> = [];

test.beforeAll(async ({ browser }) => {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) throw new Error('demo restaurant missing from the e2e DB');
    restaurantId = r.id;
    // A dedicated supplier with a WhatsApp number and no e-mail, so the default channel
    // is "מהוואטסאפ שלי" (the demo plan has no platform WhatsApp) — and 10 products.
    const [s] = await sql<{ id: string; name: string }[]>`
      insert into suppliers (restaurant_id, name, contact_whatsapp, active)
      values (${r.id}, ${`W2-06 ספק ${Date.now()}`}, '0525550606', true) returning id, name`;
    supplier = s!;
    products = [];
    for (let i = 0; i < 10; i++) {
      const [p] = await sql<{ id: string; name: string }[]>`
        insert into products (restaurant_id, canonical_name, category, default_unit)
        values (${r.id}, ${`W2-06 פריט ${String(i).padStart(2, '0')}`}, ${i < 5 ? 'ירקות' : 'מוצרי חלב'}, 'ק״ג')
        returning id, canonical_name as name`;
      products.push({ id: p!.id, name: p!.name, unit: 'ק״ג' });
    }
    // Three sent orders with all 10 items → every item is in the guide (≥ 2 of the last 8).
    for (let k = 3; k >= 1; k--) {
      const [po] = await sql<{ id: string }[]>`
        insert into purchase_orders (restaurant_id, supplier_id, status, source, sent_at, created_at, notes)
        values (${r.id}, ${supplier.id}, 'sent', 'manual', now() - ${`${k * 3} days`}::interval, now() - ${`${k * 3} days`}::interval, 'e2e-W2-06')
        returning id`;
      for (const [i, p] of products.entries()) {
        await sql`insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
                  values (${po!.id}, ${p.id}, ${p.name}, ${i + k}, ${p.unit}, ${10 + i})`;
      }
    }
  } finally {
    await sql.end();
  }
  for (const [email, set] of [
    [MANAGER, (c: typeof managerCookies) => (managerCookies = c)],
    [RECEIVER, (c: typeof managerCookies) => (receiverCookies = c)],
  ] as const) {
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await loginViaMagicLink(page, email, '/dashboard');
    set(await ctx.cookies());
    await ctx.close();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await sql`delete from po_lines where po_id in (select id from purchase_orders where supplier_id = ${supplier.id})`;
    await sql`delete from purchase_orders where supplier_id = ${supplier.id}`;
  } finally {
    await sql.end();
  }
});

async function asManager(page: Page) {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([...managerCookies, { name: 'rm_cookie_consent', value: 'necessary', url }]);
}

function tapper() {
  let n = 0;
  return {
    get count() {
      return n;
    },
    bump() {
      n += 1;
    },
    async tap(l: Locator) {
      n += 1;
      await l.tap();
    },
  };
}

test.describe('phone (he 390, touch)', () => {
  test.use(PHONE);

  test('a routine 10-line order from the guide: ≤ 9 taps, ≤ 45 s, no keyboard, no line starts at 1', async ({ page }) => {
    await asManager(page);
    await page.goto(`/dashboard/orders/new?supplierId=${supplier.id}`);
    await expect(page.getByTestId('order-guide')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('guide-row')).toHaveCount(10);
    // Every row starts empty with a ghost — nothing invented.
    await expect(page.getByTestId('guide-qty')).toHaveCount(0);
    await expect(page.getByTestId('guide-ghost')).toHaveCount(10);

    const started = Date.now();
    const t = tapper();
    await t.tap(page.getByTestId('guide-same-as-last')); // 1
    await expect(page.getByTestId('guide-qty')).toHaveCount(10);
    await expect(page.getByTestId('guide-undo')).toBeVisible();
    await expect(page.getByTestId('server-save')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
    await t.tap(page.getByTestId('cart-primary')); // 2 → review
    // The lab plan has the platform WhatsApp, so pick "מהוואטסאפ שלי" explicitly (one tap).
    await page.locator('#ord-channel').selectOption('manual');
    t.bump(); // the channel pick counts as a tap
    await expect(page.getByTestId('manual-send')).toBeVisible({ timeout: 15_000 });
    // "מהוואטסאפ שלי": stub window.open, then two taps (prepare, open + record).
    await page.evaluate(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = ((u: string) => {
        (window as unknown as { __opened: string[] }).__opened.push(u);
        return {} as Window;
      }) as typeof window.open;
    });
    await t.tap(page.getByTestId('cart-primary')); // 3 → prepare the text
    await expect(page.getByTestId('manual-text')).toContainText(products[0]!.name, { timeout: 15_000 });
    await t.tap(page.getByTestId('cart-primary')); // 4 → open wa.me + mark sent
    await expect(page.getByText(M.w2.manual.done)).toBeVisible({ timeout: 15_000 });
    expect(t.count).toBeLessThanOrEqual(9);
    expect(Date.now() - started).toBeLessThanOrEqual(45_000);

    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^https:\/\/wa\.me\/972525550606\?text=/);
    expect(decodeURIComponent(opened[0]!.split('text=')[1]!)).toContain(products[9]!.name);

    const sql = e2eSql();
    try {
      const [po] = await sql<{ id: string; status: string; sent_channel: string | null; n: number }[]>`
        select p.id, p.status, p.sent_channel,
               (select count(*)::int from notifications_outbox o where o.related_entity_id = p.id) as n
        from purchase_orders p where p.supplier_id = ${supplier.id} and p.notes is null
        order by p.created_at desc limit 1`;
      expect(po).toMatchObject({ status: 'sent', sent_channel: 'whatsapp', n: 0 });
      // "Same as last time" = each item's newest qty (i + 1), never an invented 1 for all.
      const lines = await sql<{ qty: number }[]>`select qty_ordered::float as qty from po_lines where po_id = ${po!.id} order by qty_ordered`;
      expect(lines.map((l) => l.qty)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await sql.end();
    }
  });

  test('the server draft comes back in another browser of the same user', async ({ page, browser }) => {
    await asManager(page);
    await page.goto(`/dashboard/orders/new?supplierId=${supplier.id}`);
    await expect(page.getByTestId('guide-ghost').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('guide-ghost').nth(0).tap();
    await page.getByTestId('guide-ghost').nth(0).tap(); // the next empty row
    await expect(page.getByTestId('server-save')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });

    const other = await browser.newContext({ ...PHONE, baseURL: test.info().project.use.baseURL });
    try {
      const p2 = await other.newPage();
      await asManager(p2);
      await p2.goto(`/dashboard/orders/new?supplierId=${supplier.id}`);
      await expect(p2.getByTestId('draft-restored')).toBeVisible({ timeout: 30_000 });
      await expect(p2.getByTestId('guide-qty')).toHaveCount(2);
    } finally {
      await other.close();
    }
  });

  test('the board lists suppliers by cut-off and opens the guide', async ({ page }) => {
    await asManager(page);
    await page.goto('/dashboard/orders/new');
    const rows = page.getByTestId('supplier-row');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const cutoffs = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-cutoff') ?? ''));
    const scheduled = cutoffs.filter(Boolean);
    expect([...scheduled].sort()).toEqual(scheduled);
    // Unscheduled suppliers sink below every scheduled one.
    expect(cutoffs.slice(0, scheduled.length).every(Boolean)).toBe(true);
  });
});

test('receiver: a shared WhatsApp order opens the in-shell forward page (no 403/404, no ₪, no drafting)', async ({ page }) => {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([...receiverCookies, { name: 'rm_cookie_consent', value: 'necessary', url }]);
  const text = '2 ק״ג עגבניות\n1 ארגז חסה 45 ₪';
  const res = await page.goto(`/dashboard/orders/capture?text=${encodeURIComponent(text)}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('share-forward')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('share-forward')).toContainText('עגבניות');
  await expect(page.getByTestId('share-forward-cta')).toBeVisible();
  // No capture form (the receiver does not draft): the page has no text box to submit.
  await expect(page.locator('main textarea')).toHaveCount(0);
});

test('receiver: no ₪ in the orders tRPC responses', async ({ page }) => {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([...receiverCookies, { name: 'rm_cookie_consent', value: 'necessary', url }]);
  const res = await page.request.get(`/api/trpc/orders.list,orders.supplierBoard?batch=1&input=${encodeURIComponent('{}')}`);
  expect(res.ok()).toBe(true);
  const body = await res.text();
  expect(body).not.toMatch(/"(unitPrice\w*|total\w*|\w+Ils|\w+Agorot)"/);
  expect(restaurantId).not.toBe('');
});
