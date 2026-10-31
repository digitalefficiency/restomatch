import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  invoiceLines,
  invoices,
  matchRuns,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import {
  computeInvoiceLeak,
  computeInvoicesLeak,
  computeLeakBreakdown,
  computeLeakHero,
  invoiceLeakStateCte,
  monthInvoicesCte,
} from '../leak-hero';
import { sql } from '@restomatch/db';
import { LEAK_FILTER } from '../leak-views';
import { computeLeakReport } from '../leak-report';
import { computeLeakSummary, computeLeakTrend } from '../leak-views';
import { computeBranchSnapshot } from '../chain';

const db = createDb(testDbUrl());

async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(goodsReceipts);
  await db.delete(purchaseOrders);
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
  /** Invoice-level finding (DUPLICATE_INVOICE, TOTAL_MISMATCH, VAT_MISMATCH): no invoice line. */
  invoiceLevel?: boolean;
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
        invoiceLineId: d.invoiceLevel ? null : line!.id,
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

  it('computeInvoicesLeak is restaurant-scoped, dedupes ids and caps at the invoice total', async () => {
    const a = await setup();
    const capped = await a.invoice({
      date: THIS_MONTH,
      exclVat: '100',
      inclVat: '118',
      d: [
        { type: 'DUPLICATE_INVOICE', severity: 'block', delta: '118', invoiceLevel: true, status: 'accepted' },
        { type: 'PRICE_HIGHER', severity: 'warn', delta: '20' },
      ],
    });
    const b = await setup();
    const foreign = await b.invoice({ date: THIS_MONTH, exclVat: '50', inclVat: '59', d: [{ type: 'QTY_SHORT', severity: 'warn', delta: '9' }] });
    const got = await computeInvoicesLeak(db, a.restaurantId, [capped, foreign, capped]);
    expect([...got.keys()]).toEqual([capped]);
    expect(got.get(capped)!.leakIls).toBe(118);
    expect(await computeInvoicesLeak(db, a.restaurantId, [])).toEqual(new Map());
    expect(await computeInvoiceLeak(db, a.restaurantId, foreign)).toBeNull();
    const rows = (r: unknown) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Record<string, unknown>[];
    const [st] = rows(
      await db.execute(sql`WITH ${invoiceLeakStateCte(a.restaurantId, [capped])} SELECT raw_leak, leak, raw_recovered, recovered FROM per`),
    );
    expect([st!.raw_leak, st!.leak, st!.raw_recovered, st!.recovered].map(Number)).toEqual([138, 118, 118, 118]);
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

describe('leak proof sheet basis (flag leakProof: hero + breakdown only)', () => {
  it('breakdown leaks sum to the hero to the agora, counts are ordered, findings carry their invoice line', async () => {
    const { restaurantId, invoice } = await setup();
    const a = await invoice({
      date: THIS_MONTH,
      exclVat: '200',
      inclVat: '236',
      d: [
        { type: 'PRICE_HIGHER', severity: 'warn', delta: '12.34' },
        { type: 'DUPLICATE_INVOICE', severity: 'block', delta: '0.01', invoiceLevel: true },
      ],
    });
    await invoice({ date: THIS_MONTH, exclVat: '100', inclVat: '118', d: [{ type: 'QTY_SHORT', severity: 'block', delta: '-7.65' }] });
    await invoice({ date: THIS_MONTH, exclVat: '50', inclVat: '59' }); // matched, clean
    await invoice({ date: THIS_MONTH, exclVat: '900', inclVat: '1062', matched: false }); // pending, unmatched
    // Pending-link (no PO) AND a ₪1.00 VAT finding: pending invoices still count toward the leak.
    const pendingWithLeak = await invoice({
      date: THIS_MONTH,
      exclVat: '50',
      inclVat: '59',
      d: [
        { type: 'UNORDERED_ARRIVAL', severity: 'block', delta: '59' },
        { type: 'VAT_MISMATCH', severity: 'warn', delta: '1', invoiceLevel: true },
      ],
    });

    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    const rows = await computeLeakBreakdown(db, restaurantId, { now: NOW, limit: 200 });
    const agorot = (v: number) => Math.round(v * 100);
    // Σ over ALL breakdown rows (pending ones included) == hero leak, to the agora.
    expect(rows.length).toBeLessThan(200);
    expect(rows.reduce((s, r) => s + agorot(r.leakIls), 0)).toBe(agorot(hero.leakIls));
    expect(agorot(hero.leakIls)).toBe(2100); // 12.34 + 0.01 + 7.65 + 1.00 (pending invoice)
    expect(rows.find((r) => r.invoiceId === pendingWithLeak)).toMatchObject({ pendingLink: true, leakIls: 1 });
    expect(hero.invoicesWithLeak).toBeLessThanOrEqual(hero.matchedInvoiceCount);
    expect(hero.matchedInvoiceCount).toBeLessThanOrEqual(hero.invoiceCount);
    expect(hero.pendingLinkCount).toBe(2);
    const lines = rows.find((r) => r.invoiceId === a)!.lines;
    expect(lines.find((l) => l.type === 'PRICE_HIGHER')!.invoiceLineId).toEqual(expect.any(String));
    expect(lines.find((l) => l.type === 'DUPLICATE_INVOICE')!.invoiceLineId).toBeNull();
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

  it('batch computeInvoicesLeak = per-invoice computeInvoiceLeak, and Σ = the hero (W2-09a)', async () => {
    const { restaurantId } = await mixedMonth();
    const all = (await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.restaurantId, restaurantId))).map(
      (r) => r.id,
    );
    const batch = await computeInvoicesLeak(db, restaurantId, [...all].reverse());
    expect([...batch.keys()]).toEqual([...all].reverse()); // input order
    for (const id of all) expect(batch.get(id)).toEqual(await computeInvoiceLeak(db, restaurantId, id));
    // Σ over the non-pending invoices (the hero's leak basis) is the hero, to the agora.
    const agorot = [...batch.values()].reduce((a, v) => a + Math.round(v.leakIls * 100), 0);
    expect(agorot).toBe(LEAK * 100);
  });

  it('parity: the new batch = the pre-W2-09a single-invoice SQL (verbatim reference), every invoice', async () => {
    const { restaurantId } = await mixedMonth();
    const rows = (r: unknown) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Record<string, unknown>[];
    // The computeInvoiceLeak query as it was before W2-09a (release/wave-1-clean), kept here as the oracle.
    const legacy = async (invoiceId: string) =>
      rows(
        await db.execute(sql`
        WITH per AS (
          SELECT
            i.id,
            i.status,
            COALESCE(i.total_incl_vat, 0) AS total,
            COALESCE(SUM(ABS(d.delta_amount)) FILTER (WHERE ${LEAK_FILTER}), 0) AS raw_leak,
            (NOT bool_or(mr.id IS NOT NULL))
              OR COALESCE(bool_or(d.type = 'UNORDERED_ARRIVAL' AND d.resolution_status IN ('open','escalated')), false)
              AS pending_link
          FROM invoices i
          LEFT JOIN match_runs mr ON mr.invoice_id = i.id AND mr.restaurant_id = ${restaurantId}
          LEFT JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
          WHERE i.id = ${invoiceId}::uuid AND i.restaurant_id = ${restaurantId}
          GROUP BY i.id, i.status, i.total_incl_vat
        )
        SELECT per.id, per.status, per.total, LEAST(per.raw_leak, per.total) AS leak, per.pending_link FROM per`),
      )[0];
    const all = (await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.restaurantId, restaurantId))).map(
      (r) => r.id,
    );
    const batch = await computeInvoicesLeak(db, restaurantId, all);
    expect(batch.size).toBe(all.length);
    for (const id of all) {
      const old = (await legacy(id))!;
      const now = batch.get(id)!;
      expect([now.status, Math.round(now.totalInclVat * 100), Math.round(now.leakIls * 100), now.pendingLink]).toEqual([
        String(old.status),
        Math.round(Number(old.total) * 100),
        Math.round(Number(old.leak) * 100),
        Boolean(old.pending_link),
      ]);
    }
  });

  it('exported CTEs: monthInvoicesCte and invoiceLeakStateCte agree per invoice with the hero', async () => {
    const { restaurantId } = await mixedMonth();
    const rows = (r: unknown) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Record<string, unknown>[];
    const month = rows(
      await db.execute(sql`WITH ${monthInvoicesCte(restaurantId, NOW, 0)}
        SELECT id, LEAST(raw_leak, total) AS leak, pending_link FROM per ORDER BY id`),
    );
    const ids = month.map((m) => String(m.id));
    const state = rows(
      await db.execute(sql`WITH ${invoiceLeakStateCte(restaurantId, ids)}
        SELECT id, leak, raw_leak, recovered, matched, pending_link FROM per ORDER BY id`),
    );
    expect(state.map((r) => [String(r.id), Number(r.leak)])).toEqual(month.map((m) => [String(m.id), Number(m.leak)]));
    expect(state.reduce((a, r) => a + Math.round(Number(r.leak) * 100), 0)).toBe(LEAK * 100);
    expect(() => invoiceLeakStateCte(restaurantId, [])).toThrow(/empty/);
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

describe('a receiving scan waiting for its count (#94) is not "waiting to be linked"', () => {
  /** A goods receipt of the restaurant's supplier (the receiving wizard opens it before the photo). */
  async function receipt(restaurantId: string, status: 'pending' | 'completed') {
    const [s] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.restaurantId, restaurantId));
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId, supplierId: s!.id, expectedDeliveryAt: THIS_MONTH, status: 'sent', source: 'manual' })
      .returning();
    const [gr] = await db.insert(goodsReceipts).values({ restaurantId, poId: po!.id, status }).returning();
    return gr!.id;
  }
  /** What the OCR job records when it holds the scan's match for those receipts' count. */
  const heldBy = (invoiceId: string, grIds: string[]) =>
    db
      .update(invoices)
      .set({ ocrPayload: { provider: 'reconciled', raw: { heldForReceipts: grIds } } })
      .where(eq(invoices.id, invoiceId));

  it('held by the OCR for a receipt still being counted: "waiting for the count" — not pending link, leak or spend', async () => {
    const { restaurantId, invoice } = await setup();
    const checked = await invoice({ date: THIS_MONTH, exclVat: '1000', inclVat: '1180', d: [{ type: 'PRICE_HIGHER', severity: 'warn', delta: '15' }] });
    const consolidated = await invoice({ date: THIS_MONTH, exclVat: '2000', inclVat: '2360', matched: false });
    const scan = await invoice({ date: THIS_MONTH, exclVat: '769.17', inclVat: '907.62', matched: false });
    const gr = await receipt(restaurantId, 'pending');
    await heldBy(scan, [gr]);
    await heldBy(checked, [gr]); // a run exists: matched, whatever the marker says

    const hero = await computeLeakHero(db, restaurantId, { now: NOW });
    expect(hero).toMatchObject({
      leakIls: 15,
      spendIls: 1000,
      pendingLinkCount: 1,
      pendingLinkIls: 2360,
      awaitingCountCount: 1,
      awaitingCountIls: 907.62,
      invoiceCount: 3,
      matchedInvoiceCount: 1,
    });
    expect(await computeLeakSummary(db, restaurantId, { period: 'this_month', now: NOW })).toEqual(hero);
    expect((await computeLeakReport(db, restaurantId, '2026-10')).hero).toEqual(hero);
    const rows = await computeLeakBreakdown(db, restaurantId, { now: NOW });
    expect(rows.filter((r) => r.pendingLink).map((r) => r.invoiceId)).toEqual([consolidated]);
    expect(rows.map((r) => r.invoiceId)).not.toContain(scan);

    // The count is in (receipt closed) and still no run: an ordinary unmatched invoice again.
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, gr));
    expect(await computeLeakHero(db, restaurantId, { now: NOW })).toMatchObject({
      spendIls: 1000,
      pendingLinkCount: 2,
      pendingLinkIls: 3267.62,
      awaitingCountCount: 0,
      awaitingCountIls: 0,
    });
  });

  it('an unmatched photo with no OCR hold on record stays "waiting to be linked", whatever receipt is open', async () => {
    const { restaurantId, invoice } = await setup();
    await receipt(restaurantId, 'pending');
    await invoice({ date: THIS_MONTH, exclVat: '2000', inclVat: '2360', matched: false });
    expect(await computeLeakHero(db, restaurantId, { now: NOW })).toMatchObject({
      pendingLinkCount: 1,
      pendingLinkIls: 2360,
      awaitingCountCount: 0,
      awaitingCountIls: 0,
    });
  });
});
