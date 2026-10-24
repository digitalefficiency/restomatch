import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  priceHistory,
  restaurants,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { DOCK_PRICE_MIN_SAMPLES, dockPriceContext } from '../dockPriceContext/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const INVOICE_DATE = new Date('2026-10-20T08:00:00Z');
const daysBefore = (d: number) => new Date(INVOICE_DATE.getTime() - d * 86_400_000);

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

async function setFeatures(t: Tenant, features: Record<string, boolean> | null) {
  await db
    .update(restaurants)
    .set({ settings: (features ? { features } : {}) as RestaurantSettings })
    .where(eq(restaurants.id, t.restaurantId));
}

/** Prices (per kg, the product's default unit) observed `daysBefore` the invoice. */
async function seedHistory(t: Tenant, rows: Array<[days: number, price: string]>, sourceInvoiceId?: string) {
  await db.insert(priceHistory).values(
    rows.map(([d, price]) => ({
      restaurantId: t.restaurantId,
      productId: t.productId,
      supplierId: t.supplierId,
      observedAt: daysBefore(d),
      unitPrice: price,
      sourceInvoiceId: sourceInvoiceId ?? null,
    })),
  );
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) {
    await db.update(invoices).set({ invoiceDate: INVOICE_DATE }).where(eq(invoices.id, t.invoiceId));
  }
});

beforeEach(async () => {
  await db.delete(priceHistory);
  await db.update(invoiceLines).set({ unit: 'kg', unitPriceBilled: '10.00' }).where(eq(invoiceLines.id, A.invoiceLineId));
  await db.update(discrepancies).set({ invoiceLineId: null }).where(eq(discrepancies.id, A.discrepancyId));
  await setFeatures(A, { all: true });
  await setFeatures(B, { all: true });
});

afterAll(async () => {
  await resetDb(db);
});

describe('dockPriceContext service', () => {
  it('p50 of the 90 days before the invoice, in the line unit, with the % vs usual', async () => {
    await seedHistory(A, [[5, '8.00'], [20, '8.50'], [40, '9.00'], [60, '8.00'], [80, '8.50']]);
    const [line, ...rest] = await dockPriceContext(db, A.restaurantId, A.invoiceId);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      invoiceLineId: A.invoiceLineId,
      productId: A.productId,
      unit: 'kg',
      billedUnitPrice: 10,
      usualUnitPrice: 8.5,
      samples: 5,
      priceHigher: false,
    });
    expect(line!.pctVsUsual).toBeCloseTo(1.5 / 8.5, 10);
  });

  it(`needs ≥ ${DOCK_PRICE_MIN_SAMPLES} observations — fewer means no context at all`, async () => {
    await seedHistory(A, [[5, '8.00'], [20, '8.50']]);
    expect(await dockPriceContext(db, A.restaurantId, A.invoiceId)).toEqual([]);
  });

  it('ignores the invoice itself, anything older than 90 days, and anything after the invoice', async () => {
    await seedHistory(A, [[5, '8.00'], [20, '8.00']]);
    await seedHistory(A, [[0.5, '10.00']], A.invoiceId); // this invoice's own row
    await seedHistory(A, [[95, '2.00'], [120, '2.00']]); // outside the window
    await seedHistory(A, [[-3, '20.00']]); // a later invoice
    expect(await dockPriceContext(db, A.restaurantId, A.invoiceId)).toEqual([]);
    await seedHistory(A, [[30, '9.00']]);
    const [line] = await dockPriceContext(db, A.restaurantId, A.invoiceId);
    expect(line).toMatchObject({ usualUnitPrice: 8, samples: 3 });
  });

  it('converts the per-kg median into the billed unit (g) and skips unconvertible units', async () => {
    await seedHistory(A, [[5, '8.00'], [20, '8.00'], [40, '8.00']]);
    await db.update(invoiceLines).set({ unit: 'g', unitPriceBilled: '0.0100' }).where(eq(invoiceLines.id, A.invoiceLineId));
    const [g] = await dockPriceContext(db, A.restaurantId, A.invoiceId);
    expect(g).toMatchObject({ unit: 'g', usualUnitPrice: 0.008 });
    expect(g!.pctVsUsual).toBeCloseTo(0.25, 10);

    await db.update(invoiceLines).set({ unit: 'ליטר' }).where(eq(invoiceLines.id, A.invoiceLineId));
    expect(await dockPriceContext(db, A.restaurantId, A.invoiceId)).toEqual([]);
  });

  it('marks lines the matcher flagged PRICE_HIGHER', async () => {
    await seedHistory(A, [[5, '8.00'], [20, '8.00'], [40, '8.00']]);
    await db.update(discrepancies).set({ invoiceLineId: A.invoiceLineId }).where(eq(discrepancies.id, A.discrepancyId));
    const [line] = await dockPriceContext(db, A.restaurantId, A.invoiceId);
    expect(line!.priceHigher).toBe(true);
  });

  it("never reads another restaurant's history or invoice", async () => {
    await seedHistory(B, [[5, '1.00'], [20, '1.00'], [40, '1.00']]);
    expect(await dockPriceContext(db, A.restaurantId, A.invoiceId)).toEqual([]);
    await seedHistory(A, [[5, '8.00'], [20, '8.00'], [40, '8.00']]);
    expect(await dockPriceContext(db, A.restaurantId, B.invoiceId)).toEqual([]);
  });
});

describe('receiving.priceContext (flag dockPriceContext)', () => {
  it('flag off → { enabled: false } and no lines, even with history', async () => {
    await seedHistory(A, [[5, '8.00'], [20, '8.00'], [40, '8.00']]);
    await setFeatures(A, { all: true, dockPriceContext: false });
    expect(await caller(A).receiving.priceContext({ invoiceId: A.invoiceId })).toEqual({ enabled: false, lines: [] });
    await setFeatures(A, null);
    expect(await caller(A).receiving.priceContext({})).toEqual({ enabled: false, lines: [] });
  });

  it('flag on → probe without an invoice, lines with one; receivers may read it', async () => {
    await seedHistory(A, [[5, '8.00'], [20, '8.00'], [40, '8.00']]);
    expect(await caller(A).receiving.priceContext({})).toEqual({ enabled: true, lines: [] });
    const r = await caller(A, 'receiver').receiving.priceContext({ invoiceId: A.invoiceId });
    expect(r.enabled).toBe(true);
    expect(r.lines.map((l) => l.invoiceLineId)).toEqual([A.invoiceLineId]);
  });

  it('a chef cannot read invoice prices (same roles as receiving.getInvoice)', async () => {
    await expect(caller(A, 'chef').receiving.priceContext({ invoiceId: A.invoiceId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it("tenant A asking for B's invoice gets nothing", async () => {
    await seedHistory(B, [[5, '8.00'], [20, '8.00'], [40, '8.00']]);
    expect(await caller(A).receiving.priceContext({ invoiceId: B.invoiceId })).toEqual({ enabled: true, lines: [] });
  });
});
