import { describe, expect, it } from 'vitest';
import { computeLeakBreakdown, expectedSourceOf, type LeakBreakdownLine } from '@restomatch/charts';
import { createDb, sql } from '@restomatch/db';
import { runMatch, type Discrepancy, type MatchInput } from '@restomatch/matching';
// The canary's builders, imported read-only (immutable file; never edited here).
import { grLine, input, invoiceHeader, invoiceLine, poLine } from '../../../matching/src/__tests__/fixtures';
import { invoiceEvidence, lineEvidence } from '../leaks/evidence';

/** A breakdown line as charts would return it for an engine finding on this input. */
function lineOf(scenario: MatchInput, d: Discrepancy, i: number): LeakBreakdownLine {
  const il = scenario.invoiceLines.find((l) => l.id === d.invoiceLineId) ?? null;
  const pl = scenario.poLines.find((l) => l.id === d.poLineId) ?? null;
  return {
    discrepancyId: `d-${i}`,
    type: d.type,
    severity: d.severity,
    resolutionStatus: 'open',
    deltaAmount: d.deltaAmount,
    expected: d.expected,
    actual: d.actual,
    countsAsLeak: d.severity !== 'info' && d.type !== 'PRICE_LOWER',
    productName: null,
    productNameEn: null,
    lineDescription: null,
    lineDescriptionEn: null,
    poLineId: d.poLineId ?? null,
    invoiceLineId: d.invoiceLineId ?? null,
    productId: d.productId,
    toleranceUsed: d.toleranceUsed,
    qtyBilled: il?.qtyBilled ?? null,
    unit: il?.unit ?? pl?.unit ?? null,
    unitPriceBilled: il?.unitPriceBilled ?? null,
    unitPriceExpected: pl?.unitPriceExpected ?? null,
    poUnit: pl?.unit ?? null,
    poId: 'po-1',
    poNumber: null,
    deliveryNoteNumber: null,
    receiptNote: 'ת.מ. 61036',
    expectedSource: expectedSourceOf(d.type, d.toleranceUsed),
    expectedAsOf: null,
  };
}

const scenarios: Record<string, () => MatchInput> = {
  // The two canary scenarios, verbatim inputs (leak-canary.test.ts).
  'canary: short delivery + inflated price (₪32.00)': () => {
    const po = poLine({ id: 'po-canary', qtyOrdered: 10, unitPriceExpected: 8.0 });
    return input({
      poLines: [po],
      grLines: [grLine({ poLineId: po.id, qtyReceived: 8 })],
      invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 8, unitPriceBilled: 10.0, lineTotal: 80 })],
      invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 13.6, totalInclVat: 93.6 }),
    });
  },
  'canary: scale-4 price (₪5.63)': () => {
    const po = poLine({ id: 'po-frac', qtyOrdered: 3, unitPriceExpected: 8.1234 });
    return input({
      poLines: [po],
      grLines: [grLine({ poLineId: po.id, qtyReceived: 3 })],
      invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 3, unitPriceBilled: 10.0, lineTotal: 30 })],
      invoice: invoiceHeader({ totalExclVat: 30, vatAmount: 5.1, totalInclVat: 35.1 }),
    });
  },
  'billed more than received, short also billed (counted once)': () => {
    const po = poLine({ id: 'po-over', qtyOrdered: 10, unitPriceExpected: 20 });
    return input({
      poLines: [po],
      grLines: [grLine({ poLineId: po.id, qtyReceived: 7 })],
      invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 10, unitPriceBilled: 20, lineTotal: 200 })],
      invoice: invoiceHeader({ totalExclVat: 200, vatAmount: 36, totalInclVat: 236 }),
    });
  },
  'unit conversion: billed in g, ordered in kg': () => {
    const po = poLine({ id: 'po-unit', qtyOrdered: 2, unit: 'kg', unitPriceExpected: 50 });
    return input({
      poLines: [po],
      grLines: [grLine({ poLineId: po.id, qtyReceived: 2 })],
      invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 2000, unit: 'g', unitPriceBilled: 0.06, lineTotal: 120 })],
      invoice: invoiceHeader({ totalExclVat: 120, vatAmount: 21.6, totalInclVat: 141.6 }),
    });
  },
  'header total and VAT off': () => {
    const po = poLine({ id: 'po-tot', qtyOrdered: 5, unitPriceExpected: 10 });
    return input({
      poLines: [po],
      grLines: [grLine({ poLineId: po.id, qtyReceived: 5 })],
      invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 5, unitPriceBilled: 10, lineTotal: 50 })],
      invoice: invoiceHeader({ totalExclVat: 58, vatAmount: 12, totalInclVat: 70 }),
    });
  },
};

describe('owner evidence: the engine formula, recomputed, equals |Δ| to the agora', () => {
  for (const [name, build] of Object.entries(scenarios)) {
    it(name, () => {
      const scenario = build();
      const out = runMatch(scenario);
      const lines = out.discrepancies.map((d, i) => lineOf(scenario, d, i));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) {
        const ev = lineEvidence(l);
        // Only types without a numeric formula may be unverified (null); none may mismatch.
        expect([l.type, ev.verified === false]).toEqual([l.type, false]);
        expect(ev.facts.unavailable).toBe(false);
        expect(ev.deliveryNoteNumber).toBe('61036');
      }
    });
  }

  it('the canary headline: both findings verify, and Σ|Δ| = ₪32.00', () => {
    const scenario = scenarios['canary: short delivery + inflated price (₪32.00)']!();
    const out = runMatch(scenario);
    const ev = out.discrepancies.map((d, i) => lineEvidence(lineOf(scenario, d, i)));
    expect(ev.map((e) => [e.facts.type, e.verified])).toEqual(
      expect.arrayContaining([
        ['PRICE_HIGHER', true],
        ['QTY_SHORT', true],
      ]),
    );
    expect(ev.reduce((s, e) => s + Math.round(Math.abs(e.facts.deltaAmount) * 100), 0)).toBe(3200);
  });

  it('a delta the stored facts cannot produce reads "unavailable", never a wrong formula', () => {
    const scenario = scenarios['canary: scale-4 price (₪5.63)']!();
    const [d] = runMatch(scenario).discrepancies;
    const tampered = { ...lineOf(scenario, d!, 0), deltaAmount: 5.64 };
    const ev = lineEvidence(tampered);
    expect([ev.verified, ev.facts.unavailable]).toEqual([false, true]);
  });

  it('types without a formula are not "unavailable" (plain explanation instead)', () => {
    const base = lineOf(scenarios['canary: scale-4 price (₪5.63)']!(), runMatch(scenarios['canary: scale-4 price (₪5.63)']!()).discrepancies[0]!, 0);
    const dup = { ...base, type: 'DUPLICATE_INVOICE', toleranceUsed: 'invoice number uniqueness per supplier', expectedSource: null };
    expect([lineEvidence(dup).verified, lineEvidence(dup).facts.unavailable]).toEqual([null, false]);
  });

  it('invoiceEvidence marks counted lines of a capped invoice with the cap note', () => {
    const scenario = scenarios['canary: short delivery + inflated price (₪32.00)']!();
    const lines = runMatch(scenario).discrepancies.map((d, i) => lineOf(scenario, d, i));
    const inv = {
      invoiceId: 'i', invoiceNumber: null, invoiceDate: null, status: 'matched', supplierName: null, supplierNameEn: null,
      totalInclVat: 20, leakIls: 20, pendingLink: false, lines,
    };
    expect(invoiceEvidence(inv).every((e) => e.facts.capped)).toBe(true);
    expect(invoiceEvidence({ ...inv, totalInclVat: 93.6, leakIls: 32 }).some((e) => e.facts.capped)).toBe(false);
  });
});

const LAB = process.env.LAB_DATABASE_URL;
describe.skipIf(!LAB)('owner evidence on the lab month (read-only)', () => {
  it('no line of the hero month mismatches its stored |Δ|', async () => {
    const db = createDb(LAB!);
    const res = (await db.execute(sql`select id from restaurants where name = 'כפר הזיתים' order by created_at limit 1`)) as unknown;
    const [main] = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { id: string }[];
    const rows = await computeLeakBreakdown(db, main!.id, { now: new Date('2026-10-25T12:00:00+03:00'), limit: 200 });
    const ev = rows.flatMap((r) => invoiceEvidence(r));
    const bad = ev.filter((e) => e.verified === false).map((e) => [e.facts.type, e.facts.deltaAmount]);
    expect(bad).toEqual([]);
    expect(ev.filter((e) => e.verified === true).length).toBeGreaterThan(0);
  });
});

// ── owner.lineHistory (W2-09c) ──────────────────────────────────────────────
import { afterAll as afterAllH, beforeEach as beforeEachH } from 'vitest';
import { auditLog } from '@restomatch/db';
import { resetDb, seedTenant, type Tenant } from './fixtures';
import { callerFor, db as testDb } from './owner-test-helpers';

describe('owner.lineHistory', () => {
  let A: Tenant;
  let B: Tenant;
  beforeEachH(async () => {
    await resetDb(testDb);
    A = await seedTenant(testDb, 'A');
    B = await seedTenant(testDb, 'B');
  });
  afterAllH(async () => resetDb(testDb));

  it('latest entries first: who (role at decision time), verb, before→after', async () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 20, 9, m));
    await testDb.insert(auditLog).values([
      { restaurantId: A.restaurantId, userId: A.ownerUserId, action: 'discrepancy.escalated', entityType: 'discrepancy', entityId: A.discrepancyId, before: { status: 'open' }, after: { status: 'escalated', role: 'manager' }, at: at(1) },
      { restaurantId: A.restaurantId, userId: A.ownerUserId, action: 'discrepancy.approved', entityType: 'discrepancy', entityId: A.discrepancyId, before: { status: 'escalated' }, after: { status: 'accepted', role: 'owner' }, at: at(2) },
    ]);
    // The seed's own 'discrepancy.created' row (now) is real history too; check the decisions.
    const h = (await callerFor(A).owner.lineHistory({ discrepancyId: A.discrepancyId, limit: 5 })).filter((e) => e.action !== 'discrepancy.created');
    expect(h.map((e) => [e.action, e.userRole, e.before, e.after])).toEqual([
      ['discrepancy.approved', 'owner', 'escalated', 'accepted'],
      ['discrepancy.escalated', 'manager', 'open', 'escalated'],
    ]);
    expect(h[0]!.at).toBe(at(2).toISOString());
  });

  it('attack: a foreign discrepancyId → NOT_FOUND (never an empty history)', async () => {
    await expect(callerFor(A).owner.lineHistory({ discrepancyId: B.discrepancyId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(A).owner.lineHistory({ discrepancyId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('receiver and chef are FORBIDDEN', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerFor(A, role).owner.lineHistory({ discrepancyId: A.discrepancyId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
