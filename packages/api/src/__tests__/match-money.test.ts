import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  activityEvents,
  and,
  createDb,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  matchRuns,
  priceHistory,
  purchaseOrders,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { normalizeInvoiceNumber } from '../match/buildMatchInput';
import { backfillPriceHistory, writePriceHistoryForInvoice } from '../match/priceHistory';
import { decisionStillApplies, matchActivitySummary, pairPriorDecisions, type PriorDecision } from '../match/persist';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * S3 money-engine: the price_history writer (M1), its backfill, and
 * duplicate-invoice detection only looking at EARLIER invoices.
 */
const db = createDb(testDbUrl());

function ownerCaller(t: Tenant) {
  const ctx: AppContext = {
    db,
    session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' },
  };
  return appRouter.createCaller(ctx);
}

const historyFor = (t: Tenant) =>
  db.select().from(priceHistory).where(eq(priceHistory.restaurantId, t.restaurantId));

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
});
afterAll(() => resetDb(db));

describe('M1: price_history writer', () => {
  it('match.runForInvoice writes one row per mapped invoice line, tenant-scoped', async () => {
    const A = await seedTenant(db, 'A');
    const B = await seedTenant(db, 'B');
    await ownerCaller(A).match.runForInvoice({ invoiceId: A.invoiceId });

    const rows = await historyFor(A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId: A.productId,
      supplierId: A.supplierId,
      sourceInvoiceId: A.invoiceId,
      unitPrice: '10.0000', // the billed price (kg → product default ק״ג, factor 1)
      qty: '10.000',
    });
    // B's seeded row is untouched.
    const bRows = await historyFor(B);
    expect(bRows).toHaveLength(1);
    expect(bRows[0]!.unitPrice).toBe('8.5000');
  });

  it('is idempotent: re-running the match does not duplicate rows', async () => {
    const A = await seedTenant(db, 'A');
    await ownerCaller(A).match.runForInvoice({ invoiceId: A.invoiceId });
    await ownerCaller(A).match.runForInvoice({ invoiceId: A.invoiceId });
    expect(await historyFor(A)).toHaveLength(1);
  });

  it('normalizes ₪/g to the product default unit (₪/kg)', async () => {
    const A = await seedTenant(db, 'A');
    await db
      .update(invoiceLines)
      .set({ unit: 'גרם', qtyBilled: '2000', unitPriceBilled: '0.0120' })
      .where(eq(invoiceLines.id, A.invoiceLineId));
    await writePriceHistoryForInvoice(db, A.restaurantId, A.invoiceId);
    const [row] = await historyFor(A);
    expect(row!.unitPrice).toBe('12.0000');
    expect(row!.qty).toBe('2.000');
  });

  it('skips unmapped lines and never writes a duplicate invoice', async () => {
    const A = await seedTenant(db, 'A');
    await db.update(invoiceLines).set({ productId: null }).where(eq(invoiceLines.id, A.invoiceLineId));
    expect(await writePriceHistoryForInvoice(db, A.restaurantId, A.invoiceId)).toBe(0);
    await db
      .update(invoiceLines)
      .set({ productId: A.productId })
      .where(eq(invoiceLines.id, A.invoiceLineId));
    expect(await writePriceHistoryForInvoice(db, A.restaurantId, A.invoiceId, { skip: true })).toBe(0);
    expect(await historyFor(A)).toHaveLength(0);
  });

  it('backfill rewrites history for every matched invoice and is re-runnable', async () => {
    const A = await seedTenant(db, 'A'); // seeded with a match run + a stale 8.5 row
    const first = await backfillPriceHistory(db, A.restaurantId);
    expect(first).toEqual({ invoices: 1, rows: 1 });
    const again = await backfillPriceHistory(db, A.restaurantId);
    expect(again).toEqual({ invoices: 1, rows: 1 });
    const rows = await historyFor(A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unitPrice).toBe('10.0000');
  });
});

describe('normalizeInvoiceNumber', () => {
  it('collapses formatting and leading zeros', () => {
    expect(normalizeInvoiceNumber('INV-0012')).toBe('INV12');
    expect(normalizeInvoiceNumber('inv 12')).toBe('INV12');
    expect(normalizeInvoiceNumber(' 000123 / ')).toBe('123');
    expect(normalizeInvoiceNumber('1020')).toBe('1020');
    expect(normalizeInvoiceNumber('--')).toBeNull();
    expect(normalizeInvoiceNumber(null)).toBeNull();
  });
});

describe('duplicate invoice detection only looks at earlier invoices', () => {
  it('re-matching the ORIGINAL after its duplicate arrived does not flag the original', async () => {
    const A = await seedTenant(db, 'A');
    const [orig] = await db.select().from(invoices).where(eq(invoices.id, A.invoiceId));
    const [dup] = await db
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        // Same invoice re-typed with different formatting (the DB rejects an
        // exact repeat): "INV-A-1" vs "inv a 01".
        invoiceNumber: 'inv a 01',
        invoiceDate: orig!.invoiceDate,
        totalExclVat: '100.00',
        vatAmount: '17.00',
        totalInclVat: '117.00',
        status: 'parsed',
        source: 'photo',
        createdAt: new Date(orig!.createdAt.getTime() + 60_000),
      })
      .returning();
    await db.insert(invoiceLines).values({
      invoiceId: dup!.id,
      productId: A.productId,
      rawDescription: 'dup',
      qtyBilled: '10',
      unit: 'kg',
      unitPriceBilled: '10.00',
      lineTotal: '100.00',
    });

    const caller = ownerCaller(A);
    await caller.match.runForInvoice({ invoiceId: dup!.id });
    await caller.match.runForInvoice({ invoiceId: A.invoiceId });

    const dupTypesFor = async (invoiceId: string) =>
      (
        await db
          .select({ type: discrepancies.type })
          .from(discrepancies)
          .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
          .where(and(eq(matchRuns.invoiceId, invoiceId), eq(discrepancies.type, 'DUPLICATE_INVOICE')))
      ).length;
    expect(await dupTypesFor(dup!.id)).toBe(1);
    expect(await dupTypesFor(A.invoiceId)).toBe(0);
    // …and the duplicate's prices never reach price_history.
    const rows = await historyFor(A);
    expect(rows.every((r) => r.sourceInvoiceId === A.invoiceId)).toBe(true);
  });
});

describe('a re-scan held without its number is still a duplicate', () => {
  it('flags DUPLICATE_INVOICE from ocr_payload.raw.duplicateOf (invoices_dedupe_idx copy)', async () => {
    const A = await seedTenant(db, 'A');
    const [orig] = await db.select().from(invoices).where(eq(invoices.id, A.invoiceId));
    // What the worker's writeOcrHeader stores when the read number is taken:
    // no invoice_number, the number kept in the payload, held as 'parsed'.
    const [copy] = await db
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceNumber: null,
        invoiceDate: orig!.invoiceDate,
        totalExclVat: '100.00',
        vatAmount: '17.00',
        totalInclVat: '117.00',
        status: 'parsed',
        source: 'photo',
        ocrPayload: {
          provider: 'reconciled',
          raw: { duplicateOf: { invoiceId: A.invoiceId, invoiceNumber: A.invoiceNumber } },
        },
        createdAt: new Date(orig!.createdAt.getTime() + 60_000),
      })
      .returning();
    await db.insert(invoiceLines).values({
      invoiceId: copy!.id,
      productId: A.productId,
      rawDescription: 'rescan',
      qtyBilled: '10',
      unit: 'kg',
      unitPriceBilled: '10.00',
      lineTotal: '100.00',
    });

    const caller = ownerCaller(A);
    await caller.match.runForInvoice({ invoiceId: copy!.id });
    await caller.match.runForInvoice({ invoiceId: A.invoiceId });

    const dupTypesFor = async (invoiceId: string) =>
      (
        await db
          .select({ type: discrepancies.type })
          .from(discrepancies)
          .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
          .where(and(eq(matchRuns.invoiceId, invoiceId), eq(discrepancies.type, 'DUPLICATE_INVOICE')))
      ).length;
    expect(await dupTypesFor(copy!.id)).toBe(1);
    expect(await dupTypesFor(A.invoiceId)).toBe(0);
  });
});

describe('a held copy older than the invoice holding its number', () => {
  it('is still flagged (OCR jobs can finish out of order); the holder is not', async () => {
    const A = await seedTenant(db, 'A');
    const [orig] = await db.select().from(invoices).where(eq(invoices.id, A.invoiceId));
    const [copy] = await db
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceNumber: null,
        invoiceDate: orig!.invoiceDate,
        totalExclVat: '100.00',
        vatAmount: '17.00',
        totalInclVat: '117.00',
        status: 'parsed',
        source: 'photo',
        ocrPayload: {
          provider: 'reconciled',
          raw: { duplicateOf: { invoiceId: A.invoiceId, invoiceNumber: A.invoiceNumber } },
        },
        createdAt: new Date(orig!.createdAt.getTime() - 60_000),
      })
      .returning();
    await db.insert(invoiceLines).values({
      invoiceId: copy!.id,
      productId: A.productId,
      rawDescription: 'rescan',
      qtyBilled: '10',
      unit: 'kg',
      unitPriceBilled: '10.00',
      lineTotal: '100.00',
    });

    const caller = ownerCaller(A);
    await caller.match.runForInvoice({ invoiceId: copy!.id });
    await caller.match.runForInvoice({ invoiceId: A.invoiceId });

    const dupTypesFor = async (invoiceId: string) =>
      (
        await db
          .select({ type: discrepancies.type })
          .from(discrepancies)
          .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
          .where(and(eq(matchRuns.invoiceId, invoiceId), eq(discrepancies.type, 'DUPLICATE_INVOICE')))
      ).length;
    expect(await dupTypesFor(copy!.id)).toBe(1);
    expect(await dupTypesFor(A.invoiceId)).toBe(0);
  });
});

describe('invoice_matched activity carries structured metadata', () => {
  it('title names the invoice; metadata has number, supplier, counts and ₪', async () => {
    const A = await seedTenant(db, 'A');
    const res = await ownerCaller(A).match.runForInvoice({ invoiceId: A.invoiceId });
    const [ev] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.restaurantId, A.restaurantId), eq(activityEvents.entityId, res.matchRunId!)));
    expect(ev!.eventType).toBe('invoice_matched');
    expect(ev!.title).toBe(`חשבונית ${A.invoiceNumber} הותאמה`);
    expect(ev!.detail).toContain(A.supplierName);
    expect(ev!.metadata).toMatchObject({
      invoiceId: A.invoiceId,
      invoiceNumber: A.invoiceNumber,
      supplierName: A.supplierName,
      discrepancyCount: res.discrepancyCount,
      potentialLossIls: res.totalDiscrepancyAmount,
      status: res.status,
    });
  });
});

describe('a re-match keeps the people’s decisions', () => {
  async function heldCopy(A: Tenant) {
    const [orig] = await db.select().from(invoices).where(eq(invoices.id, A.invoiceId));
    const [copy] = await db
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceNumber: null,
        invoiceDate: orig!.invoiceDate,
        totalExclVat: '100.00',
        vatAmount: '17.00',
        totalInclVat: '117.00',
        status: 'parsed',
        source: 'photo',
        ocrPayload: {
          provider: 'reconciled',
          raw: { duplicateOf: { invoiceId: A.invoiceId, invoiceNumber: A.invoiceNumber } },
        },
        createdAt: new Date(orig!.createdAt.getTime() + 60_000),
      })
      .returning();
    await db.insert(invoiceLines).values({
      invoiceId: copy!.id,
      productId: A.productId,
      rawDescription: 'rescan',
      qtyBilled: '10',
      unit: 'kg',
      unitPriceBilled: '10.00',
      lineTotal: '100.00',
    });
    return copy!.id;
  }
  const findingsFor = (invoiceId: string) =>
    db
      .select({
        id: discrepancies.id,
        type: discrepancies.type,
        status: discrepancies.resolutionStatus,
        resolvedBy: discrepancies.resolvedBy,
        note: discrepancies.resolutionNote,
      })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(eq(matchRuns.invoiceId, invoiceId));

  it('reject "not a duplicate", re-match → still rejected (same decider and reason)', async () => {
    const A = await seedTenant(db, 'A');
    const copyId = await heldCopy(A);
    const caller = ownerCaller(A);
    await caller.match.runForInvoice({ invoiceId: copyId });
    const dup = (await findingsFor(copyId)).find((f) => f.type === 'DUPLICATE_INVOICE');
    expect(dup?.status).toBe('open');
    await caller.approvals.reject({ discrepancyId: dup!.id, reason: 'not a duplicate — a second delivery' });

    await caller.match.runForInvoice({ invoiceId: copyId });
    const after = await findingsFor(copyId);
    const dupAfter = after.filter((f) => f.type === 'DUPLICATE_INVOICE');
    expect(dupAfter).toHaveLength(1);
    expect(dupAfter[0]!.id).not.toBe(dup!.id); // a new run, the decision carried over
    expect(dupAfter[0]).toMatchObject({
      status: 'rejected',
      resolvedBy: A.ownerUserId,
      note: 'not a duplicate — a second delivery',
    });
    // Other findings of the new run that nobody decided are not touched.
    expect(after.filter((f) => f.type !== 'DUPLICATE_INVOICE').every((f) => f.resolvedBy == null)).toBe(true);
  });

  it('escalate to the owner, re-match → still escalated and still routed to the owner', async () => {
    const A = await seedTenant(db, 'A');
    const copyId = await heldCopy(A);
    const caller = ownerCaller(A);
    await caller.match.runForInvoice({ invoiceId: copyId });
    const dup = (await findingsFor(copyId)).find((f) => f.type === 'DUPLICATE_INVOICE');
    await caller.approvals.escalate({ discrepancyId: dup!.id, note: 'owner to call the supplier' });

    await caller.match.runForInvoice({ invoiceId: copyId });
    const [after] = await db
      .select({ status: discrepancies.resolutionStatus, role: discrepancies.requiresRole, note: discrepancies.resolutionNote })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, copyId), eq(discrepancies.type, 'DUPLICATE_INVOICE')));
    expect(after).toEqual({ status: 'escalated', role: 'owner', note: 'owner to call the supplier' });
  });

  it('a decided finding that no longer exists is not resurrected; undecided ones are re-decided by the engine', async () => {
    const A = await seedTenant(db, 'A');
    const copyId = await heldCopy(A);
    const caller = ownerCaller(A);
    await caller.match.runForInvoice({ invoiceId: copyId });
    const dup = (await findingsFor(copyId)).find((f) => f.type === 'DUPLICATE_INVOICE');
    await caller.approvals.reject({ discrepancyId: dup!.id, reason: 'not a duplicate' });

    // The copy turns out to be a different invoice: its number no longer points at A.
    await db
      .update(invoices)
      .set({ invoiceNumber: 'DIFFERENT-1', ocrPayload: { provider: 'reconciled', raw: {} } })
      .where(eq(invoices.id, copyId));
    await caller.match.runForInvoice({ invoiceId: copyId });
    const after = await findingsFor(copyId);
    expect(after.some((f) => f.type === 'DUPLICATE_INVOICE')).toBe(false);
    expect(after.every((f) => f.status !== 'rejected')).toBe(true);
  });
});

describe('a re-match after the PO is closed (demo: "התאמה מחדש" on a seeded invoice)', () => {
  const findings = async (invoiceId: string) =>
    (
      await db
        .select({ type: discrepancies.type, severity: discrepancies.severity, delta: discrepancies.deltaAmount, poId: matchRuns.poId })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .where(eq(matchRuns.invoiceId, invoiceId))
    )
      .map((f) => `${f.type}|${f.severity}|${f.delta}|${f.poId}`)
      .sort();

  it('checks against the invoice’s own PO and GR: identical result, no UNORDERED_ARRIVAL', async () => {
    const A = await seedTenant(db, 'A');
    const caller = ownerCaller(A);
    const first = await caller.match.runForInvoice({ invoiceId: A.invoiceId });
    expect(first.poMatched).toBe(true);
    const before = await findings(A.invoiceId);
    expect(before.some((f) => f.startsWith('UNORDERED_ARRIVAL'))).toBe(false);

    // The delivery was received and the PO closed — discovery no longer sees it.
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, A.poId));
    const again = await caller.match.runForInvoice({ invoiceId: A.invoiceId });
    expect(again.poMatched).toBe(true);
    expect(again.status).toBe(first.status);
    expect(again.totalDiscrepancyAmount).toBe(first.totalDiscrepancyAmount);
    expect(await findings(A.invoiceId)).toEqual(before);
    const [run] = await db.select({ poId: matchRuns.poId, grId: matchRuns.grId }).from(matchRuns).where(eq(matchRuns.invoiceId, A.invoiceId));
    expect(run).toMatchObject({ poId: A.poId });
    expect(run!.grId).not.toBeNull();
  });

  it('a re-match keeps a paid (or approved) invoice paid — caught-before-payment does not jump', async () => {
    const A = await seedTenant(db, 'A');
    const caller = ownerCaller(A);
    for (const status of ['paid', 'approved'] as const) {
      await db.update(invoices).set({ status }).where(eq(invoices.id, A.invoiceId));
      await caller.match.runForInvoice({ invoiceId: A.invoiceId });
      const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, A.invoiceId));
      expect(inv!.status).toBe(status);
    }
    // An invoice still in review is (re)classified as before.
    await db.update(invoices).set({ status: 'parsed' }).where(eq(invoices.id, A.invoiceId));
    const res = await caller.match.runForInvoice({ invoiceId: A.invoiceId });
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, A.invoiceId));
    expect(inv!.status).toBe(res.status === 'blocked' ? 'disputed' : 'matched');
  });

  it('a corrected invoice date moves the invoice to the right PO (no crash re-matching against the old pin)', async () => {
    const A = await seedTenant(db, 'A');
    const caller = ownerCaller(A);
    await db.delete(matchRuns).where(eq(matchRuns.invoiceId, A.invoiceId));
    // OCR misread the date as a month ago — next to another PO of the same supplier.
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [oldPo] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, expectedDeliveryAt: monthAgo, status: 'sent', source: 'manual' })
      .returning();
    const [orig] = await db.select({ invoiceDate: invoices.invoiceDate }).from(invoices).where(eq(invoices.id, A.invoiceId));
    await db.update(invoices).set({ invoiceDate: monthAgo }).where(eq(invoices.id, A.invoiceId));
    await caller.match.runForInvoice({ invoiceId: A.invoiceId });
    const runPo = async () =>
      (await db.select({ poId: matchRuns.poId }).from(matchRuns).where(eq(matchRuns.invoiceId, A.invoiceId)))[0]?.poId;
    expect(await runPo()).toBe(oldPo!.id);

    // The person corrects the date; the old PO closes meanwhile. Re-match must
    // drop the pin (it is a month outside the window) and find the right PO.
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, oldPo!.id));
    await db.update(invoices).set({ invoiceDate: orig!.invoiceDate }).where(eq(invoices.id, A.invoiceId));
    const res = await caller.match.runForInvoice({ invoiceId: A.invoiceId });
    expect(res.poMatched).toBe(true);
    expect(await runPo()).toBe(A.poId);
    const types = (
      await db
        .select({ type: discrepancies.type })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .where(eq(matchRuns.invoiceId, A.invoiceId))
    ).map((d) => d.type);
    expect(types).not.toContain('DATE_ANOMALY');
    expect(types).not.toContain('UNORDERED_ARRIVAL');
  });

  it('a first match still only considers open POs (a closed PO is not picked up by discovery)', async () => {
    const A = await seedTenant(db, 'A');
    await db.delete(matchRuns).where(eq(matchRuns.invoiceId, A.invoiceId)); // never matched before
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, A.poId));
    const res = await ownerCaller(A).match.runForInvoice({ invoiceId: A.invoiceId });
    expect(res.poMatched).toBe(false);
  });
});

describe('the feed tells the hero’s story (matchActivitySummary)', () => {
  const f = (type: string, severity: string, deltaAmount: number, resolutionStatus = 'open') => ({ type, severity, deltaAmount, resolutionStatus });

  it('a clean match is calm — never "0 חריגות · ₪0"', () => {
    expect(matchActivitySummary([], 117, { poMatched: true })).toEqual({
      detail: 'תואמת להזמנה ולקבלה',
      leakCount: 0,
      leakIls: 0,
      pendingLink: false,
      poMatched: true,
      reviewCount: 0,
    });
    // Inside-tolerance info + an AUTO-ACCEPTED under-charge: nothing leaked, nothing open.
    expect(matchActivitySummary([f('QTY_SHORT', 'info', 4), f('PRICE_LOWER', 'warn', 12, 'accepted')], 117, { poMatched: true }).detail).toBe(
      'תואמת להזמנה ולקבלה',
    );
  });

  it('"matches" only with a PO and nothing open; an open non-loss finding reads "to review"', () => {
    expect(matchActivitySummary([f('PRICE_LOWER', 'warn', 12)], 117, { poMatched: true }).detail).toBe('חריגה אחת לבדיקה');
    expect(matchActivitySummary([f('DATE_ANOMALY', 'warn', 0), f('PRICE_LOWER', 'warn', 3)], 117, { poMatched: true }).detail).toBe('2 חריגות לבדיקה');
    // No PO and nothing pending (the no-PO finding was decided): say so, never "matches".
    expect(matchActivitySummary([f('UNORDERED_ARRIVAL', 'block', 117, 'accepted')], 117, { poMatched: false }).detail).toBe('ללא הזמנה מקושרת');
  });

  it('no PO yet → pending, calm — not "הפסד פוטנציאלי ₪1,273"', () => {
    const s = matchActivitySummary([f('UNORDERED_ARRIVAL', 'warn', 1273)], 1273, { poMatched: false });
    expect(s).toEqual({ detail: 'ממתינה לשיוך להזמנה', leakCount: 0, leakIls: 0, pendingLink: true, poMatched: false, reviewCount: 0 });
    // …but a no-PO invoice whose duplicate / VAT / total finding counts as leak says so.
    expect(matchActivitySummary([f('UNORDERED_ARRIVAL', 'block', 1273), f('VAT_MISMATCH', 'warn', 12.6)], 1273, { poMatched: false }).detail).toBe(
      'ממתינה לשיוך להזמנה · חריגה אחת · הפסד פוטנציאלי ₪13',
    );
  });

  it('singular / plural, grouped ₪, capped at the invoice total like the hero', () => {
    expect(matchActivitySummary([f('PRICE_HIGHER', 'block', 104.8)], 2787.92).detail).toBe('חריגה אחת · הפסד פוטנציאלי ₪105');
    const two = matchActivitySummary([f('DUPLICATE_INVOICE', 'block', 1180), f('PRICE_HIGHER', 'block', 400)], 1180);
    expect(two).toMatchObject({ leakCount: 2, leakIls: 1180 });
    expect(two.detail).toBe('2 חריגות · הפסד פוטנציאלי ₪1,180');
  });

  it('a duplicate rejected as "not a duplicate" is not a loss', () => {
    expect(matchActivitySummary([f('DUPLICATE_INVOICE', 'block', 118, 'rejected')], 118).detail).toBe('תואמת להזמנה ולקבלה');
  });

  it('persisted: an invoice with no PO reads "pending", with no loss figure', async () => {
    const A = await seedTenant(db, 'A');
    await db.delete(matchRuns).where(eq(matchRuns.invoiceId, A.invoiceId));
    await db.update(purchaseOrders).set({ status: 'cancelled' }).where(eq(purchaseOrders.id, A.poId));
    const res = await ownerCaller(A).match.runForInvoice({ invoiceId: A.invoiceId });
    expect(res.poMatched).toBe(false);
    const [ev] = await db.select().from(activityEvents).where(eq(activityEvents.entityId, res.matchRunId!));
    // Pending a PO link, plus the small VAT finding that counts as leak (the hero counts it too).
    expect(ev!.detail).toBe(`${A.supplierName} · ממתינה לשיוך להזמנה · חריגה אחת · הפסד פוטנציאלי ₪1`);
    expect(ev!.metadata).toMatchObject({ pendingLink: true, poMatched: false, leakCount: 1, leakIls: 1 });
  });
});

describe('pairPriorDecisions: one decision per finding, never applied to the wrong one', () => {
  const decision = (resolutionStatus: PriorDecision['resolutionStatus']): PriorDecision => ({
    resolutionStatus,
    resolvedBy: 'u1',
    resolvedAt: resolutionStatus === 'escalated' ? null : new Date('2026-10-20T10:00:00Z'),
    resolutionNote: resolutionStatus,
    requiresRole: resolutionStatus === 'escalated' ? 'owner' : null,
    severity: 'warn',
    deltaAmount: 50,
    deciderRole: 'manager',
  });
  const line = { invoiceLineId: 'il-1', poLineId: 'pl-1', productId: 'p-1' };

  it('two QTY_OVER on one line: each keeps its own decision (matched by amounts)', () => {
    const prior = [
      { type: 'QTY_OVER', ...line, deltaAmount: '42.50', expected: '5', actual: '10', decision: decision('rejected') },
      { type: 'QTY_OVER', ...line, deltaAmount: '8.50', expected: '9', actual: '10', decision: decision('accepted') },
    ];
    const findings = [
      { type: 'QTY_OVER', ...line, deltaAmount: 8.5, expected: 9, actual: 10 },
      { type: 'QTY_OVER', ...line, deltaAmount: 42.5, expected: 5, actual: 10 },
    ];
    const out = pairPriorDecisions(prior, findings);
    expect(out.map((d) => d?.resolutionStatus)).toEqual(['accepted', 'rejected']);
  });

  it('two findings on one line, only ONE decided: the undecided one stays fresh', () => {
    const prior = [{ type: 'QTY_OVER', ...line, deltaAmount: '42.50', expected: '5', actual: '10', decision: decision('rejected') }];
    const findings = [
      { type: 'QTY_OVER', ...line, deltaAmount: 42.5, expected: 5, actual: 10 },
      { type: 'QTY_OVER', ...line, deltaAmount: 8.5, expected: 9, actual: 10 },
    ];
    expect(pairPriorDecisions(prior, findings).map((d) => d?.resolutionStatus)).toEqual(['rejected', undefined]);
  });

  it('the same single finding with a changed amount keeps its decision; ambiguous leftovers start fresh', () => {
    const one = pairPriorDecisions(
      [{ type: 'PRICE_HIGHER', ...line, deltaAmount: '40', expected: '139', actual: '149', decision: decision('escalated') }],
      [{ type: 'PRICE_HIGHER', ...line, deltaAmount: 30, expected: 139, actual: 145 }],
    );
    expect(one[0]).toMatchObject({ resolutionStatus: 'escalated', requiresRole: 'owner' });
    const ambiguous = pairPriorDecisions(
      [
        { type: 'QTY_OVER', ...line, deltaAmount: '1', expected: '1', actual: '2', decision: decision('rejected') },
        { type: 'QTY_OVER', ...line, deltaAmount: '2', expected: '1', actual: '3', decision: decision('accepted') },
      ],
      [
        { type: 'QTY_OVER', ...line, deltaAmount: 3, expected: 1, actual: 4 },
        { type: 'QTY_OVER', ...line, deltaAmount: 4, expected: 1, actual: 5 },
      ],
    );
    expect(ambiguous).toEqual([undefined, undefined]);
  });

  it('a decision is never used twice', () => {
    const out = pairPriorDecisions(
      [{ type: 'DUPLICATE_INVOICE', invoiceLineId: null, poLineId: null, productId: null, deltaAmount: '118', decision: decision('rejected') }],
      [
        { type: 'DUPLICATE_INVOICE', invoiceLineId: null, poLineId: null, productId: null, deltaAmount: 118 },
        { type: 'DUPLICATE_INVOICE', invoiceLineId: null, poLineId: null, productId: null, deltaAmount: 118 },
      ],
    );
    expect(out.filter(Boolean)).toHaveLength(1);
  });
});

describe('a decision only carries to an equivalent finding (decisionStillApplies)', () => {
  const rejected = (over: Partial<PriorDecision> = {}): PriorDecision => ({
    resolutionStatus: 'rejected',
    resolvedBy: 'mgr',
    resolvedAt: new Date('2026-10-20T10:00:00Z'),
    resolutionNote: 'ok — agreed price',
    requiresRole: 'manager',
    severity: 'warn',
    deltaAmount: 50,
    deciderRole: 'manager',
    ...over,
  });

  it('unchanged or smaller finding, same routing → the decision stays', () => {
    expect(decisionStillApplies(rejected(), { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: 50, requiredRole: 'manager' })).toBe(true);
    expect(decisionStillApplies(rejected(), { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: 30, requiredRole: 'manager' })).toBe(true);
  });

  it('review repro: rejected warn ₪50 → price corrected → block ₪650 routed to the owner → starts fresh', () => {
    expect(decisionStillApplies(rejected(), { type: 'PRICE_HIGHER', severity: 'block', deltaAmount: 650, requiredRole: 'owner' })).toBe(false);
    // Each condition on its own:
    expect(decisionStillApplies(rejected(), { type: 'PRICE_HIGHER', severity: 'block', deltaAmount: 50, requiredRole: 'manager' })).toBe(false);
    expect(decisionStillApplies(rejected(), { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: 50.01, requiredRole: 'manager' })).toBe(false);
    expect(decisionStillApplies(rejected(), { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: 50, requiredRole: 'owner' })).toBe(false);
    // An owner's decision covers an owner-routed finding.
    expect(decisionStillApplies(rejected({ deciderRole: 'owner' }), { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: 50, requiredRole: 'owner' })).toBe(true);
  });

  it('a duplicate decision needs the same matched number / supplier', () => {
    const dup = rejected({ severity: 'block', deltaAmount: 118, deciderRole: 'owner', duplicateKey: 's1|INV12' });
    expect(decisionStillApplies(dup, { type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: 118, requiredRole: 'owner', duplicateKey: 's1|INV12' })).toBe(true);
    expect(decisionStillApplies(dup, { type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: 118, requiredRole: 'owner', duplicateKey: 's1|INV99' })).toBe(false);
    // Unknown (a run from before the key was recorded) → fresh, never a silent carry.
    expect(decisionStillApplies({ ...dup, duplicateKey: null }, { type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: 118, requiredRole: 'owner', duplicateKey: 's1|INV12' })).toBe(false);
  });

  it('an escalation (no decider, handed to the owner) carries while the finding is unchanged', () => {
    const esc = rejected({ resolutionStatus: 'escalated', resolvedBy: null, resolvedAt: null, deciderRole: 'owner', requiresRole: 'owner' });
    expect(decisionStillApplies(esc, { type: 'QTY_SHORT', severity: 'warn', deltaAmount: 50, requiredRole: 'manager' })).toBe(true);
  });
});

describe('re-match: a materially different finding starts fresh (router)', () => {
  it('rejected finding grows after a correction → open again, routed, not the old note', async () => {
    const A = await seedTenant(db, 'A');
    const caller = ownerCaller(A);
    await caller.match.runForInvoice({ invoiceId: A.invoiceId });
    const find = async () =>
      db
        .select({ id: discrepancies.id, type: discrepancies.type, status: discrepancies.resolutionStatus, delta: discrepancies.deltaAmount, note: discrepancies.resolutionNote })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .where(and(eq(matchRuns.invoiceId, A.invoiceId), eq(discrepancies.type, 'UNORDERED_ITEM')));
    const [item] = await find();
    expect(item).toBeDefined();
    await caller.approvals.reject({ discrepancyId: item!.id, reason: 'small, let it go' });
    // Unchanged re-match: still rejected.
    await caller.match.runForInvoice({ invoiceId: A.invoiceId });
    expect((await find())[0]).toMatchObject({ status: 'rejected', note: 'small, let it go' });
    // The billed line is corrected upward → the finding is bigger → a new decision is needed.
    await db.update(invoiceLines).set({ qtyBilled: '30', lineTotal: '300.00' }).where(eq(invoiceLines.invoiceId, A.invoiceId));
    await caller.match.runForInvoice({ invoiceId: A.invoiceId });
    const [after] = await find();
    expect(Number(after!.delta)).toBeGreaterThan(Number(item!.delta));
    expect(after).toMatchObject({ status: 'open', note: null });
  });

  it('duplicate rejected, then the number corrected to a DIFFERENT real original → open again (back in the leak)', async () => {
    const A = await seedTenant(db, 'A');
    const [orig] = await db.select().from(invoices).where(eq(invoices.id, A.invoiceId));
    const [copy] = await db
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceNumber: null,
        invoiceDate: orig!.invoiceDate,
        totalExclVat: '100.00',
        vatAmount: '17.00',
        totalInclVat: '117.00',
        status: 'parsed',
        source: 'photo',
        ocrPayload: { provider: 'reconciled', raw: { duplicateOf: { invoiceId: A.invoiceId, invoiceNumber: A.invoiceNumber } } },
        createdAt: new Date(orig!.createdAt.getTime() + 60_000),
      })
      .returning();
    await db.insert(invoiceLines).values({ invoiceId: copy!.id, productId: A.productId, rawDescription: 'rescan', qtyBilled: '10', unit: 'kg', unitPriceBilled: '10.00', lineTotal: '100.00' });
    const caller = ownerCaller(A);
    await caller.match.runForInvoice({ invoiceId: copy!.id });
    const dupOf = async () =>
      (
        await db
          .select({ id: discrepancies.id, status: discrepancies.resolutionStatus })
          .from(discrepancies)
          .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
          .where(and(eq(matchRuns.invoiceId, copy!.id), eq(discrepancies.type, 'DUPLICATE_INVOICE')))
      )[0];
    await caller.approvals.reject({ discrepancyId: (await dupOf())!.id, reason: 'not a duplicate' });
    await caller.match.runForInvoice({ invoiceId: copy!.id });
    expect((await dupOf())!.status).toBe('rejected'); // same duplicate: decision kept

    // It turns out to be a copy of ANOTHER real invoice of the supplier.
    const [other] = await db
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        invoiceNumber: 'INV-OTHER-7',
        invoiceDate: orig!.invoiceDate,
        totalExclVat: '100.00',
        vatAmount: '17.00',
        totalInclVat: '117.00',
        status: 'matched',
        source: 'photo',
        createdAt: new Date(orig!.createdAt.getTime() - 60_000),
      })
      .returning();
    await db
      .update(invoices)
      .set({ ocrPayload: { provider: 'reconciled', raw: { duplicateOf: { invoiceId: other!.id, invoiceNumber: 'INV-OTHER-7' } } } })
      .where(eq(invoices.id, copy!.id));
    await caller.match.runForInvoice({ invoiceId: copy!.id });
    expect((await dupOf())!.status).toBe('open');
  });
});
