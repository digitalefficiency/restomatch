import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, invoices, matchRuns, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { computeSupplierScorecards } from '../suppliers';

const db = createDb(testDbUrl());

async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoices);
  await db.delete(suppliers);
  await db.delete(restaurants);
}
beforeEach(resetDb);
afterAll(resetDb);

type Status = 'open' | 'accepted' | 'rejected' | 'escalated' | 'resolved';

async function setup() {
  const [r] = await db.insert(restaurants).values({ name: 'Scorecard Bistro' }).returning();
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ספק כפול' }).returning();
  let n = 0;
  async function invoiceWith(d: { type: (typeof discrepancies.$inferInsert)['type']; status: Status }[]) {
    n += 1;
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: r!.id,
        supplierId: s!.id,
        invoiceNumber: `S-${n}`,
        invoiceDate: new Date(),
        totalExclVat: '100',
        vatAmount: '18',
        totalInclVat: '118',
        status: 'disputed',
        source: 'photo',
      })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: r!.id, invoiceId: inv!.id, overallStatus: 'blocked', totalDiscrepancyAmount: '118' })
      .returning();
    for (const x of d) {
      await db.insert(discrepancies).values({
        restaurantId: r!.id,
        matchRunId: mr!.id,
        type: x.type,
        severity: 'block',
        deltaAmount: '118',
        resolutionStatus: x.status,
      });
    }
  }
  return { restaurantId: r!.id, invoiceWith };
}

describe('computeSupplierScorecards — duplicate invoices', () => {
  it('counts open / escalated / confirmed duplicates, not ones rejected as "not a duplicate"', async () => {
    const { restaurantId, invoiceWith } = await setup();
    await invoiceWith([{ type: 'DUPLICATE_INVOICE', status: 'open' }]);
    await invoiceWith([{ type: 'DUPLICATE_INVOICE', status: 'escalated' }]);
    await invoiceWith([{ type: 'DUPLICATE_INVOICE', status: 'accepted' }]);
    await invoiceWith([{ type: 'DUPLICATE_INVOICE', status: 'rejected' }]);
    await invoiceWith([{ type: 'PRICE_HIGHER', status: 'rejected' }]); // not a duplicate at all
    const [card] = await computeSupplierScorecards(db, restaurantId);
    expect(card!.duplicateInvoicesCount).toBe(3);
    expect(card!.matchRunsCount).toBe(5);
  });

  it('is restaurant-scoped', async () => {
    const a = await setup();
    await a.invoiceWith([{ type: 'DUPLICATE_INVOICE', status: 'open' }]);
    const b = await setup();
    const [card] = await computeSupplierScorecards(db, b.restaurantId);
    expect(card!.duplicateInvoicesCount).toBe(0);
  });
});
