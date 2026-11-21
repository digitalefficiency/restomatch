import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, invoiceLines, invoices, matchRuns, products, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { allocateCapped, computeCappedGroups, computeLeakDrivers, DRIVER_DIMENSIONS, type CapLine } from '../leak-drivers';
import { computeLeakSummary } from '../leak-views';

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

const NOW = new Date('2026-10-25T12:00:00+03:00');

async function seed() {
  const [r] = await db.insert(restaurants).values({ name: 'Drivers Bistro' }).returning();
  const sup = async (name: string) => (await db.insert(suppliers).values({ restaurantId: r!.id, name }).returning())[0]!.id;
  const ids = { meat: await sup('קצביית הכרם'), veg: await sup('ירקות השרון'), fish: await sup('דגי הים'), dairy: await sup('מחלבת הגליל'), oil: await sup('שמנים') };
  let n = 0;
  type Line = string | { delta: string; type?: 'PRICE_HIGHER' | 'QTY_SHORT'; productId?: string };
  async function inv(supplierId: string, date: string, deltas: Line[], total: string | null = '10000') {
    n += 1;
    const [i] = await db
      .insert(invoices)
      .values({
        restaurantId: r!.id, supplierId, invoiceNumber: `D-${n}`, invoiceDate: new Date(date),
        totalExclVat: total, vatAmount: '0', totalInclVat: total, status: 'matched', source: 'photo',
      })
      .returning();
    const [mr] = await db.insert(matchRuns).values({ restaurantId: r!.id, invoiceId: i!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' }).returning();
    for (const line of deltas) {
      const l = typeof line === 'string' ? { delta: line } : line;
      await db.insert(discrepancies).values({
        restaurantId: r!.id, matchRunId: mr!.id, type: l.type ?? 'PRICE_HIGHER', severity: 'warn', deltaAmount: l.delta, productId: l.productId,
      });
    }
  }
  const product = async (canonicalName: string) => (await db.insert(products).values({ restaurantId: r!.id, canonicalName }).returning())[0]!.id;
  return { rid: r!.id, ids, inv, product };
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

  it('a chip carries the capped leak (= its landing): an invoice whose lines exceed its total', async () => {
    const { rid, ids, inv } = await seed();
    await inv(ids.meat, '2026-10-10T09:00:00Z', ['80.00', '80.00'], '100'); // Σ|Δ| 160, capped at the ₪100 total
    const d = await computeLeakDrivers(db, rid, { period: 'this_month', now: NOW });
    expect(d.comparison.deltaAgorot).toBe(10000);
    expect([d.drivers[0]!.currentAgorot, d.drivers[0]!.deltaAgorot, d.otherAgorot]).toEqual([10000, 10000, 0]);
  });

  it('a NULL total caps the invoice leak to 0, as the hero does today', async () => {
    const { rid, ids, inv } = await seed();
    await inv(ids.meat, '2026-10-10T09:00:00Z', ['40.00'], null);
    await inv(ids.meat, '2026-10-11T09:00:00Z', ['12.34']);
    const d = await computeLeakDrivers(db, rid, { period: 'this_month', now: NOW });
    const landing = await computeLeakSummary(db, rid, { period: 'this_month', now: NOW, filters: { supplierIds: [ids.meat] } });
    expect(d.drivers[0]!.currentAgorot).toBe(1234);
    expect(Math.round(landing.leakIls * 100)).toBe(1234);
  });

  it('parity for every dimension: each group = its landing (supplier), Σ groups = the hero in both windows', async () => {
    const { rid, ids, inv, product } = await seed();
    const beef = await product('אנטריקוט');
    const milk = await product('חלב');
    const OCT = (d: number) => `2026-10-${String(d).padStart(2, '0')}T09:00:00Z`;
    const SEP = (d: number) => `2026-09-${String(d).padStart(2, '0')}T09:00:00Z`;
    // Over the cap, 3 lines across 2 products and 2 types: 100 + 33.33 + 0.01 = 133.34 → capped at 100.
    await inv(ids.meat, OCT(3), [{ delta: '100.00', productId: beef }, { delta: '33.33', type: 'QTY_SHORT', productId: milk }, { delta: '0.01' }], '100');
    await inv(ids.meat, OCT(4), [{ delta: '7.00', productId: beef }]);
    await inv(ids.dairy, OCT(5), [{ delta: '19.99', productId: milk }], null); // NULL total → 0
    await inv(ids.dairy, OCT(6), [{ delta: '5.55', type: 'QTY_SHORT', productId: milk }]);
    await inv(ids.veg, OCT(7), [{ delta: '2.00' }, { delta: '2.00' }, { delta: '2.00' }], '5'); // 6 → 5: remainder rule
    await inv(ids.meat, SEP(3), [{ delta: '60.00', productId: beef }, { delta: '60.00', type: 'QTY_SHORT' }], '90');
    await inv(ids.fish, SEP(4), [{ delta: '11.11' }]);
    const view = { period: 'this_month' as const, now: NOW };
    for (const by of DRIVER_DIMENSIONS) {
      const d = await computeLeakDrivers(db, rid, view, { by, top: 10 });
      const heroCur = Math.round(d.comparison.current.leakIls * 100);
      const heroPrev = Math.round(d.comparison.previous.leakIls * 100);
      const cur = await computeCappedGroups(db, rid, view, by);
      const prev = await computeCappedGroups(db, rid, { period: 'custom', from: d.comparison.previous.from, to: d.comparison.previous.to, now: NOW }, by);
      const sum = (m: Map<string, { agorot: number }>) => [...m.values()].reduce((s, g) => s + g.agorot, 0);
      expect(sum(cur), `${by} current`).toBe(heroCur);
      expect(sum(prev), `${by} previous`).toBe(heroPrev);
      expect(d.drivers.reduce((s, x) => s + x.deltaAgorot, 0) + d.otherAgorot, by).toBe(d.comparison.deltaAgorot);
      // top 10 covers every group here, so nothing is left for "other".
      expect(d.otherAgorot, `${by} other`).toBe(0);
    }
    const sup = await computeLeakDrivers(db, rid, view, { top: 10 });
    for (const chip of sup.drivers) {
      const landing = await computeLeakSummary(db, rid, { ...view, filters: { supplierIds: [chip.key] } });
      expect(chip.currentAgorot, chip.label ?? chip.key).toBe(Math.round(landing.leakIls * 100));
    }
    expect(Object.fromEntries(sup.drivers.map((x) => [x.label, x.currentAgorot]))).toEqual({
      'קצביית הכרם': 10700, 'מחלבת הגליל': 555, 'ירקות השרון': 500, 'דגי הים': 0,
    });
  });

  it('by type and product dimensions; no change → no drivers', async () => {
    const { rid } = await seed();
    const d = await computeLeakDrivers(db, rid, { period: 'this_month', now: NOW }, { by: 'type' });
    expect([d.by, d.drivers, d.otherAgorot]).toEqual(['type', [], 0]);
  });
});

describe('allocateCapped', () => {
  const line = (invoiceId: string, lineId: string, amountAgorot: number, capAgorot: number, key = lineId): CapLine => ({
    invoiceId, lineId, amountAgorot, capAgorot, key, label: null, labelEn: null,
  });
  const agorot = (m: Map<string, { agorot: number }>) => Object.fromEntries([...m].map(([k, g]) => [k, g.agorot]));

  it('under the cap every line keeps its amount', () => {
    expect(agorot(allocateCapped([line('i', 'a', 700, 10000), line('i', 'b', 300, 10000)]))).toEqual({ a: 700, b: 300 });
  });

  it('over the cap: floor shares, leftover agorot to the largest remainders, ties by line id', () => {
    // 3 equal lines of 200 capped at 500: 166 each + 2 left over → lines a and b (ties by id).
    expect(agorot(allocateCapped([line('i', 'c', 200, 500), line('i', 'a', 200, 500), line('i', 'b', 200, 500)]))).toEqual({ a: 167, b: 167, c: 166 });
    // 10000 + 3333 + 1 = 13334 → 10000: floors 7499 + 2499 + 0 = 9998; remainders 8334, 8334, 10000
    // → the 2 agorot go to c (largest), then a (tie with b, by id).
    const m = allocateCapped([line('i', 'a', 10000, 10000), line('i', 'b', 3333, 10000), line('i', 'c', 1, 10000)]);
    expect(agorot(m)).toEqual({ a: 7500, b: 2499, c: 1 });
    expect([...m.values()].reduce((s, g) => s + g.agorot, 0)).toBe(10000);
  });

  it('a NULL (0) total allocates nothing; order of the input never changes the result', () => {
    expect(agorot(allocateCapped([line('i', 'a', 1999, 0)]))).toEqual({ a: 0 });
    const lines = [line('x', 'a', 333, 777, 'g1'), line('x', 'b', 555, 777, 'g2'), line('y', 'c', 101, 50, 'g1'), line('y', 'd', 99, 50, 'g2')];
    const ref = agorot(allocateCapped(lines));
    expect(agorot(allocateCapped([...lines].reverse()))).toEqual(ref);
    expect(ref.g1! + ref.g2!).toBe(777 + 50);
  });

  it('a negative total caps to a negative leak, like LEAST() in the hero', () => {
    const m = allocateCapped([line('i', 'a', 300, -100), line('i', 'b', 100, -100)]);
    expect([...m.values()].reduce((s, g) => s + g.agorot, 0)).toBe(-100);
  });
});

