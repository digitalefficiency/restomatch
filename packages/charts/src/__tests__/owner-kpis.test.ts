import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  priceBaselines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  users,
} from '@restomatch/db';
import { computeOwnerKpis, emptyKpis } from '../owner-kpis';

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const db = createDb(TEST_DB_URL);

async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(grLines);
  await db.delete(goodsReceipts);
  await db.delete(priceBaselines);
  await db.delete(priceHistory);
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(productAliases);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);
}

async function seedRestaurant() {
  const [r] = await db.insert(restaurants).values({ name: 'KPI Bistro' }).returning();
  return r!.id;
}

beforeEach(resetDb);
afterAll(resetDb);

describe('computeOwnerKpis', () => {
  it('empty DB → emptyKpis defaults', async () => {
    const restaurantId = await seedRestaurant();
    const kpis = await computeOwnerKpis(db, restaurantId);
    expect(kpis).toEqual(emptyKpis());
  });

  it('sums unresolved warn+block discrepancies this month into potentialLoss', async () => {
    const restaurantId = await seedRestaurant();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId, overallStatus: 'major', totalDiscrepancyAmount: '150' })
      .returning();

    await db.insert(discrepancies).values([
      {
        matchRunId: mr!.id,
        restaurantId,
        type: 'PRICE_HIGHER',
        severity: 'warn',
        resolutionStatus: 'open',
        deltaAmount: '100',
      },
      {
        matchRunId: mr!.id,
        restaurantId,
        type: 'QTY_OVER',
        severity: 'block',
        resolutionStatus: 'open',
        deltaAmount: '200',
      },
      // info ones should NOT count
      {
        matchRunId: mr!.id,
        restaurantId,
        type: 'PRICE_LOWER',
        severity: 'info',
        resolutionStatus: 'open',
        deltaAmount: '50',
      },
    ]);

    const kpis = await computeOwnerKpis(db, restaurantId);
    expect(kpis.monthPotentialLossIls).toBe(300);
    expect(kpis.pendingApprovalsCount).toBe(2);
  });

  it('sums resolved discrepancies into savingsCaptured', async () => {
    const restaurantId = await seedRestaurant();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();

    await db.insert(discrepancies).values([
      {
        matchRunId: mr!.id,
        restaurantId,
        type: 'PRICE_HIGHER',
        severity: 'warn',
        resolutionStatus: 'accepted',
        deltaAmount: '500',
      },
      {
        matchRunId: mr!.id,
        restaurantId,
        type: 'DUPLICATE_INVOICE',
        severity: 'block',
        resolutionStatus: 'resolved',
        deltaAmount: '1200',
      },
    ]);

    const kpis = await computeOwnerKpis(db, restaurantId);
    expect(kpis.monthSavingsCapturedIls).toBe(1700);
    expect(kpis.pendingApprovalsCount).toBe(0); // both resolved
  });

  it('weekCleanMatchPct computed correctly', async () => {
    const restaurantId = await seedRestaurant();
    await db.insert(matchRuns).values([
      { restaurantId, overallStatus: 'clean', totalDiscrepancyAmount: '0' },
      { restaurantId, overallStatus: 'clean', totalDiscrepancyAmount: '0' },
      { restaurantId, overallStatus: 'clean', totalDiscrepancyAmount: '0' },
      { restaurantId, overallStatus: 'minor', totalDiscrepancyAmount: '10' },
    ]);
    const kpis = await computeOwnerKpis(db, restaurantId);
    expect(kpis.weekCleanMatchPct).toBe(75);
  });

  it('weekCleanMatchPct=100 when no match_runs (clean slate)', async () => {
    const restaurantId = await seedRestaurant();
    const kpis = await computeOwnerKpis(db, restaurantId);
    expect(kpis.weekCleanMatchPct).toBe(100);
  });

  it('respects restaurant scoping', async () => {
    const restaurantId = await seedRestaurant();
    const [other] = await db.insert(restaurants).values({ name: 'Other' }).returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: other!.id, overallStatus: 'major', totalDiscrepancyAmount: '5000' })
      .returning();
    await db.insert(discrepancies).values({
      matchRunId: mr!.id,
      restaurantId: other!.id,
      type: 'PRICE_HIGHER',
      severity: 'warn',
      resolutionStatus: 'open',
      deltaAmount: '5000',
    });

    const kpis = await computeOwnerKpis(db, restaurantId);
    expect(kpis.monthPotentialLossIls).toBe(0);
  });
});
