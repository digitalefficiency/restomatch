import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  asc,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  inArray,
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
