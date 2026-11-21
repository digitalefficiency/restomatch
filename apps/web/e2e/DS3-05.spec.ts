import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { DEMO_RESTAURANT_NAME } from './env';
import { collectPageErrors, e2eSql, HEBREW } from './helpers';

/**
 * DS3-05 · Delivery check on a phone (docs/ux/ds3/SPEC.md §10.3) — the receiver
 * on a phone, on the real wizard (dev server, its own e2e DB).
 *
 * Part 1, the look and interaction, in today's order of steps (flag
 * `dockCountFirst` OFF): one row per item, the tick at the thumb's side, the
 * pencil and the number-pad sheet, the button that always says the next step,
 * the short check before closing when there is a gap, the end screen.
 *
 * Part 2, behind `dockCountFirst` ON (an open owner decision): the count is the
 * first screen, the quantity sheet opens empty, the document is photographed
 * after the count, and the receipt starts on the first real action — never on
 * page view.
 */

const RECEIVER = 'receiver@kfar-hazeitim.test';
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let receiverCookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> = [];
let restaurantId = '';
/** The demo's `features.dockCountFirst` before this file ran (null = not set: `features.all` decides). */
let countFirstBefore: boolean | null = null;

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
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string; prev: string | null }[]>`
      select id, (case jsonb_typeof(settings) when 'object' then settings when 'string' then (settings #>> '{}')::jsonb else '{}'::jsonb end) #>> '{features,dockCountFirst}' as prev
      from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) throw new Error('demo restaurant missing from the e2e DB');
    restaurantId = r.id;
    countFirstBefore = r.prev === null ? null : r.prev === 'true';
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  if (restaurantId) await setCountFirst(countFirstBefore);
});

test.beforeEach(async ({ context }) => {
  const url = test.info().project.use.baseURL!;
  await context.addCookies([
    ...receiverCookies,
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
});

/** `features.dockCountFirst` on the demo restaurant: on, off, or null to drop it (back to `features.all`). */
async function setCountFirst(value: boolean | null) {
  const sql = e2eSql();
  try {
    if (value === null) {
      await sql`update restaurants
        set settings = (case jsonb_typeof(settings) when 'object' then settings when 'string' then (settings #>> '{}')::jsonb else '{}'::jsonb end) #- '{features,dockCountFirst}'
        where id = ${restaurantId}`;
    } else {
      await sql`update restaurants
        set settings = jsonb_set(case jsonb_typeof(settings) when 'object' then settings when 'string' then (settings #>> '{}')::jsonb else '{}'::jsonb end, '{features,dockCountFirst}', to_jsonb(${value}::boolean), true)
        where id = ${restaurantId}`;
    }
  } finally {
    await sql.end();
  }
}

interface Po {
  poId: string;
  lines: Array<{ poLineId: string; name: string; qty: number; unit: string }>;
}

/** A fresh order: line 0 counted in units, the rest weighed in kilos (5, 6, … kg). */
async function freshPo(tag: string, n = 3): Promise<Po> {
  const sql = e2eSql();
  try {
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${restaurantId} order by name limit 1`;
    const prods = await sql<{ id: string; name: string }[]>`
      select id, canonical_name as name from products
      where restaurant_id = ${restaurantId} and canonical_name ~ '[א-ת]' order by canonical_name offset 20 limit ${n}`;
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
      values (${restaurantId}, ${sup!.id}, now() + interval '1 hour', 'sent', 'manual', ${`e2e-ds305-${tag}`}) returning id`;
    const lines: Po['lines'] = [];
    for (const [i, p] of prods.entries()) {
      const unit = i === 0 ? 'יח׳' : 'ק״ג';
      const qty = i === 0 ? 10 : 4 + i;
      const [pl] = await sql<{ id: string }[]>`
        insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
        values (${po!.id}, ${p.id}, ${p.name}, ${qty}, ${unit}, ${12 + i}) returning id`;
      lines.push({ poLineId: pl!.id, name: p.name, qty, unit });
    }
    return { poId: po!.id, lines };
  } finally {
    await sql.end();
  }
}

async function receiptOf(poId: string) {
  const sql = e2eSql();
  try {
    const [gr] = await sql<{ id: string; status: string }[]>`select id, status from goods_receipts where po_id = ${poId}`;
    const lines = gr
      ? await sql<{ poLineId: string; qty: string; notes: string | null }[]>`
          select po_line_id as "poLineId", qty_received::text as qty, condition_notes as notes from gr_lines where gr_id = ${gr.id}`
      : [];
    // The invoice a receipt read is linked by an audit row on the receipt (receiving/invoiceLink.ts).
    const invoices = gr
      ? await sql<{ id: string }[]>`select after->>'invoiceId' as id from audit_log where action = 'goods_receipt.invoice_registered' and entity_id = ${gr.id}`
      : [];
    return { gr: gr ?? null, lines, invoices };
  } finally {
    await sql.end();
  }
}

async function openPo(page: Page, poId: string) {
  await page.goto(`/dashboard/receiving/${poId}`);
  await page.waitForLoadState('networkidle');
}

const row = (page: Page, name: string) => page.getByTestId('count-line').filter({ hasText: name });

/** Type on the product's own pad (never the phone keyboard). */
async function pad(line: Locator, keys: string) {
  for (const k of keys) await line.getByTestId('dock-keypad').locator(`[data-key="${k}"]`).tap();
}

/** The blind spot check: every picked line counted as ordered. */
async function passSpotCheck(page: Page, po: Po) {
  const panel = page.getByTestId('spot-check');
  await expect(panel).toBeVisible();
  await expect(panel, 'blind: the order is not on the spot check').not.toContainText('הוזמן');
  const rows = panel.getByTestId('spot-line');
  for (let i = 0; i < (await rows.count()); i += 1) {
    const id = (await rows.nth(i).getAttribute('data-key'))!.replace(/^po-/, '');
    await rows.nth(i).getByTestId('spot-qty').fill(String(po.lines.find((l) => l.poLineId === id)!.qty));
  }
  await page.getByTestId('spot-confirm').tap();
}

/** axe, serious and critical only, the WCAG 2.2 AA tags — the same run as W1-06's (helpers.ts is shared, so a copy). */
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
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

/** Controls under 44 px (SPEC §5) and anything wider than the screen. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const doc = document.scrollingElement ?? document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`page scrolls sideways: ${doc.scrollWidth} > ${doc.clientWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>('[data-mode="field"] button, [data-mode="field"] input, [data-mode="field"] a[href]')) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden' || s.display === 'none' || el.closest('.sr-only')) continue;
      if (el instanceof HTMLInputElement && ['file', 'hidden'].includes(el.type)) continue;
      if (el.tagName === 'A' && s.display === 'inline') continue;
      if (el instanceof HTMLInputElement && el.type === 'checkbox' && [...(el.labels ?? [])].some((l) => l.getBoundingClientRect().height >= 44)) continue;
      if (r.width < 44 || r.height < 44) out.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (r.right > window.innerWidth + 1 || r.left < -1) out.push(`${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}" leaves the screen`);
    }
    return out;
  });
}

test.describe('flag off — today\'s order of steps, the new look', () => {
  test.beforeAll(async () => {
    await setCountFirst(false);
  });

  test('the row, the thumb-side tick, the number-pad sheet, the check before closing and the end screen', async ({ page }) => {
    test.setTimeout(180_000);
    const po = await freshPo('look');
    const errors = collectPageErrors(page);
    await openPo(page, po.poId);
    // Today's order: the photo first.
    await expect(page.getByTestId('scan-capture')).toBeVisible();
    await page.getByTestId('scan-no-invoice').tap();
    const check = page.getByTestId('delivery-check');
    await expect(check).toBeVisible();
    await expect(check).toHaveAttribute('data-count-first', 'false');
    await expect(page.locator(':focus')).toHaveText('בדיקת משלוח');
    await expect(page.getByTestId('count-line')).toHaveCount(3);
    await expect(page.getByTestId('all-arrived')).toHaveText(/הכול הגיע כמו בהזמנה \(3\)/);

    // The tick: 64 px, at the thumb's side (the start edge — the right in Hebrew); the pencil at the other edge.
    const [units, kilos, other] = po.lines;
    const first = row(page, units!.name);
    const tick = first.getByTestId('count-arrived');
    const tickBox = (await tick.boundingBox())!;
    expect(tickBox.width).toBeGreaterThanOrEqual(64);
    expect(tickBox.x + tickBox.width / 2, 'tick on the right half').toBeGreaterThan(390 / 2);
    const pencilBox = (await first.getByTestId('count-edit').boundingBox())!;
    expect(pencilBox.x + pencilBox.width / 2, 'pencil on the left half').toBeLessThan(390 / 2);
    // Marking never moves the next row under the finger.
    const before = (await first.boundingBox())!.height;
    await tick.tap();
    await expect(tick).toHaveAttribute('aria-pressed', 'true');
    expect((await first.boundingBox())!.height).toBe(before);
    await expect(page.getByTestId('mark-rest')).toHaveText(/סמנו את השאר \(2\)/);

    // The quantity sheet: today's order opens on the ordered quantity, selected — the first key replaces it.
    const second = row(page, kilos!.name);
    await second.getByTestId('count-edit').tap();
    const sheet = second.getByRole('dialog', { name: 'כמה הגיע?' });
    await expect(sheet).toBeVisible();
    await expect(second.getByTestId('count-qty')).toHaveValue(String(kilos!.qty));
    await pad(second, '2');
    await expect(second.getByTestId('count-qty')).toHaveValue('2');
    // Far from the order: a plain statement above the field.
    await expect(second.getByTestId('count-tolerance')).toContainText('מההזמנה');
    await pad(second, '.5');
    await expect(second.getByTestId('count-done')).toHaveText(/אישור: 2\.5/);
    await second.getByTestId('count-done').tap();
    await expect(sheet).toBeHidden();
    // Saving returns focus to the row.
    await expect(second.getByTestId('count-edit')).toBeFocused();
    await expect(second.getByTestId('count-line-result')).toHaveText('2.5');
    await expect(second).toHaveAttribute('data-state', 'gap');

    // Closing the sheet saves nothing.
    const third = row(page, other!.name);
    await third.getByTestId('count-edit').tap();
    await pad(third, '9');
    await page.keyboard.press('Escape');
    await expect(third.getByRole('dialog')).toBeHidden();
    await expect(third).toHaveAttribute('data-resolved', 'false');

    // The rest: the blind spot check, then the check before closing (there is a gap), then the end screen.
    await page.getByTestId('mark-rest').tap();
    await passSpotCheck(page, po);
    await page.getByTestId('close-receipt').tap();
    const before2 = page.getByTestId('close-check');
    await expect(before2).toBeVisible();
    await expect(before2).toContainText(kilos!.name);
    await expect(before2).toContainText('רשמו את הפער גם על תעודת המשלוח');
    await page.getByTestId('close-confirm').tap();
    const done = page.getByTestId('receipt-confirmed');
    await expect(done).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('confirmed-summary')).toHaveText(/3 פריטים, פער אחד/);
    await expect(done.getByTestId('gap-line')).toHaveCount(1);
    await expect(page.locator('main'), 'no ₪ for the receiver').not.toContainText('₪');

    const rec = await receiptOf(po.poId);
    expect(Number(rec.lines.find((l) => l.poLineId === kilos!.poLineId)!.qty)).toBe(2.5);
    expect(rec.gr?.status, 'a short line closes the receipt as partial').toBe('partial');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('360 px: every control at least 44 px, nothing leaves the screen — count, sheet, spot check', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 740 });
    const po = await freshPo('narrow');
    await openPo(page, po.poId);
    await page.getByTestId('scan-no-invoice').tap();
    await expect(page.getByTestId('delivery-check')).toBeVisible();
    expect(await layoutProblems(page), 'count').toEqual([]);
    await row(page, po.lines[1]!.name).getByTestId('count-edit').tap();
    await expect(page.getByRole('dialog', { name: 'כמה הגיע?' })).toBeVisible();
    expect(await layoutProblems(page), 'quantity sheet').toEqual([]);
    // A gap on that line (1 of 5 kg), saved on the sheet's button.
    const gapLine = row(page, po.lines[1]!.name);
    await pad(gapLine, '1');
    await gapLine.getByTestId('count-done').tap();
    await expect(gapLine).toHaveAttribute('data-state', 'gap');
    await page.getByTestId('mark-rest').tap();
    await expect(page.getByTestId('spot-check')).toBeVisible();
    expect(await layoutProblems(page), 'spot check').toEqual([]);
    await passSpotCheck(page, po);
    // The check before closing, then the end screen: the same rules, and axe clean.
    await page.getByTestId('close-receipt').tap();
    await expect(page.getByTestId('close-check')).toBeVisible();
    await expect(page.getByTestId('close-check'), 'the check opens on its content, not on the grabber').toBeFocused();
    expect(await layoutProblems(page), 'check before closing').toEqual([]);
    expect(await axe(page), 'check before closing axe').toEqual([]);
    await page.getByTestId('close-confirm').tap();
    await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 60_000 });
    expect(await layoutProblems(page), 'end screen').toEqual([]);
    expect(await axe(page), 'end screen axe').toEqual([]);
  });

  test('a dialog stacked on the quantity sheet (the sign-in sheet) keeps its own keys: no digit and no Enter reach the count', async ({ page }) => {
    test.setTimeout(120_000);
    const po = await freshPo('stacked');
    await openPo(page, po.poId);
    await page.getByTestId('scan-no-invoice').tap();
    const kilos = row(page, po.lines[1]!.name);
    await kilos.getByTestId('count-edit').tap();
    const sheet = kilos.getByRole('dialog', { name: 'כמה הגיע?' });
    await expect(sheet).toBeVisible();
    await expect(kilos.getByTestId('count-qty')).toHaveValue(String(po.lines[1]!.qty));
    // A modal with a field opens on top, as the session's sign-in sheet does after a 401.
    await page.evaluate(() => {
      const d = document.createElement('dialog');
      d.id = 'stacked';
      const input = document.createElement('input');
      input.id = 'stacked-input';
      d.append(input);
      document.body.append(d);
      d.showModal();
      input.focus();
    });
    await page.keyboard.type('2026');
    await page.keyboard.press('Enter');
    await expect(page.locator('#stacked-input')).toHaveValue('2026');
    await expect(kilos.getByTestId('count-qty'), 'the count underneath is untouched').toHaveValue(String(po.lines[1]!.qty));
    await expect(sheet, 'Enter in the other dialog did not save the count').toBeVisible();
    await page.evaluate(() => (document.getElementById('stacked') as HTMLDialogElement).close());
    await expect(kilos).toHaveAttribute('data-resolved', 'false');
  });

  test('a short phone (360 × 640): the sheet fits with its note, keys stay ≥44 px, and none moves when the note appears', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 640 });
    const po = await freshPo('short');
    await openPo(page, po.poId);
    await page.getByTestId('scan-no-invoice').tap();
    await expect(page.getByTestId('delivery-check')).toBeVisible();
    const kilos = row(page, po.lines[1]!.name);
    await kilos.getByTestId('count-edit').tap();
    const sheet = kilos.getByRole('dialog', { name: 'כמה הגיע?' });
    await expect(sheet).toBeVisible();
    const keys = kilos.getByTestId('dock-keypad').locator('button');
    // Measured against the dialog, so the sheet's own rise never counts as a move.
    const inSheet = async (l: Locator) => {
      const [b, s] = [(await l.boundingBox())!, (await sheet.boundingBox())!];
      return { top: Math.round(b.y - s.y), bottom: Math.round(b.y + b.height - s.y), height: b.height };
    };
    const first = await inSheet(keys.first());
    expect(first.height, 'a key is at least 44 px').toBeGreaterThanOrEqual(44);
    expect((await inSheet(keys.last())).bottom, 'the last row of keys sits above the button').toBeLessThanOrEqual((await inSheet(kilos.getByTestId('count-done'))).top);
    // The ordered quantity is selected: "1" replaces it — far from the order, so the note appears.
    await pad(kilos, '1');
    await expect(kilos.getByTestId('count-tolerance')).toBeVisible();
    expect((await inSheet(keys.first())).top, 'no key moved when the note appeared').toBe(first.top);
    expect(await layoutProblems(page), 'quantity sheet with its note').toEqual([]);
  });
});

test.describe('flag on — the count comes first', () => {
  test.beforeAll(async () => {
    await setCountFirst(true);
  });

  test('the count is the first screen, the field opens empty, the receipt starts on the first mark, the photo comes after', async ({ page }) => {
    test.setTimeout(180_000);
    const po = await freshPo('first');
    const errors = collectPageErrors(page);
    await openPo(page, po.poId);
    const check = page.getByTestId('delivery-check');
    await expect(check).toBeVisible();
    await expect(check).toHaveAttribute('data-count-first', 'true');
    await expect(page.getByTestId('scan-capture')).toHaveCount(0);
    // Looking is not receiving: no receipt on page view.
    expect((await receiptOf(po.poId)).gr).toBeNull();

    // The quantity sheet opens empty: the receiver writes what is on the dock.
    const [units] = po.lines;
    const first = row(page, units!.name);
    await first.getByTestId('count-edit').tap();
    await expect(first.getByTestId('count-qty')).toHaveValue('');
    await expect(first.getByTestId('count-done')).toBeDisabled();
    await pad(first, '10');
    await expect(first.getByTestId('count-done')).toHaveText(/אישור: 10/);
    await first.getByTestId('count-done').tap();
    await expect(first.getByTestId('count-line-result')).toHaveText('10');
    // The first mark started the receipt and saved the count.
    await expect
      .poll(async () => (await receiptOf(po.poId)).lines.find((l) => l.poLineId === units!.poLineId)?.qty, { timeout: 20_000 })
      .toBe('10.000');

    // The rest, then the check before closing asks for the document.
    await page.getByTestId('mark-rest').tap();
    await passSpotCheck(page, po);
    await expect(page.getByTestId('count-status')).toHaveText('הכול סומן, נשאר לצלם את המסמך');
    await page.getByTestId('close-receipt').tap();
    await expect(page.getByTestId('close-check-doc')).toHaveText('עוד לא צולם');
    await page.getByTestId('close-photo').tap();

    // The photo after the count: registered, never read on screen, then the receipt closes.
    // From here on the screen never asks the server for the invoice's reading (the count stays blind).
    const reads: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('receiving.getInvoice')) reads.push(r.url());
    });
    await page.getByTestId('scan-input').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: TINY_PNG });
    await expect(page.getByTestId('scan-process')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('scan-process').tap();
    const done = page.getByTestId('receipt-confirmed');
    await expect(done).toBeVisible({ timeout: 60_000 });
    // Photographed after the count: read in the background, after the close ("לא צולם" would fail this).
    await expect(page.getByTestId('confirmed-doc')).toContainText('צולם, נקרא ברקע');
    await expect(page.getByTestId('confirmed-doc')).not.toContainText('לא צולם');
    expect(reads, 'the invoice is never read on screen while counting').toEqual([]);
    await expect.poll(async () => (await receiptOf(po.poId)).gr?.status, { timeout: 30_000 }).toBe('completed');
    expect((await receiptOf(po.poId)).invoices.length).toBe(1);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('closing without a signal: the end screen says it goes when the connection returns', async ({ page, context }) => {
    test.setTimeout(180_000);
    const po = await freshPo('offline', 2);
    await openPo(page, po.poId);
    await row(page, po.lines[0]!.name).getByTestId('count-arrived').tap();
    await expect.poll(async () => (await receiptOf(po.poId)).gr?.status, { timeout: 20_000 }).toBe('pending');
    await row(page, po.lines[1]!.name).getByTestId('count-arrived').tap();
    await expect(row(page, po.lines[1]!.name).getByTestId('line-save-state')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
    await context.setOffline(true);
    await page.getByTestId('close-receipt').tap();
    await page.getByTestId('close-nodoc').tap();
    const done = page.getByTestId('receipt-confirmed');
    await expect(done).toBeVisible({ timeout: 30_000 });
    await expect(done).toHaveAttribute('data-queued', 'true');
    await expect(done.getByRole('heading', { level: 1 })).toHaveText('קבלת הסחורה נסגרה בטלפון');
    await expect(page.getByTestId('close-queued')).toHaveText('אוטומטית, כשהחיבור יחזור');
    await expect(page.getByTestId('confirmed-doc')).toContainText('לא צולם');
    await context.setOffline(false);
  });

  test('a count made while the receipt cannot start stays on the phone, asks before leaving, comes back after a reload and joins the receipt', async ({ page }) => {
    test.setTimeout(150_000);
    const po = await freshPo('kept');
    // The start cannot reach the server (as with no signal at the first mark); everything else can.
    const noStart = (r: Route) => (r.request().url().includes('receiving.startReceipt') ? r.abort('internetdisconnected') : r.continue());
    await page.route('**/api/trpc/**', noStart);
    await openPo(page, po.poId);
    const [units, kilos] = po.lines;
    await row(page, units!.name).getByTestId('count-arrived').tap();
    await row(page, kilos!.name).getByTestId('count-arrived').tap();
    await expect(page.getByTestId('count-footer-message')).toContainText('אין חיבור');
    expect((await receiptOf(po.poId)).gr, 'no receipt yet').toBeNull();
    const kept = () => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('rm-rcv-precount:')).map(([, v]) => Object.keys(JSON.parse(v) as object).length));
    expect(await kept(), 'both counts kept on this phone').toEqual([2]);

    // Leaving asks first (RCV-02), then the server is back and the page reloads.
    const asked: string[] = [];
    page.on('dialog', (d) => {
      asked.push(d.type());
      void d.accept();
    });
    await page.unroute('**/api/trpc/**', noStart);
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(asked, 'the reload asked before leaving the count kept on the phone').toContain('beforeunload');

    // Both counts come back, the receipt starts with them, and the phone's copy goes.
    await expect(page.getByTestId('count-resumed')).toBeVisible();
    await expect(row(page, units!.name)).toHaveAttribute('data-resolved', 'true');
    await expect(row(page, kilos!.name)).toHaveAttribute('data-resolved', 'true');
    await expect
      .poll(async () => (await receiptOf(po.poId)).lines.filter((l) => Number(l.qty) > 0).map((l) => l.poLineId).sort(), { timeout: 20_000 })
      .toEqual([units!.poLineId, kilos!.poLineId].sort());
    await expect.poll(kept, { timeout: 10_000 }).toEqual([]);
  });

  test('no signal from the first mark to the close: the close says so and keeps the count; with the signal back the receipt starts with every mark and closes', async ({ page, context }) => {
    test.setTimeout(180_000);
    const po = await freshPo('nosignal');
    await openPo(page, po.poId);
    await expect(page.getByTestId('delivery-check')).toBeVisible();
    await context.setOffline(true);
    for (const l of po.lines) await row(page, l.name).getByTestId('count-arrived').tap();
    await page.getByTestId('close-receipt').tap();
    await page.getByTestId('close-nodoc').tap();
    // Today's order cannot start a receipt without a signal either: the count is kept, and the screen says what to do.
    await expect(page.getByTestId('count-footer-message')).toHaveText('אין חיבור · הספירה שמורה בטלפון. סגרו כשהחיבור יחזור');
    await expect(page.getByTestId('receipt-confirmed')).toHaveCount(0);
    expect((await receiptOf(po.poId)).gr, 'nothing reached the server').toBeNull();

    // The signal is back: one receipt starts by itself with every mark, and the close goes through.
    await context.setOffline(false);
    await expect
      .poll(async () => (await receiptOf(po.poId)).lines.filter((l) => Number(l.qty) > 0).length, { timeout: 30_000 })
      .toBe(po.lines.length);
    await expect(page.getByTestId('count-footer-message')).toHaveCount(0);
    await page.getByTestId('close-receipt').tap();
    await page.getByTestId('close-nodoc').tap();
    await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await receiptOf(po.poId)).gr?.status, { timeout: 30_000 }).toBe('completed');
  });

  test('English and Arabic: the same screen in the receiver\'s language', async ({ page, context }) => {
    test.setTimeout(120_000);
    const url = test.info().project.use.baseURL!;
    const po = await freshPo('langs', 2);
    await context.addCookies([{ name: 'rm_locale', value: 'en', url }]);
    await openPo(page, po.poId);
    await expect(page.getByRole('heading', { level: 1, name: 'Delivery check' })).toBeVisible();
    await row(page, po.lines[1]!.name).getByTestId('count-edit').tap();
    await expect(page.getByRole('dialog', { name: 'How many arrived?' })).toBeVisible();
    await page.keyboard.press('Escape');

    await context.addCookies([{ name: 'rm_locale', value: 'ar', url }]);
    await openPo(page, po.poId);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await row(page, po.lines[1]!.name).getByTestId('count-edit').tap();
    const title = await page.getByRole('dialog').getByRole('heading', { level: 2 }).textContent();
    expect(title ?? '', 'the sheet speaks Arabic').toMatch(/[؀-ۿ]/);
    expect(HEBREW.test(title ?? ''), 'no Hebrew in the Arabic sheet title').toBe(false);
  });
});
