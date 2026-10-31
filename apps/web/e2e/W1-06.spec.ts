import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page, type Route } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * W1-06 · Delivery Check v1 and never losing field work — the receiver, on a
 * 390 px phone, on the real wizard (dev server, its own e2e DB). The e2e server
 * has no OCR worker: where an invoice is needed the test plays it (as in
 * receiving-review.spec.ts).
 */

const RECEIVER = 'receiver@kfar-hazeitim.test';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;
test.use(PHONE);

/** The receiver signs in once for the file. */
let receiverCookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> = [];
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  // The seeded password (the magic-link route is rate-limited per address).
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(RECEIVER);
  await page.locator('#password').fill(process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!');
  await page.locator('form:has(#password) button[type=submit]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  receiverCookies = await ctx.cookies();
  await ctx.close();
});

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Po {
  restaurantId: string;
  poId: string;
  lines: Array<{ poLineId: string; productId: string; name: string; qty: number; price: number; unit: string }>;
}

/** A fresh order: line 0 counted in units (stepper), the rest weighed (keypad). */
async function freshPo(tag: string, opts: { dockSlip?: boolean; lines?: number } = {}): Promise<Po> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) throw new Error('demo restaurant missing from the e2e DB');
    if (opts.dockSlip !== undefined) {
      // inventory.spec restores settings with `${text}::jsonb`, which postgres.js stores as a jsonb string.
      await sql`update restaurants
        set settings = jsonb_set(case jsonb_typeof(settings) when 'object' then settings when 'string' then (settings #>> '{}')::jsonb else '{}'::jsonb end, '{features,dockSlip}', to_jsonb(${opts.dockSlip}::boolean), true)
        where id = ${r.id}`;
    }
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${r.id} order by name limit 1`;
    const prods = await sql<{ id: string; name: string }[]>`
      select id, canonical_name as name from products
      where restaurant_id = ${r.id} and canonical_name ~ '[א-ת]' order by canonical_name limit ${opts.lines ?? 3}`;
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
      values (${r.id}, ${sup!.id}, now() + interval '1 hour', 'sent', 'manual', ${`e2e-w106-${tag}`}) returning id`;
    const lines: Po['lines'] = [];
    for (const [i, p] of prods.entries()) {
      const unit = i === 0 ? 'יח׳' : 'ק״ג';
      const qty = i === 0 ? 10 : 4 + i;
      const price = 12 + i;
      const [pl] = await sql<{ id: string }[]>`
        insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
        values (${po!.id}, ${p.id}, ${p.name}, ${qty}, ${unit}, ${price}) returning id`;
      lines.push({ poLineId: pl!.id, productId: p.id, name: p.name, qty, price, unit });
    }
    return { restaurantId: r.id, poId: po!.id, lines };
  } finally {
    await sql.end();
  }
}

async function grLines(poId: string) {
  const sql = e2eSql();
  try {
    return await sql<{ poLineId: string; qty: string; rejected: string; reason: string | null; notes: string | null; photos: unknown }[]>`
      select gl.po_line_id as "poLineId", gl.qty_received::text as qty, gl.qty_rejected::text as rejected,
             gl.reject_reason as reason, gl.condition_notes as notes, gl.photos
      from gr_lines gl join goods_receipts g on g.id = gl.gr_id where g.po_id = ${poId}`;
  } finally {
    await sql.end();
  }
}

/** Open a PO and wait until the wizard is interactive (a tap before hydration does nothing under `next dev`). */
async function openPo(page: Page, poId: string) {
  await page.goto(`/dashboard/receiving/${poId}`);
  await page.waitForLoadState('networkidle');
}

/** Every tap the receiver makes is counted through this. */
function tapper() {
  let taps = 0;
  return {
    async tap(loc: ReturnType<Page['locator']>) {
      taps += 1;
      await loc.tap();
    },
    /** A tap made by navigating (the PO link when the card is outside today's window). */
    add() {
      taps += 1;
    },
    get count() {
      return taps;
    },
  };
}

/**
 * The blind spot check before a bulk "as ordered" (owner decision 20): count
 * each picked line — as ordered, unless `count` says otherwise. The ordered
 * qty is not on the screen (a blind count), so the test reads it from `po`.
 */
async function passSpotCheck(
  page: Page,
  po: Po,
  opts: { taps?: ReturnType<typeof tapper>; count?: (line: Po['lines'][number]) => number } = {},
): Promise<string[]> {
  const panel = page.getByTestId('spot-check');
  await expect(panel).toBeVisible();
  // Blind: the panel never shows what was ordered.
  await expect(panel).not.toContainText('הוזמן');
  const rows = panel.getByTestId('spot-line');
  const picked: string[] = [];
  for (let i = 0; i < (await rows.count()); i += 1) {
    const id = (await rows.nth(i).getAttribute('data-key'))!.replace(/^po-/, '');
    const line = po.lines.find((l) => l.poLineId === id)!;
    picked.push(id);
    const input = rows.nth(i).getByTestId('spot-qty');
    if (opts.taps) await opts.taps.tap(input);
    await input.fill(String(opts.count ? opts.count(line) : line.qty));
  }
  const confirm = panel.getByTestId('spot-confirm');
  if (opts.taps) await opts.taps.tap(confirm);
  else await confirm.tap();
  return picked;
}

async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal'], ['[data-testid="worker-status-banner"]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}

/** Controls under 48×48 on the field screen (DoD-7). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-mode="field"] button, [data-mode="field"] input, [data-mode="field"] a[href]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden' || s.display === 'none') return false;
        if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') return false;
        if (el.tagName === 'A' && s.display === 'inline') return false;
        return r.height < 47.5 || r.width < 47.5;
      })
      .map((el) => `${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`),
  );
}

/** The 56 px primary sits in the bottom third of the viewport. */
async function expectPrimaryInThumbZone(page: Page, testId: string) {
  const vh = page.viewportSize()!.height;
  const box = (await page.getByTestId(testId).boundingBox())!;
  expect(box.height, `${testId} height`).toBeGreaterThanOrEqual(56);
  expect(box.y, `${testId} top in the bottom third (${vh})`).toBeGreaterThanOrEqual((vh * 2) / 3);
  expect(box.y + box.height, `${testId} on screen`).toBeLessThanOrEqual(vh);
}

/** Register the upload, report OCR queued (the test is the worker), tap "read the invoice". */
async function scanAndProcess(page: Page, poId: string): Promise<string> {
  let invoiceId = '';
  await page.route('**/api/trpc/receiving.registerInvoice**', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Array<{ result?: { data?: { json?: Record<string, unknown> } } }>;
    const json = body[0]?.result?.data?.json;
    if (json) {
      invoiceId = String(json.invoiceId);
      json.ocrQueued = true;
    }
    await route.fulfill({ response: res, json: body });
  });
  await openPo(page, poId);
  await page.getByTestId('scan-input').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.getByTestId('scan-process')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('scan-process').tap();
  await expect.poll(() => invoiceId, { timeout: 30_000 }).not.toBe('');
  return invoiceId;
}

async function finishOcrAsOrdered(invoiceId: string, po: Po, status: 'parsed' | 'matched' = 'parsed') {
  const sql = e2eSql();
  try {
    for (const l of po.lines) {
      await sql`insert into invoice_lines (invoice_id, product_id, raw_description, qty_billed, unit, unit_price_billed, line_total, ocr_confidence_line)
                values (${invoiceId}, ${l.productId}, ${l.name}, ${l.qty}, ${l.unit}, ${l.price}, ${Math.round(l.qty * l.price * 100) / 100}, 0.97)`;
    }
    await sql`update invoices set status = ${status}, ocr_confidence = 0.96, invoice_number = ${`W6-${invoiceId.slice(0, 6)}`}, total_incl_vat = 999 where id = ${invoiceId}`;
  } finally {
    await sql.end();
  }
}

test.beforeEach(async ({ page }) => {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  await page.context().addCookies(receiverCookies);
});

test('invoice 10 = order 10, 8 arrived: recorded as qty_received 8 in ≤4 taps; no signed URL kept as evidence', async ({ page }) => {
  test.setTimeout(180_000);
  const po = await freshPo('short');
  const invoiceId = await scanAndProcess(page, po.poId);
  await finishOcrAsOrdered(invoiceId, po);
  await expect(page.getByRole('heading', { name: 'תוצאת ההצלבה' })).toBeVisible({ timeout: 60_000 });
  // The receiver sees no ₪ (owner decision): quantities only, no prices or totals.
  await expect(page.locator('main')).not.toContainText('₪');
  // "Invoice = order" says so — it is not "arrived".
  await expect(page.getByText('החשבונית = ההזמנה').first()).toBeVisible();
  await page.getByTestId('continue-adjust').tap();

  const [units] = po.lines;
  const line = page.getByTestId('count-line').filter({ hasText: units!.name });
  await expect(line).toHaveAttribute('data-resolved', 'false');
  // Every line is countable — the invoice-equals-order line has its edit control.
  const taps = tapper();
  await taps.tap(line.getByTestId('count-edit'));
  await taps.tap(line.getByRole('button', { name: `הפחתת כמות — ${units!.name}` }));
  await taps.tap(line.getByRole('button', { name: `הפחתת כמות — ${units!.name}` }));
  await expect(line.getByRole('spinbutton', { name: new RegExp(`כמות שהתקבלה — ${units!.name}`) })).toHaveValue('8');
  expect(taps.count, 'short line taps').toBeLessThanOrEqual(4);
  await expect(line.getByTestId('line-save-state')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });

  await expectPrimaryInThumbZone(page, 'close-receipt');
  await page.getByTestId('mark-rest').tap();
  // Two lines left: the spot check counts both blind, so nothing is marked in bulk.
  expect((await passSpotCheck(page, po)).length).toBe(2);
  await expect(page.getByTestId('mark-rest-undo')).toHaveCount(0);
  await page.getByTestId('close-receipt').tap();
  await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 60_000 });

  const rows = await grLines(po.poId);
  const short = rows.find((r) => r.poLineId === units!.poLineId)!;
  expect(Number(short.qty)).toBe(8);
  for (const r of rows) {
    expect(r.photos, 'no invoice photo stored as line evidence').toEqual([]);
    if (r.poLineId !== units!.poLineId) {
      expect(Number(r.qty)).toBe(po.lines.find((l) => l.poLineId === r.poLineId)!.qty);
      expect(r.notes, 'counted blind in the spot check').toBe('count:spot_check');
    } else expect(r.notes, 'counted one by one: no method token').toBeNull();
  }
  const sql = e2eSql();
  try {
    const [gr] = await sql<{ sig: string | null; status: string }[]>`select signature_url as sig, status from goods_receipts where po_id = ${po.poId}`;
    expect(gr!.sig, 'the invoice photo is never a signature').toBeNull();
    expect(gr!.status).toBe('partial');
  } finally {
    await sql.end();
  }
  // The invoice page (and the scan) are full of ₪: the receiver gets no link to them.
  await expect(page.getByTestId('confirmed-invoice-link')).toHaveCount(0);
  await expect(page.getByTestId('receipt-confirmed')).not.toContainText('חיסכון');
  // Who received it is on the receipt.
  await expect(page.getByTestId('confirmed-received-by')).toContainText('התקבל ע״י');
  // …and still no ₪ for the receiver, the dock slip and its WhatsApp text included.
  await expect(page.locator('main')).not.toContainText('₪');
  const slipText = await page.getByTestId('dock-slip-copy').getAttribute('data-slip-text').catch(() => null);
  if (slipText) expect(slipText).not.toContain('₪');
});

test('no invoice, everything arrived: 3 taps + a 2-line blind spot check, recorded as bulk / spot check', async ({ page }) => {
  test.setTimeout(120_000);
  const po = await freshPo('all');
  const taps = tapper();
  await page.goto('/dashboard/receiving');
  await page.waitForLoadState('networkidle');
  const card = page.locator(`a[href="/dashboard/receiving/${po.poId}"]`);
  if (await card.count()) await taps.tap(card.first());
  else {
    // Near midnight the fresh PO can fall outside "today": open it directly, counted as the card tap.
    await openPo(page, po.poId);
    taps.add();
  }
  await page.waitForLoadState('networkidle');
  await expectPrimaryInThumbZone(page, 'scan-capture');
  // The live flow never offers a demo invoice; it offers "no invoice right now".
  await expect(page.getByTestId('scan-use-demo')).toHaveCount(0);
  await expect(page.getByTestId('scan-input')).toHaveAttribute('capture', 'environment');
  await expect(page.getByTestId('scan-input')).toHaveAttribute('accept', 'image/*');
  // No money in the receiver's page payload either: no PO prices, no order total.
  const html = await page.content();
  expect(html, 'no PO prices in the receiver payload').not.toMatch(/unitPriceExpected\\?"\s*:\s*\d/);
  expect(html, 'no order total in the receiver payload').not.toMatch(/totalEstimated\\?"\s*:\s*\d/);
  await taps.tap(page.getByTestId('scan-no-invoice'));
  await expect(page.getByTestId('delivery-check')).toBeVisible();
  // A step change moves focus to the step heading.
  await expect(page.locator(':focus')).toHaveText('בדיקת משלוח');
  await expectPrimaryInThumbZone(page, 'all-arrived');
  await expect(page.getByTestId('all-arrived')).toHaveText(new RegExp(`הכל הגיע כמו בהזמנה \\(${po.lines.length}\\)`));
  await taps.tap(page.getByTestId('all-arrived'));
  // Owner decision 20 (default): two random lines are counted blind before the bulk.
  const picked = await passSpotCheck(page, po, { taps });
  expect(picked).toHaveLength(2);
  await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 60_000 });
  // card · no invoice · all arrived = 3; the spot check adds 2 counts + 1 confirm.
  expect(taps.count, 'clean delivery taps').toBeLessThanOrEqual(6);
  for (const r of await grLines(po.poId)) {
    expect(Number(r.qty)).toBe(po.lines.find((l) => l.poLineId === r.poLineId)!.qty);
    expect(r.notes).toBe(picked.includes(r.poLineId) ? 'count:spot_check' : 'count:bulk_as_ordered');
  }
  // T4: the receipt says which lines were not counted one by one.
  await expect(page.getByTestId('confirmed-bulk-note')).toContainText('לא נספרו פריט-פריט');

  // Reopening a closed receipt shows what was counted — never a fresh scan step.
  await openPo(page, po.poId);
  await expect(page.getByTestId('receipt-summary')).toBeVisible();
  await expect(page.getByTestId('scan-capture')).toHaveCount(0);
  await expect(page.getByTestId('summary-bulk-tag')).toHaveCount(po.lines.length - 2);
});

test('"mark the rest" waits for the spot check: a match bulks with undo and a T4 tag; a gap bulks nothing', async ({ page }) => {
  test.setTimeout(150_000);
  for (const outcome of ['match', 'gap'] as const) {
    const po = await freshPo(`spot-${outcome}`, { lines: 5 });
    await openPo(page, po.poId);
    await page.getByTestId('scan-no-invoice').tap();
    const first = page.getByTestId('count-line').filter({ hasText: po.lines[0]!.name });
    await first.getByTestId('count-arrived').tap();
    await page.getByTestId('mark-rest').tap();
    // A gap on the first picked line: the count is kept, nothing else is assumed.
    let gapLine = '';
    const picked = await passSpotCheck(page, po, {
      count: (l) => {
        if (outcome !== 'gap' || gapLine) return l.qty;
        gapLine = l.poLineId;
        return l.qty - 2;
      },
    });
    expect(picked).toHaveLength(2);
    if (outcome === 'match') {
      await expect(page.getByTestId('mark-rest-undo')).toContainText('סומנו 2 שורות');
      await expect(page.getByTestId('count-bulk-tag')).toHaveCount(2);
      await expect(page.getByTestId('count-progress')).toHaveText('5 מתוך 5 אושרו');
      for (const r of await grLinesWhenSaved(po.poId, 5)) {
        const expected = r.poLineId === po.lines[0]!.poLineId ? null : picked.includes(r.poLineId) ? 'count:spot_check' : 'count:bulk_as_ordered';
        expect(r.notes, r.poLineId).toBe(expected);
      }
    } else {
      await expect(page.getByTestId('spot-mismatch')).toHaveText(/ספרו את השאר פריט-פריט/);
      await expect(page.getByTestId('mark-rest')).toHaveCount(0);
      await expect(page.getByTestId('count-bulk-tag')).toHaveCount(0);
      await expect(page.getByTestId('count-progress')).toHaveText('3 מתוך 5 אושרו');
      await expect(page.getByTestId('close-receipt')).toBeDisabled();
      const rows = await grLinesWhenSaved(po.poId, 3);
      const gap = rows.find((r) => r.poLineId === gapLine)!;
      expect(Number(gap.qty)).toBe(po.lines.find((l) => l.poLineId === gapLine)!.qty - 2);
      expect(rows.filter((r) => r.notes === 'count:bulk_as_ordered')).toHaveLength(0);
    }
  }
});

/** gr_lines once `n` of them hold a count (saves are debounced and async). */
async function grLinesWhenSaved(poId: string, n: number) {
  const counted = (r: Awaited<ReturnType<typeof grLines>>[number]) => Number(r.qty) > 0 || Boolean(r.reason) || Boolean(r.notes);
  await expect.poll(async () => (await grLines(poId)).filter(counted).length, { timeout: 20_000 }).toBe(n);
  return grLines(poId);
}

test('a reload mid-count restores every mark; "חסר" is 0 received, nothing rejected', async ({ page }) => {
  test.setTimeout(120_000);
  const po = await freshPo('reload', { dockSlip: true });
  await openPo(page, po.poId);
  await page.getByTestId('scan-no-invoice').tap();
  const [a, b] = po.lines;
  const lineA = page.getByTestId('count-line').filter({ hasText: a!.name });
  const lineB = page.getByTestId('count-line').filter({ hasText: b!.name });
  await lineA.getByTestId('count-arrived').tap();
  await lineB.getByTestId('count-edit').tap();
  await lineB.getByTestId('chip-missing').tap();
  await expect(lineB.getByTestId('chip-missing')).toHaveAttribute('aria-pressed', 'true');
  await lineB.getByTestId('count-done').tap();
  await expect(lineB.getByTestId('line-save-state')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
  await expect(page.getByTestId('count-progress')).toHaveText(`2 מתוך ${po.lines.length} אושרו`);
  await expect(page.getByRole('progressbar', { name: `2 מתוך ${po.lines.length} אושרו` })).toHaveAttribute('aria-valuenow', '2');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('delivery-check')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('count-resumed')).toBeVisible();
  await expect(page.getByTestId('count-progress')).toHaveText(`2 מתוך ${po.lines.length} אושרו`);
  await expect(page.getByTestId('count-line').filter({ hasText: b!.name }).getByTestId('count-line-result')).toHaveText('חסר');
  await expect(page.getByTestId('count-line').filter({ hasText: a!.name })).toHaveAttribute('data-resolved', 'true');

  const rowB = (await grLines(po.poId)).find((r) => r.poLineId === b!.poLineId)!;
  expect([Number(rowB.qty), Number(rowB.rejected), rowB.reason]).toEqual([0, 0, 'missing']);

  // The slip says "חסר", never "נפסל / פגום", for goods that never arrived.
  await page.getByTestId('mark-rest').tap();
  await passSpotCheck(page, po);
  await page.getByTestId('close-receipt').tap();
  const slip = page.getByTestId('dock-slip');
  await expect(slip).toBeVisible({ timeout: 60_000 });
  const text = (await slip.getByTestId('dock-slip-copy').getAttribute('data-slip-text'))!;
  expect(text).toContain('חסר:');
  expect(text).not.toContain('נפסל');
});

test('offline: marks are kept on the phone, the leave sheet stops a silent exit, and they sync once back online', async ({ page, context }) => {
  test.setTimeout(120_000);
  const po = await freshPo('offline');
  await openPo(page, po.poId);
  await page.getByTestId('scan-no-invoice').tap();
  await expect(page.getByTestId('delivery-check')).toBeVisible();
  const weighed = po.lines[1]!;
  const line = page.getByTestId('count-line').filter({ hasText: weighed.name });

  await context.setOffline(true);
  await line.getByTestId('count-edit').tap();
  // A weighed line takes a decimal comma and 3 decimals; far from the order it asks once.
  await line.getByTestId('count-qty').fill('2,125');
  await expect(line.getByTestId('count-tolerance')).toBeVisible();
  await line.getByTestId('count-confirm-qty').tap();
  await expect(line.getByTestId('line-save-state')).toHaveAttribute('data-state', 'queued', { timeout: 15_000 });
  await expect(line.getByTestId('line-save-state')).toHaveText('נשמר בטלפון');

  // Leaving with unsent counts asks first.
  await page.getByRole('link', { name: 'חזרה לרשימת המשלוחים' }).tap();
  await expect(page.getByTestId('leave-sheet')).toBeVisible();
  await page.getByTestId('leave-stay').tap();
  await expect(page).toHaveURL(new RegExp(`/dashboard/receiving/${po.poId}$`));

  // Going to scan the invoice while offline never strands the receiver: the
  // photo is kept on the phone and the count comes straight back, marks intact.
  await page.getByTestId('count-scan-invoice').tap();
  await page.getByTestId('scan-input').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.getByTestId('scan-process')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('scan-process').tap();
  await expect(page.getByTestId('delivery-check')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('count-line').filter({ hasText: weighed.name }).getByTestId('count-line-result')).toHaveText(/2\.125/);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(line.getByTestId('line-save-state')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
  const row = (await grLines(po.poId)).find((r) => r.poLineId === weighed.poLineId)!;
  expect(Number(row.qty)).toBe(2.125);

  // Everything is sent: ONE back press leaves — the guard's extra history entry is not a dead press.
  await page.goBack();
  await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain(po.poId);
});

test('a count on a line that is only on the invoice survives a reload', async ({ page }) => {
  test.setTimeout(180_000);
  const po = await freshPo('unordered');
  const invoiceId = await scanAndProcess(page, po.poId);
  // The supplier billed the order plus one item nobody ordered.
  const sql = e2eSql();
  let extra: { id: string; name: string } | undefined;
  try {
    [extra] = await sql<{ id: string; name: string }[]>`
      select id, canonical_name as name from products
      where restaurant_id = ${po.restaurantId} and canonical_name ~ '[א-ת]' order by canonical_name offset 10 limit 1`;
    await sql`insert into invoice_lines (invoice_id, product_id, raw_description, qty_billed, unit, unit_price_billed, line_total, ocr_confidence_line)
              values (${invoiceId}, ${extra!.id}, ${extra!.name}, 6, 'ק״ג', 9, 54, 0.97)`;
  } finally {
    await sql.end();
  }
  await finishOcrAsOrdered(invoiceId, po);
  await expect(page.getByRole('heading', { name: 'תוצאת ההצלבה' })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('continue-adjust').tap();
  const line = page.getByTestId('count-line').filter({ hasText: extra!.name });
  // Billed but not ordered: nothing is assumed to have arrived.
  await expect(line).toHaveAttribute('data-resolved', 'false');
  if (await line.getByTestId('count-edit').count()) await line.getByTestId('count-edit').tap();
  await line.getByTestId('count-qty').fill('4');
  await line.getByTestId('count-qty').press('Enter');
  if (await line.getByTestId('count-confirm-qty').count()) await line.getByTestId('count-confirm-qty').tap();
  await expect(line).toHaveAttribute('data-resolved', 'true');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('delivery-check')).toBeVisible({ timeout: 60_000 });
  const again = page.getByTestId('count-line').filter({ hasText: extra!.name });
  await expect(again).toHaveAttribute('data-resolved', 'true');
  await expect(again.getByTestId('count-line-result')).toHaveText(/^4/);
});

test('the session expires mid-count: the sign-in sheet opens (never "no connection"), and the count is sent after signing in', async ({ page, context }) => {
  test.setTimeout(150_000);
  const po = await freshPo('reauth');
  await openPo(page, po.poId);
  await page.getByTestId('scan-no-invoice').tap();
  const [a, b] = po.lines;
  const lineA = page.getByTestId('count-line').filter({ hasText: a!.name });
  await lineA.getByTestId('count-arrived').tap();
  await expect(lineA.getByTestId('line-save-state')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });

  // The session ends while the receiver keeps counting (cookies gone; the page stays).
  const url = test.info().project.use.baseURL!;
  await context.clearCookies();
  await context.addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  const lineB = page.getByTestId('count-line').filter({ hasText: b!.name });
  await lineB.getByTestId('count-arrived').tap();
  const sheet = page.getByTestId('reauth-sheet');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  // Kept on the phone — and nothing claims the phone is offline.
  await expect(lineB.getByTestId('line-save-state')).toHaveAttribute('data-state', 'queued');
  await expect(page.getByText('אין חיבור')).toHaveCount(0);

  const email = sheet.locator('#reauth-email');
  if (await email.isEditable()) await email.fill(RECEIVER);
  await sheet.locator('#reauth-password').fill(process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!');
  await sheet.locator('form button[type="submit"]').click();
  await expect(sheet).toBeHidden({ timeout: 30_000 });
  // Signed in again: the queued line goes at once (no waiting for the 15 s timer).
  await expect(lineB.getByTestId('line-save-state')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
  const row = (await grLines(po.poId)).find((r) => r.poLineId === b!.poLineId)!;
  expect(Number(row.qty)).toBe(b!.qty);
});

test('a receipt closed elsewhere and reopened: the offline count from before is HELD — never replayed over the record', async ({ page, context }) => {
  test.setTimeout(180_000);
  const po = await freshPo('stale');
  await openPo(page, po.poId);
  await page.getByTestId('scan-no-invoice').tap();
  const weighed = po.lines[1]!;
  const phoneQty = weighed.qty + 5;
  const recordQty = weighed.qty - 2;
  const line = page.getByTestId('count-line').filter({ hasText: weighed.name });
  await expect(line).toBeVisible({ timeout: 30_000 });
  // A counts in the walk-in with no signal: the row stays on the phone.
  await context.setOffline(true);
  await line.getByTestId('count-edit').tap();
  await line.getByTestId('count-qty').fill(String(phoneQty));
  if (await line.getByTestId('count-confirm-qty').isVisible().catch(() => false)) await line.getByTestId('count-confirm-qty').tap();
  await expect(line.getByTestId('line-save-state')).toHaveAttribute('data-state', 'queued', { timeout: 15_000 });
  await page.close({ runBeforeUnload: false });

  // Meanwhile B counts on the office tablet and closes the receipt as partial;
  // next day W1-05's "follow-up delivery" reopens the same receipt.
  const sql = e2eSql();
  try {
    await sql`update gr_lines gl set qty_received = ${recordQty} from goods_receipts g
              where g.id = gl.gr_id and g.po_id = ${po.poId} and gl.po_line_id = ${weighed.poLineId}`;
    await sql`update goods_receipts set status = 'partial', updated_at = now() where po_id = ${po.poId}`;
    await sql`update goods_receipts set status = 'pending', updated_at = now() + interval '1 second' where po_id = ${po.poId}`;
  } finally {
    await sql.end();
  }

  await context.setOffline(false);
  const again = await context.newPage();
  await openPo(again, po.poId);
  await expect(again.getByTestId('delivery-check')).toBeVisible({ timeout: 30_000 });
  // HELD: shown with both numbers for A to decide — not sent, not shown as the count.
  const held = again.getByTestId('held-line');
  await expect(held).toHaveCount(1);
  await expect(held).toContainText(String(phoneQty));
  await expect(held).toContainText(String(recordQty));
  await again.waitForTimeout(2_000); // past the debounce and the immediate retry
  const record = async () => Number((await grLines(po.poId)).find((r) => r.poLineId === weighed.poLineId)!.qty);
  expect(await record(), "B's count, the one the match and claims used, is untouched").toBe(recordQty);
  await expect(again.getByTestId('count-line').filter({ hasText: weighed.name }).getByTestId('count-line-result')).toHaveText(new RegExp(`^${recordQty}\\b`));

  // A applies the phone count: it becomes this cycle's count, sent like any other.
  await held.getByTestId('held-apply').tap();
  await expect(again.getByTestId('held-counts')).toHaveCount(0);
  await expect.poll(record, { timeout: 15_000 }).toBe(phoneQty);
});

test('field mode: bar in the bottom third at 390×844 and 375×667, 48 px targets, axe clean (he + en)', async ({ page }) => {
  test.setTimeout(180_000);
  let po = await freshPo('field');
  for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    po = await freshPo(`field-${vp.width}`); // a fresh order opens on the capture step
    await page.setViewportSize(vp);
    await openPo(page, po.poId);
    await expectPrimaryInThumbZone(page, 'scan-capture');
    expect(await smallTargets(page), `scan ${vp.width}`).toEqual([]);
    expect(await axe(page), `scan axe ${vp.width}`).toEqual([]);
    await page.getByTestId('scan-no-invoice').tap();
    await expect(page.getByTestId('delivery-check')).toBeVisible();
    await expectPrimaryInThumbZone(page, 'all-arrived');
    await page.getByTestId('all-arrived').tap();
    await expect(page.getByTestId('spot-check')).toBeVisible();
    await expectPrimaryInThumbZone(page, 'spot-confirm');
    expect(await smallTargets(page), `spot check ${vp.width}`).toEqual([]);
    expect(await axe(page), `spot check axe ${vp.width}`).toEqual([]);
    await page.getByTestId('spot-cancel').tap();
    await page.getByTestId('count-line').first().getByTestId('count-edit').tap();
    expect(await smallTargets(page), `count ${vp.width}`).toEqual([]);
    expect(await axe(page), `count axe ${vp.width}`).toEqual([]);
    // Chips say their state; the editor toggle says it is open.
    await expect(page.getByTestId('chip-missing').first()).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('count-done').first()).toHaveAttribute('aria-expanded', 'true');
  }
  // English, same screen.
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([{ name: 'rm_locale', value: 'en', url }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPo(page, po.poId);
  await expect(page.getByTestId('delivery-check')).toBeVisible({ timeout: 30_000 }); // resumed: the receipt exists
  expect(await axe(page), 'count axe en').toEqual([]);
  await expect(page.getByTestId('count-progress')).toContainText('checked');
});

test('the dock slip shows ₪ left of the digits in Hebrew (no LTR isolate, no mono)', async ({ page }) => {
  test.setTimeout(180_000);
  // ₪ is for the owner / manager — sign in as the owner for this one.
  const owner = JSON.parse(readFileSync(OWNER_STATE, 'utf8')) as { cookies: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0] };
  await page.context().clearCookies();
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    ...owner.cookies,
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  const po = await freshPo('money', { dockSlip: true });
  const invoiceId = await scanAndProcess(page, po.poId);
  await finishOcrAsOrdered(invoiceId, po, 'matched');
  await expect(page.getByRole('heading', { name: 'תוצאת ההצלבה' })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('continue-adjust').tap();
  await page.getByTestId('all-arrived').tap();
  await passSpotCheck(page, po);
  await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 60_000 });
  // The owner's Confirmed links to the invoice page — never to a signed URL.
  await expect(page.getByTestId('confirmed-invoice-link')).toHaveAttribute('href', `/dashboard/invoices/${invoiceId}`);
  // Play the engine's post-count run: one VAT finding with a ₪ amount.
  const sql = e2eSql();
  try {
    const [gr] = await sql<{ id: string }[]>`select id from goods_receipts where po_id = ${po.poId} limit 1`;
    const [run] = await sql<{ id: string }[]>`
      insert into match_runs (restaurant_id, po_id, gr_id, invoice_id, overall_status, run_at)
      values (${po.restaurantId}, ${po.poId}, ${gr!.id}, ${invoiceId}, 'minor', now() + interval '1 second') returning id`;
    await sql`insert into discrepancies (match_run_id, restaurant_id, type, severity, expected_value, actual_value, delta_amount)
              values (${run!.id}, ${po.restaurantId}, 'VAT_MISMATCH', 'warn', 0, 1234.5, 1234.5)`;
  } finally {
    await sql.end();
  }
  const total = page.getByTestId('dock-slip-total');
  await expect(total).toBeVisible({ timeout: 30_000 });
  const pos = await total.evaluate((el) => {
    const bdi = el.querySelector('bdi')!;
    const text = bdi.textContent ?? '';
    const node = [...bdi.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!;
    const rangeAt = (i: number) => {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      return r.getBoundingClientRect();
    };
    const shekel = rangeAt(text.indexOf('₪'));
    const firstDigit = rangeAt(text.search(/\d/));
    return { shekelRight: shekel.right, digitLeft: firstDigit.left, dir: bdi.getAttribute('dir'), font: getComputedStyle(bdi).fontFamily };
  });
  expect(pos.dir).toBeNull();
  expect(pos.font).not.toMatch(/mono/i);
  expect(pos.shekelRight).toBeLessThanOrEqual(pos.digitLeft + 0.5);
});

test('sign-out with a queued invoice photo offline: a sheet names the count; "wait" keeps it', async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = e2eSql();
  let userId = '';
  let restaurantId = '';
  try {
    const [u] = await sql<{ id: string; rid: string }[]>`
      select u.id, m.restaurant_id as rid from users u join memberships m on m.user_id = u.id
      join restaurants r on r.id = m.restaurant_id where u.email = ${RECEIVER} and r.name = ${DEMO_RESTAURANT_NAME} limit 1`;
    userId = u!.id;
    restaurantId = u!.rid;
  } finally {
    await sql.end();
  }
  await page.goto('/dashboard/receiving');
  // One photo shot offline in the walk-in, waiting in the device queue.
  await page.evaluate(
    ({ userId, restaurantId }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('restomatch-receiver', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'clientUploadId' });
        req.onsuccess = () => {
          const tx = req.result.transaction('photos', 'readwrite');
          tx.objectStore('photos').put({
            clientUploadId: '11111111-1111-4111-8111-111111111111',
            restaurantId,
            userId,
            poId: '00000000-0000-4000-8000-000000000000',
            supplierId: '00000000-0000-4000-8000-000000000000',
            supplierName: 'e2e',
            mimeType: 'image/png',
            blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
            createdAt: Date.now(),
            attempts: 0,
            lastError: null,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    { userId, restaurantId },
  );
  await context.setOffline(true);
  const form = page.locator('form[data-rm-logout]').first();
  await form.evaluate((f: HTMLFormElement) => f.requestSubmit());
  const sheet = page.getByTestId('logout-queue-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('1 צילומי חשבונית עוד לא נשלחו');
  await page.getByTestId('logout-wait').tap();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard\/receiving/);
  const left = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('restomatch-receiver', 1);
        req.onsuccess = () => {
          const r = req.result.transaction('photos').objectStore('photos').count();
          r.onsuccess = () => resolve(r.result);
        };
      }),
  );
  expect(left, 'the queued photo was not deleted').toBe(1);
  await context.setOffline(false);
});

test('CLS on the deliveries list and the Delivery Check stays ≤ 0.05 at 4× CPU', async ({ page }) => {
  test.setTimeout(120_000);
  const po = await freshPo('cls');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const path of ['/dashboard/receiving', `/dashboard/receiving/${po.poId}`]) {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2_500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, `CLS ${path}`).toBeLessThanOrEqual(0.05);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});
