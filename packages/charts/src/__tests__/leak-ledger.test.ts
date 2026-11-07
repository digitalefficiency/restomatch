import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  invoices,
  matchRuns,
  recoveryClaims,
  recoveryEvents,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
  invoiceLines,
} from '@restomatch/db';
import { computeLeakHero } from '../leak-hero';
import { computeLeakSummary } from '../leak-views';
import { caughtBefore, computeLeakLedger, computeLeakPartition, parseBasis } from '../leak-ledger';
import { MONEY_STATES, type ClaimStatus } from '../decisions';

const db = createDb(testDbUrl());

async function resetDb() {
  await db.delete(recoveryEvents);
  await db.delete(recoveryClaims);
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(suppliers);
  await db.delete(restaurants);
}

beforeEach(resetDb);
afterAll(resetDb);

const NOW = new Date('2026-10-15T09:00:00Z');
const THIS_MONTH = new Date('2026-10-10T08:00:00Z');
const LAST_MONTH = new Date('2026-09-20T08:00:00Z');
const SPEC = { period: 'this_month' as const, now: NOW };

type Status = 'open' | 'accepted' | 'rejected' | 'escalated' | 'resolved';
interface D {
  type: (typeof discrepancies.$inferInsert)['type'];
  severity?: 'info' | 'warn' | 'block';
  delta: string | null;
  status?: Status;
  /** A person decided (resolved_at set). Default: true for any decided status except a tolerated accept. */
  decidedAt?: Date | null;
  createdAt?: Date;
  claim?: { status: ClaimStatus; amountAgorot: number; creditedAgorot?: number };
}

async function setup() {
  const [r] = await db.insert(restaurants).values({ name: 'Ledger Bistro' }).returning();
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ירקות השרון' }).returning();
  let n = 0;
  async function invoice(opts: {
    date?: Date;
    inclVat: string;
    status?: 'matched' | 'paid' | 'approved';
    paidAt?: Date;
    d: D[];
  }) {
    n += 1;
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: r!.id,
        supplierId: s!.id,
        invoiceNumber: `L-${n}`,
        invoiceDate: opts.date ?? THIS_MONTH,
        totalExclVat: opts.inclVat,
        totalInclVat: opts.inclVat,
        status: opts.status ?? 'matched',
        source: 'manual',
        ...(opts.paidAt ? { updatedAt: opts.paidAt } : {}),
      })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: r!.id, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    let k = 0;
    const ids: string[] = [];
    for (const d of opts.d) {
      k += 1;
      const status = d.status ?? 'open';
      const decided = status !== 'open' && status !== 'escalated';
      const resolvedAt = d.decidedAt !== undefined ? d.decidedAt : decided ? new Date('2026-10-11T08:00:00Z') : null;
      const [row] = await db
        .insert(discrepancies)
        .values({
          matchRunId: mr!.id,
          restaurantId: r!.id,
          type: d.type,
          severity: d.severity ?? 'warn',
          deltaAmount: d.delta,
          resolutionStatus: status,
          resolvedAt,
          // Distinct, ordered creation times (the allocator's order).
          createdAt: d.createdAt ?? new Date(Date.UTC(2026, 9, 10, 9, 0, k)),
        })
        .returning();
      ids.push(row!.id);
      if (d.claim) {
        await db.insert(recoveryClaims).values({
          restaurantId: r!.id,
          discrepancyId: row!.id,
          supplierId: s!.id,
          invoiceId: inv!.id,
          status: d.claim.status,
          amountAgorot: d.claim.amountAgorot,
          creditedAgorot: d.claim.creditedAgorot ?? 0,
        });
      }
    }
    return { invoiceId: inv!.id, ids };
  }
  return { rid: r!.id, invoice };
}

const heroAgorot = async (rid: string) => Math.round((await computeLeakHero(db, rid, { now: NOW })).leakIls * 100);

describe('leak ledger · the money-state partition [G-14]', () => {
  it('Σ states = hero leak to the agora, every row in exactly one state', async () => {
    const { rid, invoice } = await setup();
    // Unpaid invoice: undecided, accepted (no claim yet), waived, tolerated, and two non-leak rows.
    await invoice({
      inclVat: '1000.00',
      d: [
        { type: 'PRICE_HIGHER', delta: '100.00' },
        { type: 'QTY_SHORT', delta: '50.00', status: 'accepted' },
        { type: 'UNIT_MISMATCH', delta: '20.00', status: 'rejected' },
        { type: 'PRICE_HIGHER', delta: '5.00', status: 'accepted', decidedAt: null },
        { type: 'PRICE_HIGHER', severity: 'info', delta: '9.00' },
        { type: 'PRICE_LOWER', delta: '7.00' },
        { type: 'QTY_OVER', delta: '3.33', status: 'escalated' },
      ],
    });
    // Paid invoice: claims in each status.
    const paidAt = new Date('2026-10-12T08:00:00Z');
    const claim = (status: ClaimStatus, a: number, c = 0) => ({ status, amountAgorot: a, creditedAgorot: c });
    await invoice({
      inclVat: '2000.00',
      status: 'paid',
      paidAt,
      d: [
        { type: 'QTY_SHORT', delta: '10.00', status: 'accepted', claim: claim('claimed', 1000) },
        { type: 'QTY_SHORT', delta: '11.00', status: 'accepted', claim: claim('letter_sent', 1100) },
        { type: 'QTY_SHORT', delta: '12.00', status: 'accepted', claim: claim('acknowledged', 1200) },
        { type: 'QTY_SHORT', delta: '13.00', status: 'accepted', claim: claim('disputed', 1300) },
        { type: 'QTY_SHORT', delta: '14.00', status: 'accepted', claim: claim('credited', 1400, 1400) },
        { type: 'QTY_SHORT', delta: '15.00', status: 'resolved', claim: claim('recovered', 1500, 1500) },
        { type: 'QTY_SHORT', delta: '16.00', status: 'rejected', claim: claim('written_off', 1600, 0) },
        { type: 'MISSING_ON_INVOICE', delta: '17.00', status: 'accepted' },
        { type: 'QTY_SHORT', delta: '18.00', status: 'accepted' },
      ],
    });
    // Last month: out of this month's partition.
    await invoice({ date: LAST_MONTH, inclVat: '500.00', d: [{ type: 'PRICE_HIGHER', delta: '44.00' }] });

    const p = await computeLeakPartition(db, rid, SPEC);
    expect(p.states).toEqual({
      undecided: 10000 + 333,
      to_offset: 5000,
      to_send: 1000 + 1800,
      requested: 1100 + 1200,
      disputed: 1300,
      credited: 1400,
      recovered: 1500,
      waived: 2000 + 500 + 1600 + 1700,
    });
    expect(p.totalAgorot).toBe(p.heroAgorot);
    expect(p.driftAgorot).toBe(0);
    expect(p.heroAgorot).toBe(await heroAgorot(rid));
    expect(p.rowCount).toBe(14); // info + PRICE_LOWER excluded
    expect(Object.keys(p.states).sort()).toEqual([...MONEY_STATES].sort());

    const last = await computeLeakPartition(db, rid, { period: 'last_month', now: NOW });
    expect(last).toMatchObject({ totalAgorot: 4400, heroAgorot: 4400, driftAgorot: 0 });
    expect(last.states.undecided).toBe(4400);
  });

  it('the canary scenarios, persisted: ₪32.00 and ₪5.63 to the agora', async () => {
    // Hand-computed numbers of packages/matching leak-canary (read-only use; files untouched).
    const { rid, invoice } = await setup();
    await invoice({
      inclVat: '93.60',
      d: [
        { type: 'QTY_SHORT', severity: 'warn', delta: '16.00' },
        { type: 'PRICE_HIGHER', severity: 'block', delta: '16.00' },
      ],
    });
    await invoice({ inclVat: '35.10', d: [{ type: 'PRICE_HIGHER', severity: 'block', delta: '5.63' }] });
    const p = await computeLeakPartition(db, rid, SPEC);
    expect(p).toMatchObject({ totalAgorot: 3200 + 563, heroAgorot: 3763, driftAgorot: 0 });
    expect(p.states.undecided).toBe(3763);
  });

  it('one allocator: a claim holds its persisted amount first; undecided rows get only what is left', async () => {
    const { rid, invoice } = await setup();
    // Cap ₪100. The undecided row is OLDER, but the claimed row holds its ₪50 first.
    await invoice({
      inclVat: '100.00',
      d: [
        { type: 'PRICE_HIGHER', delta: '80.00', createdAt: new Date('2026-10-10T09:00:00Z') },
        {
          type: 'QTY_SHORT',
          delta: '50.00',
          status: 'accepted',
          createdAt: new Date('2026-10-10T09:05:00Z'),
          claim: { status: 'claimed', amountAgorot: 5000 },
        },
      ],
    });
    const rows = await computeLeakLedger(db, rid, SPEC);
    const by = Object.fromEntries(rows.map((r) => [r.type, r]));
    expect(by.QTY_SHORT).toMatchObject({ tier: 1, cappedAgorot: 5000, moneyState: 'to_offset', claimAmountAgorot: 5000 });
    expect(by.PRICE_HIGHER).toMatchObject({ tier: 3, rawAgorot: 8000, cappedAgorot: 5000, moneyState: 'undecided' });
    const p = await computeLeakPartition(db, rid, SPEC);
    expect(p).toMatchObject({ totalAgorot: 10000, heroAgorot: 10000, driftAgorot: 0 });
  });

  it('a duplicate bills the whole invoice: the cap binds and later rows get nothing', async () => {
    const { rid, invoice } = await setup();
    await invoice({
      inclVat: '585.00',
      d: [
        { type: 'DUPLICATE_INVOICE', severity: 'block', delta: '585.00', status: 'accepted' },
        { type: 'PRICE_HIGHER', delta: '40.00' },
      ],
    });
    const rows = await computeLeakLedger(db, rid, SPEC);
    expect(rows.map((r) => [r.type, r.cappedAgorot, r.moneyState])).toEqual([
      ['DUPLICATE_INVOICE', 58500, 'to_offset'],
      ['PRICE_HIGHER', 0, 'undecided'],
    ]);
    expect((await computeLeakPartition(db, rid, SPEC)).driftAgorot).toBe(0);
  });

  it('"not a duplicate" leaves the ledger, like the hero', async () => {
    const { rid, invoice } = await setup();
    await invoice({ inclVat: '585.00', d: [{ type: 'DUPLICATE_INVOICE', delta: '585.00', status: 'rejected' }] });
    const p = await computeLeakPartition(db, rid, SPEC);
    expect(p).toMatchObject({ rowCount: 0, totalAgorot: 0, heroAgorot: 0, driftAgorot: 0 });
  });

  it('drift is reported, never hidden: a claim holding less than |Δ| while the cap is free', async () => {
    const { rid, invoice } = await setup();
    await invoice({
      inclVat: '1000.00',
      d: [{ type: 'QTY_SHORT', delta: '50.00', status: 'accepted', claim: { status: 'claimed', amountAgorot: 3000 } }],
    });
    const p = await computeLeakPartition(db, rid, SPEC);
    expect(p).toMatchObject({ totalAgorot: 3000, heroAgorot: 5000, driftAgorot: 2000 });
  });

  it('agrees with the view summary for any period', async () => {
    const { rid, invoice } = await setup();
    await invoice({ date: LAST_MONTH, inclVat: '70.00', d: [{ type: 'PRICE_HIGHER', delta: '90.00' }] });
    await invoice({ inclVat: '300.00', d: [{ type: 'QTY_SHORT', delta: '12.34', status: 'accepted' }] });
    for (const period of ['this_month', 'last_month', 'ytd', 'last_12m'] as const) {
      const spec = { period, now: NOW };
      const p = await computeLeakPartition(db, rid, spec);
      const summary = await computeLeakSummary(db, rid, spec);
      expect(p.totalAgorot).toBe(Math.round(summary.leakIls * 100));
      expect(p.driftAgorot).toBe(0);
    }
  });
});

describe('caught before payment = detection or decision precedes paid_at [G-14]', () => {
  it('measures by time, not by today’s status (interim paid_at = updated_at of a paid invoice)', async () => {
    const { rid, invoice } = await setup();
    const paidAt = new Date('2026-10-12T08:00:00Z');
    await invoice({
      inclVat: '1000.00',
      status: 'paid',
      paidAt,
      d: [
        // Detected before payment → caught, though the invoice is paid now.
        { type: 'PRICE_HIGHER', delta: '10.00', createdAt: new Date('2026-10-11T08:00:00Z') },
        // Detected after payment (a re-match) → not caught.
        { type: 'QTY_SHORT', delta: '20.00', createdAt: new Date('2026-10-13T08:00:00Z') },
      ],
    });
    await invoice({ inclVat: '1000.00', d: [{ type: 'QTY_OVER', delta: '30.00' }] }); // unpaid → caught
    const rows = await computeLeakLedger(db, rid, SPEC);
    const by = Object.fromEntries(rows.map((r) => [r.type, r]));
    expect(by.PRICE_HIGHER).toMatchObject({ invoicePaid: true, paidAt: paidAt.toISOString(), caughtBeforePayment: true });
    expect(by.QTY_SHORT).toMatchObject({ invoicePaid: true, caughtBeforePayment: false, moneyState: 'undecided' });
    expect(by.QTY_OVER).toMatchObject({ invoicePaid: false, paidAt: null, caughtBeforePayment: true });
    expect((await computeLeakPartition(db, rid, SPEC)).caughtBeforePaymentAgorot).toBe(4000);
  });

  it('caughtBefore: the decision alone can precede the payment', () => {
    const paid = '2026-10-12T08:00:00.000Z';
    expect(caughtBefore('2026-10-13T00:00:00.000Z', '2026-10-11T00:00:00.000Z', paid)).toBe(true);
    expect(caughtBefore('2026-10-13T00:00:00.000Z', null, paid)).toBe(false);
    expect(caughtBefore('2026-10-13T00:00:00.000Z', null, null)).toBe(true);
  });

  it('reads invoices.paid_at and discrepancies.basis once H-03 / G-03 add them (same SQL)', async () => {
    const { rid, invoice } = await setup();
    const { invoiceId, ids } = await invoice({ inclVat: '1000.00', d: [{ type: 'PRICE_HIGHER', delta: '10.00' }] });
    await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at timestamptz`);
    await db.execute(sql`ALTER TABLE discrepancies ADD COLUMN IF NOT EXISTS basis jsonb`);
    try {
      // paid_at wins over the status fallback, even for an invoice not marked paid.
      await db.execute(sql`UPDATE invoices SET paid_at = '2026-10-09T08:00:00Z' WHERE id = ${invoiceId}`);
      await db.execute(
        sql`UPDATE discrepancies SET basis = ${JSON.stringify({ source: 'po', qtyUsed: 2, unitPriceUsed: 5 })}::jsonb WHERE id = ${ids[0]!}`,
      );
      const [row] = await computeLeakLedger(db, rid, SPEC);
      expect(row).toMatchObject({ invoicePaid: true, paidAt: '2026-10-09T08:00:00.000Z', caughtBeforePayment: false });
      expect(row!.basis).toEqual({ source: 'po', qtyUsed: 2, unitPriceUsed: 5 });
    } finally {
      await db.execute(sql`ALTER TABLE invoices DROP COLUMN IF EXISTS paid_at`);
      await db.execute(sql`ALTER TABLE discrepancies DROP COLUMN IF EXISTS basis`);
    }
  });

  it('parseBasis: an object or null', () => {
    expect(parseBasis(null)).toBeNull();
    expect(parseBasis('[1]')).toBeNull();
    expect(parseBasis('{"source":"gr"}')).toEqual({ source: 'gr' });
    expect(parseBasis(3)).toBeNull();
  });
});
