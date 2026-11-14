import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, invoiceLines, invoices, matchRuns, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { computeLeakDrivers } from '../leak-drivers';

const db = createDb(testDbUrl());
async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(suppliers);
  await db.delete(restaurants);
}
beforeEach(resetDb);
afterAll(resetDb);

const NOW = new Date('2026-10-25T12:00:00+03:00');

async function seed() {
  const [r] = await db.insert(restaurants).values({ name: 'Drivers Bistro' }).returning();
  const sup = async (name: string) => (await db.insert(suppliers).values({ restaurantId: r!.id, name }).returning())[0]!.id;
  const ids = { meat: await sup('קצביית הכרם'), veg: await sup('ירקות השרון'), fish: await sup('דגי הים'), dairy: await sup('מחלבת הגליל'), oil: await sup('שמנים') };
  let n = 0;
  async function inv(supplierId: string, date: string, deltas: string[], total = '10000') {
    n += 1;
    const [i] = await db
      .insert(invoices)
      .values({
        restaurantId: r!.id, supplierId, invoiceNumber: `D-${n}`, invoiceDate: new Date(date),
        totalExclVat: total, vatAmount: '0', totalInclVat: total, status: 'matched', source: 'photo',
      })
      .returning();
    const [mr] = await db.insert(matchRuns).values({ restaurantId: r!.id, invoiceId: i!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' }).returning();
    for (const delta of deltas) {
      await db.insert(discrepancies).values({ restaurantId: r!.id, matchRunId: mr!.id, type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: delta });
    }
  }
  return { rid: r!.id, ids, inv };
}

describe('computeLeakDrivers', () => {
  it('top 3 by |Δ| with an "other" rest; Σ drivers + other = the hero Δ to the agora', async () => {
    const { rid, ids, inv } = await seed();
    const OCT = '2026-10-10T09:00:00Z';
    const SEP = '2026-09-10T09:00:00Z';
    await inv(ids.meat, OCT, ['124.00']); await inv(ids.meat, SEP, ['50.00']); // +74
    await inv(ids.veg, OCT, ['10.00']); await inv(ids.veg, SEP, ['70.00']); // −60
    await inv(ids.fish, OCT, ['33.33']); // +33.33 (new)
    await inv(ids.dairy, OCT, ['5.00']); // +5 (falls into "other")
    await inv(ids.oil, SEP, ['2.01']); // −2.01 (falls into "other")
    const d = await computeLeakDrivers(db, rid, { period: 'this_month', now: NOW });
    expect(d.drivers.map((x) => [x.label, x.deltaAgorot])).toEqual([
      ['קצביית הכרם', 7400],
      ['ירקות השרון', -6000],
      ['דגי הים', 3333],
    ]);
    expect(d.drivers[0]!.deltaPct).toBeCloseTo(1.48);
    expect(d.drivers[2]!.deltaPct).toBeNull(); // nothing last month
    expect(d.otherAgorot).toBe(500 - 201);
    expect(d.drivers.reduce((s, x) => s + x.deltaAgorot, 0) + d.otherAgorot).toBe(d.comparison.deltaAgorot);
  });

  it('"other" absorbs the per-invoice cap the group sums do not see', async () => {
    const { rid, ids, inv } = await seed();
    await inv(ids.meat, '2026-10-10T09:00:00Z', ['80.00', '80.00'], '100'); // Σ|Δ| 160, capped at the ₪100 total
    const d = await computeLeakDrivers(db, rid, { period: 'this_month', now: NOW });
    expect(d.comparison.deltaAgorot).toBe(10000);
    expect([d.drivers[0]!.deltaAgorot, d.otherAgorot]).toEqual([16000, -6000]);
  });

  it('by type and product dimensions; no change → no drivers', async () => {
    const { rid } = await seed();
    const d = await computeLeakDrivers(db, rid, { period: 'this_month', now: NOW }, { by: 'type' });
    expect([d.by, d.drivers, d.otherAgorot]).toEqual(['type', [], 0]);
  });
});
