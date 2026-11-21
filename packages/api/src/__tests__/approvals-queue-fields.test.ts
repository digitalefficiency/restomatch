/**
 * DS3-04 seam (spec §3): the four additive `myQueue` read fields the approvals desk draws, and
 * their tenant rules. `invoiceDate` (the evidence meta) comes from `invoices`, scoped by
 * restaurant_id; `unitPriceBilled` / `lineTotal` (the three-way table, the calculation line) from
 * `invoice_lines`, joined only through the caller's own invoice; `unitPriceExpected` from
 * `po_lines`, which is joined by id only — so it is nulled with the other PO facts whenever the
 * PO is not the caller's (the orphan-PO spread). Receiver / chef never read the queue at all
 * (approvals-scope.test.ts pins FORBIDDEN on the queue and on every decision). B's figures differ
 * from A's, so a leak shows by value; the invoice-level vector (a gap whose match run points at
 * another tenant's invoice) is planted too, so the invoices join's restaurant check is pinned.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoiceLines, invoices, matchRuns, poLines, testDbUrl } from '@restomatch/db';
import { resetDb } from './fixtures';
import { callerAs, seedDesk, type Desk } from './approvals-desk.fixtures';

const db = createDb(testDbUrl());
let A: Desk;
let B: Desk;
/** A's six gaps, by case (spec §3.2). */
let ids: Record<'price' | 'qty' | 'orphan' | 'foreign' | 'missing' | 'unord', string>;
/** A's gaps whose match run points at B's invoice: A's own run with B's invoice_id, and B's run itself. */
let viaOwnRun: string;
let viaForeignRun: string;
/** B's gap on A's PO line and A's invoice line (the mirror of `orphan` + `foreign`). */
let mirrorOnB: string;

type GapRow = Omit<
  typeof discrepancies.$inferInsert,
  'restaurantId' | 'matchRunId' | 'resolutionStatus'
>;

/** An open gap of `restaurantId` on `matchRunId`; its lines may point anywhere. */
async function addGap(restaurantId: string, matchRunId: string, g: GapRow): Promise<string> {
  const [d] = await db
    .insert(discrepancies)
    .values({ ...g, restaurantId, matchRunId, resolutionStatus: 'open' })
    .returning();
  return d!.id;
}

/** An open gap on A's seeded match run (A's invoice); its lines may point anywhere. */
function addGapToA(g: GapRow): Promise<string> {
  return addGap(A.restaurantId, A.matchRunId, g);
}

beforeAll(async () => {
  await resetDb(db);
  // Each tenant: a PO line (10 kg at 8.5), a GR line (5 received), an invoice and its line
  // (10 kg at 10.00 = 100.00) and a match run. B then gets figures of its own, so any value of B's
  // that reached A would show (A keeps 8.5 / 10.00 / 100.00 and its own invoice date).
  A = await seedDesk(db, 'QA');
  B = await seedDesk(db, 'QB');
  await db
    .update(invoices)
    .set({ invoiceDate: new Date('2026-10-21T00:00:00Z') })
    .where(eq(invoices.id, A.invoiceId));
  await db
    .update(invoices)
    .set({ invoiceDate: new Date('2026-01-02T00:00:00Z') })
    .where(eq(invoices.id, B.invoiceId));
  await db
    .update(invoiceLines)
    .set({ unitPriceBilled: '12.3400', lineTotal: '123.40' })
    .where(eq(invoiceLines.id, B.invoiceLineId));
  await db.update(poLines).set({ unitPriceExpected: '9.2500' }).where(eq(poLines.id, B.poLineId));
  ids = {
    price: await addGapToA({
      type: 'PRICE_HIGHER',
      severity: 'warn',
      requiresRole: 'manager',
      poLineId: A.poLineId,
      invoiceLineId: A.invoiceLineId,
      expectedValue: '8.5',
      actualValue: '10',
      deltaAmount: '15.00',
      toleranceUsed: 'price: ±2% or ₪5',
    }),
    qty: await addGapToA({
      type: 'QTY_OVER',
      severity: 'block',
      requiresRole: 'owner',
      poLineId: A.poLineId,
      invoiceLineId: A.invoiceLineId,
      grLineId: A.grLineId,
      expectedValue: '5',
      actualValue: '10',
      deltaAmount: '50.00',
      toleranceUsed: 'billed quantity exceeds received quantity',
    }),
    // B's PO line on A's gap: joined by id, but its PO is not A's.
    orphan: await addGapToA({
      type: 'PRICE_HIGHER',
      severity: 'warn',
      requiresRole: 'manager',
      poLineId: B.poLineId,
      invoiceLineId: A.invoiceLineId,
      deltaAmount: '15.00',
    }),
    // B's invoice line on A's gap: it belongs to B's invoice, so it never joins.
    foreign: await addGapToA({
      type: 'PRICE_HIGHER',
      severity: 'warn',
      requiresRole: 'manager',
      poLineId: A.poLineId,
      invoiceLineId: B.invoiceLineId,
      deltaAmount: '15.00',
    }),
    missing: await addGapToA({
      type: 'MISSING_ON_INVOICE',
      severity: 'warn',
      requiresRole: 'manager',
      poLineId: A.poLineId,
      expectedValue: '10',
      actualValue: '0',
      deltaAmount: '85.00',
    }),
    unord: await addGapToA({
      type: 'UNORDERED_ITEM',
      severity: 'block',
      requiresRole: 'owner',
      invoiceLineId: A.invoiceLineId,
      actualValue: '10',
      deltaAmount: '100.00',
    }),
  };
  // The invoice-level vector: match_runs.invoice_id is a plain FK (no same-tenant check) and the
  // match_runs join is by id, so only the invoices join's restaurant check keeps B's invoice out.
  const onBsLine: GapRow = {
    type: 'PRICE_HIGHER',
    severity: 'warn',
    requiresRole: 'manager',
    invoiceLineId: B.invoiceLineId,
    deltaAmount: '15.00',
  };
  const [runOnBsInvoice] = await db
    .insert(matchRuns)
    .values({ restaurantId: A.restaurantId, invoiceId: B.invoiceId, overallStatus: 'major', totalDiscrepancyAmount: '0' })
    .returning();
  viaOwnRun = await addGap(A.restaurantId, runOnBsInvoice!.id, onBsLine);
  viaForeignRun = await addGap(A.restaurantId, B.matchRunId, onBsLine);
  mirrorOnB = await addGap(B.restaurantId, B.matchRunId, {
    type: 'PRICE_HIGHER',
    severity: 'warn',
    requiresRole: 'manager',
    poLineId: A.poLineId,
    invoiceLineId: A.invoiceLineId,
    deltaAmount: '15.00',
  });
});
afterAll(async () => {
  await resetDb(db);
});

/** What the web desk and the frozen mobile manager screen already read off every row. */
const READ_TODAY = ['id', 'type', 'severity', 'deltaAmount', 'claimAgorot', 'canAct', 'waitingOn'];

/** A's owner reads every routed row (`scope: 'all'`), keyed by id. */
async function queueOfA() {
  const rows = await callerAs(db, A, 'owner').approvals.myQueue({ scope: 'all' });
  return new Map(rows.map((r) => [r.id, r]));
}

describe('myQueue — the desk fields (DS3-04)', () => {
  it('a price row carries both unit prices, the line total and the invoice date', async () => {
    const row = (await queueOfA()).get(ids.price);
    expect(row).toMatchObject({
      unitPriceExpected: '8.5000',
      unitPriceBilled: '10.0000',
      lineTotal: '100.00',
    });
    expect(row?.invoiceDate).toBeInstanceOf(Date);
    expect(row?.invoiceDate?.toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });

  it('a quantity row carries the prices too', async () => {
    const row = (await queueOfA()).get(ids.qty);
    expect(row).toMatchObject({
      unitPriceExpected: '8.5000',
      unitPriceBilled: '10.0000',
      lineTotal: '100.00',
    });
  });

  it("an orphan PO line (B's) is nulled with every other PO fact", async () => {
    const row = (await queueOfA()).get(ids.orphan);
    expect(row).toMatchObject({
      poId: null,
      unitPriceExpected: null,
      qtyOrdered: null,
      orderedUnit: null,
      poRef: null,
      poDate: null,
    });
  });

  it("a foreign invoice line (B's) is never joined", async () => {
    const row = (await queueOfA()).get(ids.foreign);
    expect(row).toMatchObject({
      unitPriceBilled: null,
      lineTotal: null,
      qtyBilled: null,
      billedUnit: null,
    });
  });

  it("never crosses tenants: B's queue holds none of A's rows, and B's gap on A's lines reads none of A's facts", async () => {
    const rowsOfB = await callerAs(db, B, 'owner').approvals.myQueue({ scope: 'all' });
    expect(rowsOfB.map((r) => r.id)).toContain(B.discrepancyId); // B reads its own queue: not vacuous
    const idsOfA = new Set([...Object.values(ids), viaOwnRun, viaForeignRun]);
    expect(rowsOfB.filter((r) => idsOfA.has(r.id))).toEqual([]);
    const mirror = rowsOfB.find((r) => r.id === mirrorOnB);
    expect(mirror, "B's mirror gap is in B's queue").toBeDefined();
    expect(mirror).toMatchObject({
      poId: null,
      unitPriceExpected: null,
      unitPriceBilled: null,
      lineTotal: null,
      qtyBilled: null,
    });
  });

  it.each([
    ["A's own match run pointing at B's invoice", () => viaOwnRun],
    ["B's match run under A's gap", () => viaForeignRun],
  ])("the invoice behind a gap is the caller's only: %s joins none of B's invoice facts", async (_label, id) => {
    const row = (await queueOfA()).get(id());
    expect(row, "the gap is in A's queue").toBeDefined();
    expect(row).toMatchObject({
      invoiceDate: null,
      invoiceNumber: null,
      invoiceStatus: null,
      unitPriceBilled: null,
      lineTotal: null,
      qtyBilled: null,
      lineDescription: null,
    });
  });

  it('absent lines read null: no invoice line on a missing row, no PO line on an unordered row', async () => {
    const q = await queueOfA();
    expect(q.get(ids.missing)).toMatchObject({
      unitPriceBilled: null,
      lineTotal: null,
      unitPriceExpected: '8.5000',
    });
    expect(q.get(ids.unord)).toMatchObject({ unitPriceExpected: null });
  });

  it('stays additive: the fields the web and the mobile app read are still on every row', async () => {
    const q = await queueOfA();
    for (const id of Object.values(ids)) expect(q.has(id)).toBe(true);
    for (const row of q.values()) for (const key of READ_TODAY) expect(row).toHaveProperty(key);
  });
});
