import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  invoiceLines,
  invoices,
  matchRuns,
  priceHistory,
  products,
  restaurants,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { computeLeakReport, parseReportMonth } from '../leak-report';
import { computeLeakHero } from '../leak-hero';

const db = createDb(testDbUrl());

async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(priceHistory);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(restaurants);
}
beforeEach(resetDb);
afterAll(resetDb);

const IN_MONTH = new Date('2026-09-10T08:00:00Z');
const BEFORE = new Date('2026-08-05T08:00:00Z');

type D = {
  type: (typeof discrepancies.$inferInsert)['type'];
  severity: 'info' | 'warn' | 'block';
  delta: string;
  status?: 'open' | 'accepted' | 'rejected' | 'escalated' | 'resolved';
};

async function setup() {
  const [r] = await db.insert(restaurants).values({ name: 'Report Bistro' }).returning();
  const [s1] = await db
    .insert(suppliers)
    .values({ restaurantId: r!.id, name: 'קצביית הכרם', nameEn: 'HaKerem Butchery' })
    .returning();
  const [s2] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ירקות השרון' }).returning();
  const [p] = await db
    .insert(products)
    .values({ restaurantId: r!.id, canonicalName: 'אנטריקוט', nameEn: 'Entrecôte', defaultUnit: 'ק״ג' })
    .returning();
  let k = 0;
  async function invoice(supplierId: string, opts: { exclVat: string; inclVat: string; status?: 'matched' | 'paid'; d?: D[]; matched?: boolean }) {
    k += 1;
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: r!.id,
        supplierId,
        invoiceNumber: `R-${k}`,
        invoiceDate: IN_MONTH,
        totalExclVat: opts.exclVat,
        vatAmount: '0',
        totalInclVat: opts.inclVat,
        status: opts.status ?? 'matched',
        source: 'photo',
      })
      .returning();
    if (opts.matched === false) return;
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: r!.id, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    for (const d of opts.d ?? []) {
      await db.insert(discrepancies).values({
        restaurantId: r!.id,
        matchRunId: mr!.id,
        type: d.type,
        severity: d.severity,
        deltaAmount: d.delta,
        resolutionStatus: d.status ?? 'open',
      });
    }
  }
  async function price(supplierId: string, at: Date, unitPrice: string, qty: string) {
    await db.insert(priceHistory).values({
      restaurantId: r!.id,
      productId: p!.id,
      supplierId,
      observedAt: at,
      unitPrice,
      qty,
    });
  }
  return { restaurantId: r!.id, s1: s1!.id, s2: s2!.id, invoice, price };
}

describe('parseReportMonth', () => {
  it('accepts YYYY-MM and rejects anything else', () => {
    expect(parseReportMonth('2026-09')).toEqual({ year: 2026, month: 9 });
    expect(() => parseReportMonth('2026-13')).toThrow();
    expect(() => parseReportMonth('2026-9')).toThrow();
    expect(() => parseReportMonth("2026-09'; drop")).toThrow();
  });
});

describe('computeLeakReport', () => {
  it('breaks the hero down by type and supplier; supplier rows sum to the hero', async () => {
    const t = await setup();
    await t.invoice(t.s1, {
      exclVat: '1000',
      inclVat: '1180',
      d: [
        { type: 'PRICE_HIGHER', severity: 'block', delta: '40' },
        { type: 'QTY_OVER', severity: 'block', delta: '20', status: 'accepted' },
        { type: 'PRICE_LOWER', severity: 'info', delta: '9' },
        { type: 'QTY_SHORT', severity: 'warn', delta: '0' }, // zero after overlap → omitted
      ],
    });
    await t.invoice(t.s2, {
      exclVat: '500',
      inclVat: '590',
      d: [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '10', status: 'rejected' }],
    });
    await t.invoice(t.s2, { exclVat: '700', inclVat: '826', matched: false }); // pending: out of spend

    const rep = await computeLeakReport(db, t.restaurantId, '2026-09');
    expect(rep.hero.leakIls).toBe(70);
    expect(rep.hero.spendIls).toBe(1500);
    expect(rep.byType).toEqual([
      { type: 'PRICE_HIGHER', count: 2, amountIls: 50 },
      { type: 'QTY_OVER', count: 1, amountIls: 20 },
    ]);
    expect(rep.bySupplier.map((s) => [s.supplierNameEn ?? s.supplierName, s.invoiceCount, s.spendIls, s.leakIls])).toEqual([
      ['HaKerem Butchery', 1, 1000, 60],
      ['ירקות השרון', 1, 500, 10],
    ]);
    expect(rep.bySupplier.reduce((s, r) => s + r.leakIls, 0)).toBe(rep.hero.leakIls);
    expect(rep.bySupplier[0]!.leakPct).toBeCloseTo(0.06, 10);
    expect(rep.capAdjustmentIls).toBe(0);
    expect(rep.status).toMatchObject({
      stillOpenIls: 40,
      stillOpenCount: 1,
      claimedIls: 20,
      claimedCount: 1,
      waivedIls: 10,
      waivedCount: 1,
      creditRequestSuppliers: 1,
      caughtBeforePaymentIls: 70,
    });
  });

  it('reports the per-invoice cap as capAdjustment', async () => {
    const t = await setup();
    await t.invoice(t.s1, {
      exclVat: '100',
      inclVat: '118',
      d: [
        { type: 'DUPLICATE_INVOICE', severity: 'block', delta: '118' },
        { type: 'PRICE_HIGHER', severity: 'block', delta: '30' },
      ],
    });
    const rep = await computeLeakReport(db, t.restaurantId, '2026-09');
    expect(rep.hero.leakIls).toBe(118);
    expect(rep.capAdjustmentIls).toBe(30);
    expect(rep.bySupplier[0]!.leakIls).toBe(118);
  });

  it('price creep: month average vs the 90-day median before the month', async () => {
    const t = await setup();
    await t.price(t.s1, BEFORE, '139.0000', '6');
    await t.price(t.s1, new Date('2026-08-12T08:00:00Z'), '139.0000', '6');
    await t.price(t.s1, new Date('2026-08-20T08:00:00Z'), '141.0000', '6');
    await t.price(t.s1, IN_MONTH, '147.0000', '9');
    await t.price(t.s1, new Date('2026-09-20T08:00:00Z'), '147.0000', '9');
    // A flat product/supplier pair (s2) must not appear.
    await t.price(t.s2, BEFORE, '10.0000', '5');
    await t.price(t.s2, IN_MONTH, '10.1000', '5');

    const rep = await computeLeakReport(db, t.restaurantId, '2026-09');
    expect(rep.priceCreep).toHaveLength(1);
    expect(rep.priceCreep[0]).toMatchObject({
      productNameEn: 'Entrecôte',
      supplierNameEn: 'HaKerem Butchery',
      beforePrice: 139,
      afterPrice: 147,
      qty: 18,
      excessIls: 144, // (147 − 139) × 18
    });
    expect(rep.priceCreep[0]!.deltaPct).toBeCloseTo(8 / 139, 10);
  });

  it('matches the hero for the same month and stays restaurant-scoped', async () => {
    const a = await setup();
    const b = await setup();
    await b.invoice(b.s1, { exclVat: '100', inclVat: '118', d: [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '7' }] });
    await a.invoice(a.s1, { exclVat: '300', inclVat: '354', d: [{ type: 'QTY_OVER', severity: 'block', delta: '12' }] });
    const rep = await computeLeakReport(db, a.restaurantId, '2026-09');
    const hero = await computeLeakHero(db, a.restaurantId, { now: new Date('2026-09-15T12:00:00Z') });
    expect(rep.hero).toEqual(hero);
    expect(rep.hero.leakIls).toBe(12);
    expect(rep.bySupplier).toHaveLength(1);
  });

  it('an empty month is all zeros', async () => {
    const t = await setup();
    const rep = await computeLeakReport(db, t.restaurantId, '2026-09');
    expect(rep.hero.leakIls).toBe(0);
    expect(rep.byType).toEqual([]);
    expect(rep.bySupplier).toEqual([]);
    expect(rep.priceCreep).toEqual([]);
    expect(rep.status.stillOpenIls).toBe(0);
  });
});
