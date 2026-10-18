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

// Mid-month in Asia/Jerusalem so the month bounds are unambiguous.
const NOW = new Date('2026-10-15T09:00:00Z');
const THIS_MONTH = new Date('2026-10-10T08:00:00Z');
const LAST_MONTH = new Date('2026-09-20T08:00:00Z');

type D = {
  type: (typeof discrepancies.$inferInsert)['type'];
  severity: 'info' | 'warn' | 'block';
  delta: string;
  status?: 'open' | 'accepted' | 'rejected' | 'escalated' | 'resolved';
};

async function setup() {
  const [r] = await db.insert(restaurants).values({ name: 'Hero Bistro' }).returning();
  const [s] = await db
    .insert(suppliers)
    .values({ restaurantId: r!.id, name: 'ירקות השרון', nameEn: 'Sharon Produce' })
    .returning();
  const [p] = await db
    .insert(products)
    .values({ restaurantId: r!.id, canonicalName: 'עגבניה', nameEn: 'Tomato', defaultUnit: 'ק״ג' })
    .returning();

  let n = 0;
  async function invoice(opts: {
    date: Date;
    exclVat: string;
    inclVat: string;
    status?: 'matched' | 'disputed' | 'paid';
    d?: D[];
    matched?: boolean;
  }) {
    n += 1;
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: r!.id,
        supplierId: s!.id,
        invoiceNumber: `H-${n}`,
        invoiceDate: opts.date,
        totalExclVat: opts.exclVat,
        vatAmount: '0',
        totalInclVat: opts.inclVat,
        status: opts.status ?? 'matched',
        source: 'photo',
      })
      .returning();
    const [line] = await db
      .insert(invoiceLines)
      .values({
        invoiceId: inv!.id,
        productId: p!.id,
        rawDescription: 'עגבניות שרי',
        rawDescriptionEn: 'Cherry tomatoes',
        qtyBilled: '1',
        unit: 'ק״ג',
        unitPriceBilled: opts.exclVat,
        lineTotal: opts.exclVat,
      })
      .returning();
    if (opts.matched === false) return inv!.id;
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
        productId: p!.id,
        invoiceLineId: line!.id,
        resolutionStatus: d.status ?? 'open',
      });
    }
    return inv!.id;
  }
  return { restaurantId: r!.id, invoice };
}

describe('computeLeakHero', () => {
  it('empty restaurant → zeros and a null pct', async () => {
    const { restaurantId } = await setup();
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero).toMatchObject({ leakIls: 0, spendIls: 0, leakPct: null, invoiceCount: 0 });
    // Local (Asia/Jerusalem, UTC+3 in October) month start.
    expect(hero.monthStart).toBe('2026-09-30T21:00:00.000Z');
  });

  it('counts warn/block leak, excludes info + PRICE_LOWER, computes % of spend', async () => {
    const { restaurantId, invoice } = await setup();
    await invoice({
      date: THIS_MONTH,
      exclVat: '1000',
      inclVat: '1180',
      d: [
        { type: 'PRICE_HIGHER', severity: 'block', delta: '30.50' },
        { type: 'QTY_SHORT', severity: 'warn', delta: '19.50' },
        { type: 'QTY_SHORT', severity: 'info', delta: '4.00' }, // inside tolerance band
        { type: 'PRICE_LOWER', severity: 'info', delta: '12.00' }, // supplier undercharged
      ],
    });
    await invoice({ date: THIS_MONTH, exclVat: '1000', inclVat: '1180' }); // clean
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero.leakIls).toBe(50);
    expect(hero.spendIls).toBe(2000);
    expect(hero.leakPct).toBeCloseTo(0.025, 10);
    expect(hero.invoicesWithLeak).toBe(1);
    expect(hero.invoiceCount).toBe(2);
    expect(hero.matchedInvoiceCount).toBe(2);
  });

  it('caps an invoice at its own total (stacked duplicate + line findings)', async () => {
    const { restaurantId, invoice } = await setup();
    await invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      d: [
        { type: 'DUPLICATE_INVOICE', severity: 'block', delta: '118' },
        { type: 'PRICE_HIGHER', severity: 'block', delta: '40' },
      ],
    });
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero.leakIls).toBe(118);
  });

  it('consolidated / no-PO invoices are pending, not leak', async () => {
    const { restaurantId, invoice } = await setup();
    await invoice({
      date: THIS_MONTH,
      exclVat: '5000',
      inclVat: '5900',
      d: [{ type: 'UNORDERED_ARRIVAL', severity: 'block', delta: '5900' }],
    });
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero.leakIls).toBe(0);
    expect(hero.pendingLinkCount).toBe(1);
    expect(hero.pendingLinkIls).toBe(5900);
  });

  it('caught-before-payment excludes paid invoices; recovered = accepted claims', async () => {
    const { restaurantId, invoice } = await setup();
    await invoice({
      date: THIS_MONTH,
      exclVat: '500',
      inclVat: '590',
      d: [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '20', status: 'accepted' }],
    });
    await invoice({
      date: THIS_MONTH,
      exclVat: '500',
      inclVat: '590',
      status: 'paid',
      d: [{ type: 'QTY_OVER', severity: 'block', delta: '30' }],
    });
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero.leakIls).toBe(50);
    expect(hero.caughtBeforePaymentIls).toBe(20);
    expect(hero.recoveredIls).toBe(20);
  });

  it('attributes by invoice month; monthOffset reaches last month', async () => {
    const { restaurantId, invoice } = await setup();
    await invoice({
      date: LAST_MONTH,
      exclVat: '200',
      inclVat: '236',
      d: [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '9.99' }],
    });
    expect((await computeLeakHero(db, restaurantId, { now: NOW })).leakIls).toBe(0);
    const last = await computeLeakHero(db, restaurantId, { now: NOW, monthOffset: -1 });
    expect(last.leakIls).toBe(9.99);
    expect(last.spendIls).toBe(200);
  });

  it('is restaurant-scoped', async () => {
    const a = await setup();
    const b = await setup();
    await b.invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      d: [{ type: 'PRICE_HIGHER', severity: 'block', delta: '10' }],
    });
    const hero = await computeLeakHero(db, a.restaurantId, { now: NOW });
    expect(hero.leakIls).toBe(0);
    expect(hero.spendIls).toBe(0);
  });
});

describe('computeLeakBreakdown', () => {
  it('lists leaking invoices biggest-first with their lines and English names', async () => {
    const { restaurantId, invoice } = await setup();
    const small = await invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      d: [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '5' }],
    });
    const big = await invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      d: [
        { type: 'QTY_OVER', severity: 'block', delta: '40' },
        { type: 'PRICE_LOWER', severity: 'info', delta: '2' },
      ],
    });
    const pending = await invoice({
      date: THIS_MONTH,
      exclVat: '900',
      inclVat: '1062',
      d: [{ type: 'UNORDERED_ARRIVAL', severity: 'block', delta: '1062' }],
    });
    await invoice({ date: THIS_MONTH, exclVat: '100', inclVat: '118' }); // clean → omitted

    const rows = await computeLeakBreakdown(db, restaurantId, { now: NOW });
    expect(rows.map((r) => r.invoiceId)).toEqual([big, small, pending]);
    expect(rows[0]!.leakIls).toBe(40);
    expect(rows[0]!.supplierNameEn).toBe('Sharon Produce');
    expect(rows[0]!.lines.map((l) => [l.type, l.countsAsLeak])).toEqual([
      ['QTY_OVER', true],
      ['PRICE_LOWER', false],
    ]);
    expect(rows[0]!.lines[0]).toMatchObject({
      productName: 'עגבניה',
      productNameEn: 'Tomato',
      lineDescriptionEn: 'Cherry tomatoes',
    });
    expect(rows[2]).toMatchObject({ pendingLink: true, leakIls: 0 });
    // The breakdown sums to the hero.
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(rows.reduce((s, r) => s + r.leakIls, 0)).toBe(hero.leakIls);
  });
});
