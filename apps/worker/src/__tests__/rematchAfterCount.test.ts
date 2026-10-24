import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  asc,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  inArray,
  memberships,
  invoiceLines,
  invoices,
  matchRuns,
  poLines,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { computeLeakHero } from '@restomatch/charts';
import { appRouter, type AppContext } from '@restomatch/api';
import { matchInvoiceForJob } from '../jobs/matchInvoice';
import { ocrMayAutoMatch } from '../jobs/ocrInvoice';

/**
 * Receiving order of events: the invoice photo is registered (and read) BEFORE
 * the receiver counts. A match run then sees empty gr_lines — every line short
 * AND over-billed — and the leak hero jumps by the whole invoice. The OCR job
 * must wait for the count while the receipt is open; submitReceipt re-matches
 * (rematch) once the count is in, replacing any run made before it.
 *
 * Runs on the demo seed (DEMO_TODAY 2026-10-25), on an open HaSharon Produce PO.
 */
const db = createDb(testDbUrl());
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const NOW = new Date('2026-10-25T09:00:00Z');
let restaurantId = '';
let poId = '';
let supplierId = '';
let lines: Array<{ id: string; productId: string | null; desc: string | null; qty: number; unit: string; price: number }> = [];

beforeAll(async () => {
  for (const [pkg, script] of [
    ['@restomatch/db', 'scripts/seed.ts'],
    ['@restomatch/worker', 'scripts/seed-demo.ts'],
  ] as const) {
    const run = spawnSync('pnpm', ['--filter', pkg, 'exec', 'tsx', script], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: testDbUrl(), DEMO_TODAY: '2026-10-25' },
      encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`demo seed (${script}) failed:\n${run.stdout}\n${run.stderr}`);
  }
  const [r] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  restaurantId = r!.id;
  const [sup] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, restaurantId), eq(suppliers.nameEn, 'HaSharon Produce')))
    .limit(1);
  supplierId = sup!.id;
  // An open HaSharon PO with no receipt yet, nearest the demo day.
  const [po] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.restaurantId, restaurantId),
        eq(purchaseOrders.supplierId, supplierId),
        inArray(purchaseOrders.status, ['sent', 'confirmed']),
        sql`not exists (select 1 from goods_receipts g where g.po_id = ${purchaseOrders.id})`,
      ),
    )
    .orderBy(sql`abs(extract(epoch from (${purchaseOrders.expectedDeliveryAt} - ${NOW.toISOString()}::timestamptz)))`)
    .limit(1);
  poId = po!.id;
  lines = (
    await db
      .select({
        id: poLines.id,
        productId: poLines.productId,
        desc: poLines.rawDescription,
        qty: poLines.qtyOrdered,
        unit: poLines.unit,
        price: poLines.unitPriceExpected,
      })
      .from(poLines)
      .where(eq(poLines.poId, poId))
      .orderBy(asc(poLines.id))
  ).map((l) => ({ ...l, qty: Number(l.qty), price: Number(l.price) }));
  expect(lines.length).toBeGreaterThan(0);
}, 240_000);

afterAll(async () => {
  await db.execute(sql`TRUNCATE restaurants, users RESTART IDENTITY CASCADE`);
});

/** The receiving wizard: receipt opened (gr_lines at 0) + the invoice read exactly as ordered. */
async function receiptWithInvoice() {
  const [gr] = await db.insert(goodsReceipts).values({ restaurantId, poId, status: 'pending' }).returning();
  const grLineIds = await db
    .insert(grLines)
    .values(lines.map((l) => ({ grId: gr!.id, poLineId: l.id, productId: l.productId, qtyReceived: '0' })))
    .returning({ id: grLines.id, poLineId: grLines.poLineId });
  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.price * 100), 0) / 100;
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId,
      supplierId,
      status: 'matched', // confident OCR (not held for review)
      source: 'photo',
      rawImageUrl: `https://x/${gr!.id}.jpg`,
      invoiceNumber: `RM-${gr!.id.slice(0, 8)}`,
      invoiceDate: NOW,
      totalExclVat: total.toFixed(2),
      vatAmount: '0.00',
      totalInclVat: total.toFixed(2),
    })
    .returning();
  await db.insert(invoiceLines).values(
    lines.map((l) => ({
      invoiceId: inv!.id,
      productId: l.productId,
      rawDescription: l.desc ?? '—',
      qtyBilled: String(l.qty),
      unit: l.unit,
      unitPriceBilled: String(l.price),
      lineTotal: (Math.round(l.qty * l.price * 100) / 100).toFixed(2),
    })),
  );
  return { grId: gr!.id, invoiceId: inv!.id, grLineIds };
}

/** The count lands "= order" and the receipt is submitted. */
async function countAsOrderedAndSubmit(grId: string, grLineIds: Array<{ id: string; poLineId: string | null }>) {
  for (const g of grLineIds) {
    const l = lines.find((x) => x.id === g.poLineId)!;
    await db.update(grLines).set({ qtyReceived: String(l.qty) }).where(eq(grLines.id, g.id));
  }
  await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, grId));
}

const hero = async () => Math.round((await computeLeakHero(db, restaurantId, { now: NOW })).leakIls * 100);

async function typesOf(invoiceId: string) {
  const rows = await db
    .select({ type: discrepancies.type })
    .from(discrepancies)
    .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
    .where(eq(matchRuns.invoiceId, invoiceId));
  return rows.map((r) => r.type);
}

describe('OCR auto-match waits for the count', () => {
  it('is held while the scan’s receipt is open; free with no receipt or once submitted', async () => {
    const { grId } = await receiptWithInvoice();
    expect(await ocrMayAutoMatch(db, restaurantId, grId)).toBe(false);
    expect(await ocrMayAutoMatch(db, restaurantId, undefined)).toBe(true); // email / WhatsApp / upload
    await db.update(goodsReceipts).set({ status: 'partial' }).where(eq(goodsReceipts.id, grId));
    expect(await ocrMayAutoMatch(db, restaurantId, grId)).toBe(true);
    await db.delete(goodsReceipts).where(eq(goodsReceipts.id, grId));
  });
});

describe('match-invoice job', () => {
  it('is a no-op for an invoice still in OCR (a submit that beat the read)', async () => {
    const { invoiceId, grId } = await receiptWithInvoice();
    await db.update(invoices).set({ status: 'ocr_pending' }).where(eq(invoices.id, invoiceId));
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId, rematch: true });
    expect(out.skipped).toBe('ocr_pending');
    expect(await typesOf(invoiceId)).toEqual([]);
    await db.delete(invoices).where(eq(invoices.id, invoiceId));
    await db.delete(goodsReceipts).where(eq(goodsReceipts.id, grId));
  });

  it('a re-match of an invoice the OCR held for a human still waits for that human', async () => {
    const { invoiceId, grId } = await receiptWithInvoice();
    await db.update(invoices).set({ status: 'parsed' }).where(eq(invoices.id, invoiceId));
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId, rematch: true });
    expect(out.skipped).toBe('awaiting_review');
    await db.delete(invoices).where(eq(invoices.id, invoiceId));
    await db.delete(goodsReceipts).where(eq(goodsReceipts.id, grId));
  });

  it('submit after the count: the hero does not move for a receipt "= order"', async () => {
    const before = await hero();
    const { grId, invoiceId, grLineIds } = await receiptWithInvoice();
    await countAsOrderedAndSubmit(grId, grLineIds);
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId, rematch: true });
    expect(out.persisted).not.toBeNull();
    expect(out.replaced).toBe(false);
    const types = await typesOf(invoiceId);
    expect(types).not.toContain('QTY_SHORT');
    expect(types).not.toContain('QTY_OVER');
    expect(await hero()).toBe(before);
    // One receipt per PO: clear this one for the next case.
    await db.delete(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
    await db.delete(invoices).where(eq(invoices.id, invoiceId));
    await db.delete(goodsReceipts).where(eq(goodsReceipts.id, grId));
  });

  it("the re-match is pinned to the receipt's PO, even when another open PO is a nearer fit", async () => {
    const before = await hero();
    const { grId, invoiceId, grLineIds } = await receiptWithInvoice();
    // A decoy order from the same supplier, due at 00:30 on the invoice's local day:
    // discovery ranks by day and then takes the earliest — the decoy.
    const [decoy] = await db
      .insert(purchaseOrders)
      .values({ restaurantId, supplierId, status: 'sent', source: 'manual', expectedDeliveryAt: new Date('2026-10-24T21:30:00Z'), notes: 'decoy' })
      .returning();
    try {
      await countAsOrderedAndSubmit(grId, grLineIds);
      const out = await matchInvoiceForJob(db, { restaurantId, invoiceId, rematch: true, poId });
      expect(out.persisted).not.toBeNull();
      const [run] = await db.select({ poId: matchRuns.poId, grId: matchRuns.grId }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
      expect(run).toEqual({ poId, grId });
      expect(await hero()).toBe(before);
    } finally {
      await db.delete(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
      await db.delete(invoices).where(eq(invoices.id, invoiceId));
      await db.delete(goodsReceipts).where(eq(goodsReceipts.id, grId));
      await db.delete(purchaseOrders).where(eq(purchaseOrders.id, decoy!.id));
    }
  });

  it('a run made before the count is replaced by the re-match — the hero comes back', async () => {
    const before = await hero();
    const { grId, invoiceId, grLineIds } = await receiptWithInvoice();
    // The job now refuses to match against a receipt still being counted…
    expect((await matchInvoiceForJob(db, { restaurantId, invoiceId })).skipped).toBe('receipt_open');
    // …so build the legacy state (a run made before any guard, while gr_lines
    // were still 0) by matching with the receipt briefly not 'pending'.
    await db.update(goodsReceipts).set({ status: 'partial' }).where(eq(goodsReceipts.id, grId));
    const early = await matchInvoiceForJob(db, { restaurantId, invoiceId });
    await db.update(goodsReceipts).set({ status: 'pending' }).where(eq(goodsReceipts.id, grId));
    expect(early.persisted).not.toBeNull();
    expect(await typesOf(invoiceId)).toContain('QTY_SHORT');
    expect(await hero()).toBeGreaterThan(before);
    // A plain (non-rematch) retry stays idempotent.
    expect((await matchInvoiceForJob(db, { restaurantId, invoiceId })).skipped).toBe('already_matched');

    await countAsOrderedAndSubmit(grId, grLineIds);
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId, rematch: true });
    expect(out.replaced).toBe(true);
    const runs = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
    expect(runs).toHaveLength(1);
    const types = await typesOf(invoiceId);
    expect(types).not.toContain('QTY_SHORT');
    expect(types).not.toContain('QTY_OVER');
    expect(await hero()).toBe(before);
  });
});

/**
 * "Receive the rest": a partial receipt is reopened for the second delivery of
 * the same order (one receipt per PO). The count is cumulative, and the second
 * close re-matches EVERY invoice on the receipt — the first invoice's shortfall
 * has since arrived, so keeping its old run would overstate the leak.
 */
describe('receive the rest — two deliveries, two invoices, one receipt', () => {
  // One receipt per PO: start from none (an earlier case may leave its own).
  beforeEach(async () => {
    const left = await db.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.poId, poId));
    if (left.length === 0) return;
    const ids = left.map((g) => g.id);
    const runs = await db.select({ invoiceId: matchRuns.invoiceId }).from(matchRuns).where(inArray(matchRuns.grId, ids));
    const invs = runs.map((r) => r.invoiceId).filter((x): x is string => !!x);
    if (invs.length) await cleanup(ids[0]!, invs);
    await db.delete(goodsReceipts).where(inArray(goodsReceipts.id, ids));
  });

  async function invoiceFor(grId: string, tag: string, billed: Array<{ l: (typeof lines)[number]; qty: number; price?: number }>) {
    const total = billed.reduce((s, b) => s + Math.round(b.qty * (b.price ?? b.l.price) * 100), 0) / 100;
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId,
        supplierId,
        status: 'matched',
        source: 'photo',
        rawImageUrl: `https://x/${grId}-${tag}.jpg`,
        invoiceNumber: `RM-${grId.slice(0, 8)}-${tag}`,
        invoiceDate: NOW,
        totalExclVat: total.toFixed(2),
        vatAmount: '0.00',
        totalInclVat: total.toFixed(2),
      })
      .returning();
    await db.insert(invoiceLines).values(
      billed.map((b) => ({
        invoiceId: inv!.id,
        productId: b.l.productId,
        rawDescription: b.l.desc ?? '—',
        qtyBilled: String(b.qty),
        unit: b.l.unit,
        unitPriceBilled: String(b.price ?? b.l.price),
        lineTotal: (Math.round(b.qty * (b.price ?? b.l.price) * 100) / 100).toFixed(2),
      })),
    );
    return inv!.id;
  }

  /** Delivery 1: everything but half of the first line; invoice 1 bills what came. */
  async function firstDelivery() {
    const [gr] = await db.insert(goodsReceipts).values({ restaurantId, poId, status: 'pending' }).returning();
    const grId = gr!.id;
    const short = lines[0]!;
    const half = Math.floor(short.qty / 2);
    const grLineIds = await db
      .insert(grLines)
      .values(lines.map((l) => ({ grId, poLineId: l.id, productId: l.productId, qtyReceived: String(l === short ? half : l.qty) })))
      .returning({ id: grLines.id, poLineId: grLines.poLineId });
    const inv1 = await invoiceFor(grId, '1', lines.map((l) => ({ l, qty: l === short ? half : l.qty })));
    await db.update(goodsReceipts).set({ status: 'partial' }).where(eq(goodsReceipts.id, grId));
    expect((await matchInvoiceForJob(db, { restaurantId, invoiceId: inv1, rematch: true, poId })).persisted).not.toBeNull();
    return { grId, inv1, short, half, grLineIds };
  }

  /** Reopen, count the rest (cumulative = ordered), invoice 2 bills the rest, close + re-match both. */
  async function secondDelivery(
    d: Awaited<ReturnType<typeof firstDelivery>>,
    inv2Price?: number,
  ) {
    await db.update(goodsReceipts).set({ status: 'pending' }).where(eq(goodsReceipts.id, d.grId));
    const g = d.grLineIds.find((x) => x.poLineId === d.short.id)!;
    await db.update(grLines).set({ qtyReceived: String(d.short.qty) }).where(eq(grLines.id, g.id));
    const inv2 = await invoiceFor(d.grId, '2', [{ l: d.short, qty: d.short.qty - d.half, price: inv2Price }]);
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, d.grId));
    const r1 = await matchInvoiceForJob(db, { restaurantId, invoiceId: d.inv1, rematch: true, poId });
    const r2 = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv2, rematch: true, poId });
    return { inv2, r1, r2 };
  }

  async function cleanup(grId: string, ids: string[]) {
    await db.delete(matchRuns).where(inArray(matchRuns.invoiceId, ids));
    await db.delete(invoices).where(inArray(invoices.id, ids));
    await db.delete(goodsReceipts).where(eq(goodsReceipts.id, grId));
  }

  it('the second close clears the first shortfall; the hero is back to "= order" (no false MISSING on the rest)', async () => {
    const before = await hero();
    const d = await firstDelivery();
    // First close: the half still on its way is a shortfall.
    expect(await typesOf(d.inv1)).toEqual(['QTY_SHORT']);
    expect(await hero()).toBeGreaterThan(before);

    const s = await secondDelivery(d);
    try {
      expect(s.r1.replaced).toBe(true); // invoice 1 re-matched against the full count
      expect(s.r2.persisted).not.toBeNull();
      // (2) the first delivery's shortfall is gone…
      expect(await typesOf(d.inv1)).toEqual([]);
      // …and invoice 2 (the rest only) is not "missing" the lines invoice 1 billed.
      expect(await typesOf(s.inv2)).toEqual([]);
      // (1) hero = findings of both invoices against the final count = none.
      expect(await hero()).toBe(before);
    } finally {
      await cleanup(d.grId, [d.inv1, s.inv2]);
    }
  });

  it('(3) an over-price on invoice 2 moves the hero by exactly that finding', async () => {
    const before = await hero();
    const d = await firstDelivery();
    const over = Math.round(d.short.price * 1.5 * 100) / 100;
    const s = await secondDelivery(d, over);
    try {
      expect(await typesOf(d.inv1)).toEqual([]);
      const rows = await db
        .select({ type: discrepancies.type, delta: discrepancies.deltaAmount })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .where(eq(matchRuns.invoiceId, s.inv2));
      expect(rows.map((r) => r.type)).toContain('PRICE_HIGHER');
      const expected = Math.round((d.short.qty - d.half) * (over - d.short.price) * 100);
      expect(Math.round(rows.reduce((t, r) => t + Math.abs(Number(r.delta)), 0) * 100)).toBe(expected);
      expect((await hero()) - before).toBe(expected);
    } finally {
      await cleanup(d.grId, [d.inv1, s.inv2]);
    }
  });

  it('(4)+(5) invoice 1 approved after the first close: never re-matched ("settled") — its old run stays', async () => {
    const before = await hero();
    const d = await firstDelivery();
    const atFirstClose = await hero();
    await db.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, d.inv1));
    const s = await secondDelivery(d);
    try {
      expect(s.r1.skipped).toBe('settled');
      expect(await typesOf(s.inv2)).toEqual([]);
      // KNOWN LIMIT (PR body): the signed-off run keeps its first-close
      // QTY_SHORT, so the hero still counts the shortfall that has since
      // arrived. Pinned so a fix (charts / api, not the engine) shows up here.
      expect(await typesOf(d.inv1)).toEqual(['QTY_SHORT']);
      expect(await hero()).toBe(atFirstClose);
      expect(atFirstClose).toBeGreaterThan(before);
    } finally {
      await cleanup(d.grId, [d.inv1, s.inv2]);
    }
  });

  it('(double bill) invoice 2 re-bills units invoice 1 already billed, received once → QTY_OVER on invoice 2 only', async () => {
    const before = await hero();
    const d = await firstDelivery();
    // The rest arrives and is counted, but the supplier bills the WHOLE first line again.
    await db.update(goodsReceipts).set({ status: 'pending' }).where(eq(goodsReceipts.id, d.grId));
    const g = d.grLineIds.find((x) => x.poLineId === d.short.id)!;
    await db.update(grLines).set({ qtyReceived: String(d.short.qty) }).where(eq(grLines.id, g.id));
    // Invoice 1 bills the full line too (re-read after the rest came) — 'half' is already on it.
    await db.update(invoiceLines).set({ qtyBilled: String(d.short.qty), lineTotal: (Math.round(d.short.qty * d.short.price * 100) / 100).toFixed(2) })
      .where(and(eq(invoiceLines.invoiceId, d.inv1), eq(invoiceLines.rawDescription, d.short.desc ?? '—')));
    await db.execute(sql`update invoices set total_excl_vat = t, total_incl_vat = t
      from (select sum(line_total) as t from invoice_lines where invoice_id = ${d.inv1}) s where id = ${d.inv1}`);
    const inv2 = await invoiceFor(d.grId, '2', [{ l: d.short, qty: d.short.qty }]);
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, d.grId));
    try {
      await matchInvoiceForJob(db, { restaurantId, invoiceId: d.inv1, rematch: true, poId });
      await matchInvoiceForJob(db, { restaurantId, invoiceId: inv2, rematch: true, poId });
      expect(await typesOf(d.inv1)).toEqual([]); // the first bill is the real one
      const rows = await db
        .select({ type: discrepancies.type, delta: discrepancies.deltaAmount })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        // Not 'info': the line has nothing left to order/receive (0 vs 0 reads as a ₪0 info note).
        .where(and(eq(matchRuns.invoiceId, inv2), sql`${discrepancies.severity} <> 'info'`));
      expect(rows.map((r) => r.type)).toEqual(['QTY_OVER']);
      const expected = Math.round(d.short.qty * d.short.price * 100);
      expect(Math.round(Number(rows[0]!.delta) * 100)).toBe(expected);
      expect((await hero()) - before).toBe(expected);
    } finally {
      await cleanup(d.grId, [d.inv1, inv2]);
    }
  });

  it("a sibling's run that goes away stops hiding lines on the next match (no stale state)", async () => {
    const d = await firstDelivery();
    const s = await secondDelivery(d);
    try {
      expect(await typesOf(s.inv2)).toEqual([]);
      // Invoice 1's run is gone (invoice deleted / moved to another order): the
      // stored run of invoice 2 is a snapshot until its next match…
      await db.delete(matchRuns).where(eq(matchRuns.invoiceId, d.inv1));
      expect(await typesOf(s.inv2)).toEqual([]);
      // …which reads the live order: the lines nobody bills now are MISSING again.
      await matchInvoiceForJob(db, { restaurantId, invoiceId: s.inv2, rematch: true, poId });
      const types = await typesOf(s.inv2);
      expect(types.filter((t) => t === 'MISSING_ON_INVOICE')).toHaveLength(lines.length - 1);
    } finally {
      await cleanup(d.grId, [d.inv1, s.inv2]);
    }
  });

  it('the way out, through the real procedures: partial → תיקון ספירה → the full total → completed → the shortfall leaves the hero', async () => {
    const d = await firstDelivery(); // partial: half of line 1 short, QTY_SHORT on the hero
    const withShort = await hero();
    const shortDelta = await db
      .select({ delta: discrepancies.deltaAmount })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, d.inv1), eq(discrepancies.type, 'QTY_SHORT')));
    expect(shortDelta).toHaveLength(1);

    const [owner] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.restaurantId, restaurantId), eq(memberships.role, 'owner')))
      .limit(1);
    const [rest] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, restaurantId));
    await db.execute(sql`update restaurants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features,receiptReopen}', 'true'::jsonb, true) where id = ${restaurantId}`);
    try {
      const caller = appRouter.createCaller({
        db,
        session: { userId: owner!.userId, restaurantId, role: 'owner' },
      } as AppContext);
      await caller.receiving.correctReceipt({ grId: d.grId });
      const g = d.grLineIds.find((x) => x.poLineId === d.short.id)!;
      await caller.receiving.markGrLine({ grLineId: g.id, qtyReceived: d.short.qty }); // the real total
      const closed = await caller.receiving.submitReceipt({ grId: d.grId, invoiceIds: [d.inv1] });
      expect(closed.status).toBe('completed');
      // The re-match the submit enqueued (the worker's job).
      const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: d.inv1, rematch: true, poId });
      expect(out.replaced).toBe(true);
      expect(await typesOf(d.inv1)).not.toContain('QTY_SHORT');
      expect(withShort - (await hero())).toBe(Math.round(Number(shortDelta[0]!.delta) * 100));
    } finally {
      await db.update(restaurants).set({ settings: rest!.settings }).where(eq(restaurants.id, restaurantId));
      await cleanup(d.grId, [d.inv1]);
    }
  });
});
