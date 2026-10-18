import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  createDb,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  matchRuns,
  priceHistory,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { normalizeInvoiceNumber } from '../match/buildMatchInput';
import { backfillPriceHistory, writePriceHistoryForInvoice } from '../match/priceHistory';
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
