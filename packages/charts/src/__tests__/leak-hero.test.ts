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
import { computeLeakReport } from '../leak-report';
import { computeLeakSummary, computeLeakTrend } from '../leak-views';
import { computeBranchSnapshot } from '../chain';

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
    /** Invoice number (default H-n); null = a held copy stored without its number. */
    number?: string | null;
    /** A held re-scan: ocr_payload.raw.duplicateOf points at this invoice. */
    duplicateOf?: string;
  }) {
    n += 1;
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: r!.id,
        supplierId: s!.id,
        invoiceNumber: opts.number === undefined ? `H-${n}` : opts.number,
        ...(opts.duplicateOf
          ? { ocrPayload: { provider: 'reconciled', raw: { duplicateOf: { invoiceId: opts.duplicateOf, invoiceNumber: 'H-1' } } } }
          : {}),
        createdAt: new Date(opts.date.getTime() + n * 60_000),
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

  it('an unmatched invoice (e.g. parsed consolidated) is pending and kept out of the spend', async () => {
    const { restaurantId, invoice } = await setup();
    await invoice({
      date: THIS_MONTH,
      exclVat: '1000',
      inclVat: '1180',
      d: [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '15' }],
    });
    await invoice({ date: THIS_MONTH, exclVat: '2000', inclVat: '2360', matched: false });
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero.spendIls).toBe(1000);
    expect(hero.leakPct).toBeCloseTo(0.015, 10);
    expect(hero.pendingLinkCount).toBe(1);
    expect(hero.pendingLinkIls).toBe(2360);
    expect(hero.invoiceCount).toBe(2);
    expect(hero.matchedInvoiceCount).toBe(1);
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

describe('duplicate invoices (a held, re-photographed copy)', () => {
  // The probe from #63–#65: an original with a ₪5 over-charge, then a copy of
  // it (same number) raised DUPLICATE_INVOICE (block) at its full value.
  async function originalAndCopy(dupStatus: D['status'], opts: { originalMatched?: boolean } = {}) {
    const t = await setup();
    const original = await t.invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      ...(opts.originalMatched === false ? { matched: false } : { d: [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '5' }] }),
    });
    // What the worker stores for a re-scan whose number is taken (held copy).
    const copy = await t.invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      number: null,
      duplicateOf: original,
      d: [{ type: 'DUPLICATE_INVOICE', severity: 'block', delta: '118', status: dupStatus }],
    });
    return { ...t, original, copy };
  }

  it('original NOT in checked spend (unmatched / pending), copy open → the copy stays in spend', async () => {
    const { restaurantId } = await originalAndCopy('open', { originalMatched: false });
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    // Dropping the copy too would leave the goods in neither leak base nor spend.
    expect(hero.spendIls).toBe(100);
    expect(hero.leakIls).toBe(118);
    expect(hero.pendingLinkCount).toBe(1);
    expect(await computeLeakSummary(db, restaurantId, { period: 'this_month', now: NOW })).toEqual(hero);
    const report = await computeLeakReport(db, restaurantId, '2026-10');
    expect(report.bySupplier.reduce((a, x) => a + x.spendIls, 0)).toBe(100);
  });

  it('original pending a PO link (open UNORDERED_ARRIVAL) → the copy stays in spend', async () => {
    const t = await setup();
    const original = await t.invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      d: [{ type: 'UNORDERED_ARRIVAL', severity: 'warn', delta: '118' }],
    });
    await t.invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      number: null,
      duplicateOf: original,
      d: [{ type: 'DUPLICATE_INVOICE', severity: 'block', delta: '118' }],
    });
    const hero = await computeLeakHero(db, t.restaurantId, { now: NOW });
    expect(hero.spendIls).toBe(100);
  });

  it('a copy found by its (normalized) number, not a held re-scan, is matched to its original too', async () => {
    const t = await setup();
    await t.invoice({ date: THIS_MONTH, exclVat: '100', inclVat: '118', number: 'INV-0012' });
    await t.invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      number: 'inv 12',
      d: [{ type: 'DUPLICATE_INVOICE', severity: 'block', delta: '118' }],
    });
    const hero = await computeLeakHero(db, t.restaurantId, { now: NOW });
    expect(hero.spendIls).toBe(100);
    expect(hero.leakIls).toBe(118);
  });

  it('an open duplicate counts at the copy value, and the copy is not food spend', async () => {
    const { restaurantId } = await originalAndCopy('open');
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero.leakIls).toBe(123);
    // The copy bills the original's goods: the spend is the original's only.
    expect(hero.spendIls).toBe(100);
    expect(hero.leakPct).toBeCloseTo(1.23, 10);
    expect(hero.invoicesWithLeak).toBe(2);
    expect(hero.caughtBeforePaymentIls).toBe(123);
  });

  it('an escalated or accepted duplicate still counts', async () => {
    for (const status of ['escalated', 'accepted'] as const) {
      await resetDb();
      const { restaurantId } = await originalAndCopy(status);
      const hero = await computeLeakHero(db, restaurantId, { now: NOW });
      expect(hero.leakIls, status).toBe(123);
      expect(hero.spendIls, status).toBe(100);
    }
  });

  it('a duplicate rejected as "not a duplicate" is no leak, and the invoice is ordinary spend', async () => {
    const { restaurantId, copy } = await originalAndCopy('rejected');
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero.leakIls).toBe(5);
    expect(hero.spendIls).toBe(200);
    expect(hero.leakPct).toBeCloseTo(0.025, 10);
    expect(hero.invoicesWithLeak).toBe(1);
    expect(hero.caughtBeforePaymentIls).toBe(5);

    const rows = await computeLeakBreakdown(db, restaurantId, { now: NOW });
    expect(rows.map((r) => r.invoiceId)).not.toContain(copy);
    expect(rows).toHaveLength(1);
  });

  it('other rejected findings are unaffected: still leak (waived, not claimed)', async () => {
    const { restaurantId, invoice } = await setup();
    await invoice({
      date: THIS_MONTH,
      exclVat: '1000',
      inclVat: '1180',
      d: [
        { type: 'PRICE_HIGHER', severity: 'block', delta: '30', status: 'rejected' },
        { type: 'QTY_SHORT', severity: 'warn', delta: '20', status: 'rejected' },
        { type: 'VAT_MISMATCH', severity: 'warn', delta: '10', status: 'rejected' },
      ],
    });
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero.leakIls).toBe(60);
    expect(hero.spendIls).toBe(1000);
  });

  it('view summary and monthly report agree with the hero', async () => {
    for (const status of ['open', 'rejected'] as const) {
      await resetDb();
      const { restaurantId } = await originalAndCopy(status);
      const hero = await computeLeakHero(db, restaurantId, { now: NOW });
      expect(await computeLeakSummary(db, restaurantId, { period: 'this_month', now: NOW }), status).toEqual(hero);
      const report = await computeLeakReport(db, restaurantId, '2026-10');
      expect(report.hero, status).toEqual(hero);
      const supplierSpend = report.bySupplier.reduce((a, x) => a + x.spendIls, 0);
      expect(supplierSpend, status).toBe(hero.spendIls);
      const typeLeak = report.byType.reduce((a, x) => a + x.amountIls, 0);
      expect(typeLeak, status).toBe(status === 'open' ? 123 : 5);
      // A rejected duplicate is not a "waived" leak either.
      expect(report.status.waivedIls, status).toBe(0);
    }
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

describe('every surface sums to the hero (mutation guards: trend, chain suppliers, breakdown countsAsLeak)', () => {
  // One month with each kind of invoice that the spend / leak rules treat differently.
  async function mixedMonth() {
    const t = await setup();
    await t.invoice({ date: THIS_MONTH, exclVat: '1000', inclVat: '1180' }); // clean
    await t.invoice({
      date: THIS_MONTH,
      exclVat: '500',
      inclVat: '590',
      d: [
        { type: 'PRICE_HIGHER', severity: 'block', delta: '30' },
        { type: 'QTY_SHORT', severity: 'warn', delta: '20', status: 'rejected' }, // waived: still leak
        { type: 'PRICE_LOWER', severity: 'warn', delta: '7' }, // under-charge: not leak
        { type: 'QTY_OVER', severity: 'info', delta: '3' }, // inside tolerance: not leak
      ],
    });
    await t.invoice({ date: THIS_MONTH, exclVat: '300', inclVat: '354', matched: false }); // pending: neither
    await t.invoice({
      date: THIS_MONTH,
      exclVat: '200',
      inclVat: '236',
      d: [{ type: 'UNORDERED_ARRIVAL', severity: 'warn', delta: '236' }], // waiting for a PO link: neither
    });
    const original = await t.invoice({ date: THIS_MONTH, exclVat: '400', inclVat: '472' });
    await t.invoice({
      date: THIS_MONTH,
      exclVat: '400',
      inclVat: '472',
      number: null,
      duplicateOf: original,
      d: [{ type: 'DUPLICATE_INVOICE', severity: 'block', delta: '472' }], // leak, not spend
    });
    const notDup = await t.invoice({ date: THIS_MONTH, exclVat: '250', inclVat: '295', number: 'DUP-9' });
    await t.invoice({
      date: THIS_MONTH,
      exclVat: '250',
      inclVat: '295',
      number: 'dup 9',
      d: [{ type: 'DUPLICATE_INVOICE', severity: 'block', delta: '295', status: 'rejected' }], // "not a duplicate": spend, no leak
    });
    return { ...t, notDup };
  }
  // spend = 1000 + 500 + 400 (original) + 250 + 250; leak = 30 + 20 + 472.
  const SPEND = 2400;
  const LEAK = 522;

  it('hero', async () => {
    const { restaurantId } = await mixedMonth();
    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect([hero.leakIls, hero.spendIls]).toEqual([LEAK, SPEND]);
    expect(hero.pendingLinkCount).toBe(2);
  });

  it('trend: Σ bucket spend and leak = the hero', async () => {
    const { restaurantId } = await mixedMonth();
    const trend = await computeLeakTrend(db, restaurantId, { period: 'this_month', now: NOW });
    expect(trend.points.reduce((a, p) => a + p.spendIls, 0)).toBe(SPEND);
    expect(trend.points.reduce((a, p) => a + p.leakIls, 0)).toBe(LEAK);
  });

  it('chain branch: totals and Σ per-supplier spend / leak = the hero', async () => {
    const { restaurantId } = await mixedMonth();
    const snap = await computeBranchSnapshot(db, restaurantId, 'Hero Bistro', { spec: { period: 'this_month', now: NOW } });
    expect([snap.leakIls, snap.spendIls]).toEqual([LEAK, SPEND]);
    expect(snap.suppliers.reduce((a, x) => a + x.spendIls, 0)).toBe(SPEND);
    expect(snap.suppliers.reduce((a, x) => a + x.leakIls, 0)).toBe(LEAK);
  });

  it('report: supplier spend and by-type leak = the hero', async () => {
    const { restaurantId } = await mixedMonth();
    const report = await computeLeakReport(db, restaurantId, '2026-10');
    expect(report.bySupplier.reduce((a, x) => a + x.spendIls, 0)).toBe(SPEND);
    expect(report.byType.reduce((a, x) => a + x.amountIls, 0)).toBe(LEAK);
    expect(report.status.waivedIls).toBe(20);
  });

  it('breakdown: countsAsLeak marks exactly the lines the hero counts', async () => {
    const { restaurantId } = await mixedMonth();
    const rows = await computeLeakBreakdown(db, restaurantId, { now: NOW });
    const lines = rows.flatMap((r) => r.lines.map((l) => `${l.type}:${l.resolutionStatus}:${l.countsAsLeak}`)).sort();
    expect(lines).toEqual(
      [
        'DUPLICATE_INVOICE:open:true',
        'PRICE_HIGHER:open:true',
        'PRICE_LOWER:open:false',
        'QTY_OVER:open:false',
        'QTY_SHORT:rejected:true',
        'UNORDERED_ARRIVAL:open:false',
      ].sort(),
    );
    const counted = rows.flatMap((r) => r.lines).filter((l) => l.countsAsLeak).reduce((a, l) => a + l.deltaAmount, 0);
    expect(counted).toBe(LEAK);
    // The rejected "not a duplicate" invoice has no leak, so it isn't in the list at all.
    expect(rows.some((r) => r.lines.some((l) => l.type === 'DUPLICATE_INVOICE' && l.resolutionStatus === 'rejected'))).toBe(false);
  });

  it('breakdown with a view: the view’s line filter decides countsAsLeak', async () => {
    const { restaurantId } = await mixedMonth();
    const rows = await computeLeakBreakdown(db, restaurantId, {
      view: { period: 'this_month', now: NOW, filters: { types: ['PRICE_HIGHER'] } },
    });
    const counted = rows.flatMap((r) => r.lines).filter((l) => l.countsAsLeak);
    expect(counted.map((l) => l.type)).toEqual(['PRICE_HIGHER']);
  });
});
