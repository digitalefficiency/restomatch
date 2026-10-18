import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  invoiceLines,
  invoices,
  matchRuns,
  products,
  restaurants,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { computeLeakBreakdown, computeLeakHero } from '../leak-hero';
import { computeLeakGrouped, computeLeakSummary, computeLeakTrend } from '../leak-views';

const db = createDb(testDbUrl());

async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(restaurants);
}
beforeEach(resetDb);
afterAll(resetDb);

// Mid-October in Asia/Jerusalem (UTC+3).
const NOW = new Date('2026-10-15T09:00:00Z');
const OCT = new Date('2026-10-10T08:00:00Z');
const SEP = new Date('2026-09-20T08:00:00Z');
const OCT_LAST_YEAR = new Date('2025-10-12T08:00:00Z');

type D = {
  type: (typeof discrepancies.$inferInsert)['type'];
  severity: 'info' | 'warn' | 'block';
  delta: string;
  status?: 'open' | 'accepted' | 'rejected' | 'escalated' | 'resolved';
  product?: 'meat' | 'veg';
};

async function setup() {
  const [r] = await db.insert(restaurants).values({ name: 'Views Bistro' }).returning();
  const [butcher] = await db
    .insert(suppliers)
    .values({ restaurantId: r!.id, name: 'קצביית הכרם', nameEn: 'HaKerem Butchery' })
    .returning();
  const [grocer] = await db
    .insert(suppliers)
    .values({ restaurantId: r!.id, name: 'ירקות השרון', nameEn: 'Sharon Produce' })
    .returning();
  const [meat] = await db
    .insert(products)
    .values({ restaurantId: r!.id, canonicalName: 'אנטריקוט', nameEn: 'Entrecote', category: 'בשר' })
    .returning();
  const [veg] = await db
    .insert(products)
    .values({ restaurantId: r!.id, canonicalName: 'עגבניה', nameEn: 'Tomato', category: 'ירקות' })
    .returning();
  const productId = { meat: meat!.id, veg: veg!.id };
  let k = 0;
  async function invoice(o: { supplier: 'butcher' | 'grocer'; date: Date; excl: string; incl: string; d?: D[] }) {
    k += 1;
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: r!.id,
        supplierId: o.supplier === 'butcher' ? butcher!.id : grocer!.id,
        invoiceNumber: `V-${k}`,
        invoiceDate: o.date,
        totalExclVat: o.excl,
        vatAmount: '0',
        totalInclVat: o.incl,
        status: 'matched',
        source: 'photo',
      })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: r!.id, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    for (const d of o.d ?? []) {
      await db.insert(discrepancies).values({
        restaurantId: r!.id,
        matchRunId: mr!.id,
        type: d.type,
        severity: d.severity,
        deltaAmount: d.delta,
        productId: d.product ? productId[d.product] : null,
        resolutionStatus: d.status ?? 'open',
      });
    }
    return inv!.id;
  }
  return { restaurantId: r!.id, butcherId: butcher!.id, grocerId: grocer!.id, invoice };
}

async function demo() {
  const t = await setup();
  await t.invoice({
    supplier: 'butcher',
    date: OCT,
    excl: '1000',
    incl: '1180',
    d: [
      { type: 'PRICE_HIGHER', severity: 'block', delta: '40', product: 'meat' },
      { type: 'QTY_OVER', severity: 'warn', delta: '10', product: 'meat', status: 'accepted' },
      { type: 'PRICE_LOWER', severity: 'info', delta: '5', product: 'meat' }, // never a leak
    ],
  });
  await t.invoice({
    supplier: 'grocer',
    date: OCT,
    excl: '500',
    incl: '590',
    d: [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '20', product: 'veg' }],
  });
  await t.invoice({
    supplier: 'grocer',
    date: SEP,
    excl: '800',
    incl: '944',
    d: [{ type: 'QTY_SHORT', severity: 'warn', delta: '30', product: 'veg' }],
  });
  await t.invoice({
    supplier: 'butcher',
    date: OCT_LAST_YEAR,
    excl: '900',
    incl: '1062',
    d: [{ type: 'PRICE_HIGHER', severity: 'block', delta: '9', product: 'meat' }],
  });
  return t;
}

describe('computeLeakSummary', () => {
  it('default view (this month, no filters) equals the hero exactly', async () => {
    const t = await demo();
    const hero = await computeLeakHero(db, t.restaurantId, { now: NOW });
    const view = await computeLeakSummary(db, t.restaurantId, { period: 'this_month', now: NOW });
    expect(view).toEqual(hero);
    expect(view.leakIls).toBe(70);
    expect(view.spendIls).toBe(1500);
  });

  it('last_month equals the hero for monthOffset -1; custom range equals the same month', async () => {
    const t = await demo();
    const heroPrev = await computeLeakHero(db, t.restaurantId, { now: NOW, monthOffset: -1 });
    expect(await computeLeakSummary(db, t.restaurantId, { period: 'last_month', now: NOW })).toEqual(heroPrev);
    const custom = await computeLeakSummary(db, t.restaurantId, {
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
      now: NOW,
    });
    expect(custom.leakIls).toBe(70);
    expect(custom.monthStart).toBe('2026-09-30T21:00:00.000Z'); // local midnight Oct 1
  });

  it('compare: previous period and same period last year', async () => {
    const t = await demo();
    const prev = await computeLeakSummary(db, t.restaurantId, { period: 'this_month', now: NOW }, 'prev');
    expect(prev.leakIls).toBe(30);
    expect(prev.monthStart).toBe('2026-08-31T21:00:00.000Z');
    const yoy = await computeLeakSummary(db, t.restaurantId, { period: 'this_month', now: NOW }, 'yoy');
    expect(yoy.leakIls).toBe(9);
    expect(yoy.monthStart).toBe('2025-09-30T21:00:00.000Z');
  });

  it('wider periods aggregate: quarter, ytd, last 12 months', async () => {
    const t = await demo();
    const q = await computeLeakSummary(db, t.restaurantId, { period: 'quarter', now: NOW });
    expect(q.leakIls).toBe(70); // Oct–Dec
    const ytd = await computeLeakSummary(db, t.restaurantId, { period: 'ytd', now: NOW });
    expect(ytd.leakIls).toBe(100); // Sep + Oct 2026
    const l12 = await computeLeakSummary(db, t.restaurantId, { period: 'last_12m', now: NOW });
    expect(l12.leakIls).toBe(100); // Nov 2025 – Oct 2026 excludes Oct 2025
  });

  it('filters: supplier narrows leak AND spend; type/severity/status/category narrow the leak only', async () => {
    const t = await demo();
    const base = { period: 'this_month' as const, now: NOW };
    const bySupplier = await computeLeakSummary(db, t.restaurantId, { ...base, filters: { supplierIds: [t.grocerId] } });
    expect([bySupplier.leakIls, bySupplier.spendIls]).toEqual([20, 500]);
    const byType = await computeLeakSummary(db, t.restaurantId, { ...base, filters: { types: ['PRICE_HIGHER'] } });
    expect([byType.leakIls, byType.spendIls]).toEqual([60, 1500]);
    const bySeverity = await computeLeakSummary(db, t.restaurantId, { ...base, filters: { severities: ['block'] } });
    expect(bySeverity.leakIls).toBe(40);
    const byStatus = await computeLeakSummary(db, t.restaurantId, { ...base, filters: { statuses: ['accepted'] } });
    expect(byStatus.leakIls).toBe(10);
    const byCategory = await computeLeakSummary(db, t.restaurantId, { ...base, filters: { categories: ['ירקות'] } });
    expect(byCategory.leakIls).toBe(20);
  });

  it('rejects a custom period without valid dates', async () => {
    const t = await setup();
    await expect(computeLeakSummary(db, t.restaurantId, { period: 'custom', now: NOW })).rejects.toThrow();
    await expect(
      computeLeakSummary(db, t.restaurantId, { period: 'custom', from: "2026-10-01'--", to: '2026-10-02', now: NOW }),
    ).rejects.toThrow();
  });

  it('is restaurant-scoped', async () => {
    await demo();
    const other = await setup();
    const s = await computeLeakSummary(db, other.restaurantId, { period: 'ytd', now: NOW });
    expect([s.leakIls, s.spendIls, s.invoiceCount]).toEqual([0, 0, 0]);
  });
});

describe('computeLeakGrouped', () => {
  it('groups by supplier, category, product and type; rows sum to the leak', async () => {
    const t = await demo();
    const spec = { period: 'this_month' as const, now: NOW };
    const sup = await computeLeakGrouped(db, t.restaurantId, spec, 'supplier');
    expect(sup.map((r) => [r.labelEn, r.leakIls, r.count])).toEqual([
      ['HaKerem Butchery', 50, 2],
      ['Sharon Produce', 20, 1],
    ]);
    const cat = await computeLeakGrouped(db, t.restaurantId, spec, 'category');
    expect(cat.map((r) => [r.label, r.leakIls])).toEqual([
      ['בשר', 50],
      ['ירקות', 20],
    ]);
    const prod = await computeLeakGrouped(db, t.restaurantId, spec, 'product');
    expect(prod.map((r) => r.labelEn)).toEqual(['Entrecote', 'Tomato']);
    const type = await computeLeakGrouped(db, t.restaurantId, spec, 'type');
    expect(type.map((r) => [r.key, r.leakIls])).toEqual([
      ['PRICE_HIGHER', 60],
      ['QTY_OVER', 10],
    ]);
    expect(type.reduce((s, r) => s + r.leakIls, 0)).toBe(70);
  });

  it('compare period groups use the shifted range', async () => {
    const t = await demo();
    const prev = await computeLeakGrouped(db, t.restaurantId, { period: 'this_month', now: NOW }, 'type', 'prev');
    expect(prev.map((r) => [r.key, r.leakIls])).toEqual([['QTY_SHORT', 30]]);
  });
});

describe('computeLeakTrend', () => {
  it('daily buckets for a month; Σ points = summary', async () => {
    const t = await demo();
    const tr = await computeLeakTrend(db, t.restaurantId, { period: 'this_month', now: NOW });
    expect(tr.bucket).toBe('day');
    expect(tr.points.reduce((s, p) => s + p.leakIls, 0)).toBe(70);
    expect(tr.points[0]!.bucketStart).toBe('2026-10-09T21:00:00.000Z'); // local Oct 10
  });

  it('monthly buckets for 12 months', async () => {
    const t = await demo();
    const tr = await computeLeakTrend(db, t.restaurantId, { period: 'last_12m', now: NOW });
    expect(tr.bucket).toBe('month');
    expect(tr.points.map((p) => p.leakIls)).toEqual([30, 70]);
  });
});

describe('computeLeakBreakdown with a view', () => {
  it('honours period and filters; Σ invoice leak = view summary', async () => {
    const t = await demo();
    const view = { period: 'ytd' as const, now: NOW, filters: { supplierIds: [t.grocerId] } };
    const rows = await computeLeakBreakdown(db, t.restaurantId, { view });
    expect(rows.map((r) => r.leakIls).sort()).toEqual([20, 30]);
    const s = await computeLeakSummary(db, t.restaurantId, view);
    expect(rows.reduce((a, r) => a + r.leakIls, 0)).toBe(s.leakIls);
  });
});
