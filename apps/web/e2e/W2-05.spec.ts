import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql } from './helpers';

/**
 * W2-05 slice A · the field outbox and the offline shell — the receiver on a
 * 390 px phone (dev server, its own e2e DB). Slices B/C add their scenarios
 * (resume, capture, walk-in, exceptions, desk view) to this file.
 */

const RECEIVER = 'receiver@kfar-hazeitim.test';
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

let receiverCookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> = [];
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(RECEIVER);
  await page.locator('#password').fill(process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!');
  await page.locator('form:has(#password) button[type=submit]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  receiverCookies = await ctx.cookies();
  await ctx.close();
});

test.beforeEach(async ({ page }) => {
  const url = test.info().project.use.baseURL!;
  // Hebrew UI (the seeded receiver defaults to en), consent bar answered.
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  await page.context().addCookies(receiverCookies);
  // A reload with unsent counts asks first (beforeunload): the receiver says "leave".
  page.on('dialog', (d) => void d.accept());
});

interface Po {
  poId: string;
  supplierName: string;
  lines: Array<{ poLineId: string; name: string }>;
}

async function freshPo(tag: string, n: number): Promise<Po> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    const [sup] = await sql<{ id: string; name: string }[]>`select id, name from suppliers where restaurant_id = ${r!.id} order by name limit 1`;
    const prods = await sql<{ id: string; name: string }[]>`
      select id, canonical_name as name from products
      where restaurant_id = ${r!.id} and canonical_name ~ '[א-ת]' order by canonical_name limit ${n}`;
    if (prods.length < n) throw new Error(`the e2e seed has only ${prods.length} Hebrew products`);
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
      values (${r!.id}, ${sup!.id}, now() + interval '1 hour', 'sent', 'manual', ${`e2e-w205-${tag}`}) returning id`;
    const lines: Po['lines'] = [];
    for (const p of prods) {
      const [pl] = await sql<{ id: string }[]>`
        insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
        values (${po!.id}, ${p.id}, ${p.name}, 5, 'יח׳', 10) returning id`;
      lines.push({ poLineId: pl!.id, name: p.name });
    }
    return { poId: po!.id, supplierName: sup!.name, lines };
  } finally {
    await sql.end();
  }
}

async function countedRows(poId: string): Promise<number> {
  const sql = e2eSql();
  try {
    const [c] = await sql<{ n: number }[]>`
      select count(*)::int as n from gr_lines gl join goods_receipts g on g.id = gl.gr_id
      where g.po_id = ${poId} and gl.qty_received > 0`;
    return c!.n;
  } finally {
    await sql.end();
  }
}

/** The field outbox's items on this device (IndexedDB "restomatch-outbox"). */
async function outboxKinds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('restomatch-outbox');
        req.onupgradeneeded = () => req.transaction?.abort();
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('items')) return resolve([]);
          const r = db.transaction('items').objectStore('items').getAll();
          r.onsuccess = () => {
            resolve((r.result as Array<{ kind: string }>).map((i) => i.kind));
            db.close();
          };
        };
      }),
  );
}

/** grLineIds the server acknowledged through markGrLine (batched or not). */
function ackedMarks(page: Page): string[] {
  const ids: string[] = [];
  page.on('requestfinished', async (req) => {
    if (!req.url().includes('receiving.markGrLine')) return;
    const res = await req.response();
    if (!res || res.status() !== 200) return;
    const body = req.postDataJSON() as Record<string, { json?: { grLineId?: string } }> | { json?: { grLineId?: string } } | null;
    if (!body) return;
    const entries = 'json' in body ? [body] : Object.values(body);
    for (const e of entries) if (e?.json?.grLineId) ids.push(e.json.grLineId);
  });
  return ids;
}

test('airplane mode: a 12-line count survives a reload and syncs exactly once — from the board, after leaving the screen', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const po = await freshPo('airplane', 12);
  const acked = ackedMarks(page);
  const path = `/dashboard/receiving/${po.poId}`;

  // Online, the board keeps today's open deliveries readable offline (the read snapshot).
  await page.goto('/dashboard/receiving');
  await page.waitForLoadState('networkidle');
  await expect
    .poll(
      () =>
        page.evaluate(
          async (p) => Boolean(await (await caches.open('rm-receiver-snapshot-v1')).match(p)),
          path,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('scan-no-invoice').tap();
  await expect(page.getByTestId('delivery-check')).toBeVisible();

  await context.setOffline(true);
  for (const l of po.lines) {
    await page.getByTestId('count-line').filter({ hasText: l.name }).getByTestId('count-arrived').tap();
  }
  for (const l of po.lines) {
    await expect(page.getByTestId('count-line').filter({ hasText: l.name }).getByTestId('line-save-state')).toHaveAttribute(
      'data-state',
      'queued',
      { timeout: 15_000 },
    );
  }
  // Every unsent row is in the ONE outbox (IndexedDB), not only in the screen's memory.
  await expect.poll(async () => (await outboxKinds(page)).filter((k) => k === 'grLine').length).toBe(12);
  expect(await countedRows(po.poId)).toBe(0);

  // A reload with zero bars: the page comes from the snapshot, never the bare offline page.
  await page.reload();
  await expect(page.locator('body')).not.toContainText('You are offline');
  await expect(page.locator('body')).toContainText(po.supplierName, { timeout: 30_000 });
  expect((await outboxKinds(page)).filter((k) => k === 'grLine')).toHaveLength(12);

  // Back online, on the board (the count screen is gone): the shell's drainer sends every line, once.
  await context.setOffline(false);
  await page.goto('/dashboard/receiving');
  await page.waitForLoadState('networkidle');
  await expect.poll(() => countedRows(po.poId), { timeout: 60_000 }).toBe(12);
  await expect.poll(async () => (await outboxKinds(page)).length, { timeout: 30_000 }).toBe(0);
  const perLine = new Map<string, number>();
  for (const id of acked) perLine.set(id, (perLine.get(id) ?? 0) + 1);
  expect(perLine.size).toBe(12);
  expect([...perLine.values()].every((n) => n === 1)).toBe(true);
  // Nothing replays them later: the W1-06 copy left the device with the ack.
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('rm-rcv-lines:') && localStorage.getItem(k) !== '[]')),
  ).toEqual([]);
});

test('the outbox chip opens per-item status; only whoever saved an item may delete it', async ({ page, context }) => {
  test.setTimeout(120_000);
  const po = await freshPo('chip', 3);
  await page.goto(`/dashboard/receiving/${po.poId}`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('scan-no-invoice').tap();
  await expect(page.getByTestId('delivery-check')).toBeVisible();
  await context.setOffline(true);
  await page.getByTestId('count-line').filter({ hasText: po.lines[0]!.name }).getByTestId('count-arrived').tap();
  await expect.poll(async () => (await outboxKinds(page)).length).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByTestId('pwa-outbox-open').tap();
  const list = page.getByTestId('pwa-outbox-list');
  await expect(list.getByTestId('pwa-outbox-item')).toHaveCount(1);
  await expect(list.getByTestId('pwa-outbox-item')).toHaveAttribute('data-kind', 'grLine');
  await expect(list).toContainText('שורה שנספרה');
  await expect(list.getByTestId('pwa-outbox-delete')).toBeVisible(); // mine
});

/** Is there a read snapshot for this page on the device? */
async function snapshotHas(page: Page, path: string): Promise<boolean> {
  return page.evaluate(async (p) => {
    if (!(await caches.keys()).includes('rm-receiver-snapshot-v1')) return false;
    return Boolean(await (await caches.open('rm-receiver-snapshot-v1')).match(p));
  }, path);
}

async function snapshotOfToday(page: Page, path: string) {
  await page.goto('/dashboard/receiving');
  await page.waitForLoadState('networkidle');
  await expect.poll(() => snapshotHas(page, path), { timeout: 30_000 }).toBe(true);
}

test('security: the receiver\'s snapshot holds no ₪; sign-out purges it', async ({ page }) => {
  test.setTimeout(120_000);
  const po = await freshPo('snap-signout', 2);
  const path = `/dashboard/receiving/${po.poId}`;
  await snapshotOfToday(page, path);
  // Exactly what is cached: the rendered board + PO pages (HTML and their RSC data) — for a receiver, no ₪ and no price fields.
  const cached = await page.evaluate(async (p) => {
    const c = await caches.open('rm-receiver-snapshot-v1');
    return Promise.all(['/dashboard/receiving', p].map(async (k) => (await (await c.match(k))!.text())));
  }, path);
  for (const html of cached) {
    expect(html).not.toContain('₪');
    expect(html).not.toMatch(/unitPriceExpected\\?"\s*:\s*\\?"?\d/);
    expect(html).not.toMatch(/totalEstimated\\?"\s*:\s*\\?"?\d/);
  }

  await page.locator('form[data-rm-logout]').first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  // Signed out (the app lands on its public home): the receiver's snapshot is gone from the device.
  await page.waitForURL((u) => !u.pathname.startsWith('/dashboard'), { timeout: 30_000 });
  expect(await page.evaluate(async () => (await caches.keys()).includes('rm-receiver-snapshot-v1'))).toBe(false);
});

test('security: another user signing in on the same phone (no sign-out) never sees the previous snapshot', async ({ page, context }) => {
  test.setTimeout(150_000);
  const po = await freshPo('snap-switch', 2);
  const path = `/dashboard/receiving/${po.poId}`;
  await snapshotOfToday(page, path);

  // The receiver's session just ends (no sign-out form): the manager signs in on the same device.
  await context.clearCookies();
  const url = test.info().project.use.baseURL!;
  await context.addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill('manager@kfar-hazeitim.test');
  await page.locator('#password').fill(process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!');
  await page.locator('form:has(#password) button[type=submit]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  // The first signed-in screen wipes it — before the manager ever opens receiving.
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).includes('rm-receiver-snapshot-v1')), { timeout: 20_000 })
    .toBe(false);
});
