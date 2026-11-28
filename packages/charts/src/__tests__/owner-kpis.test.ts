import { testDbUrl } from '@restomatch/db';
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
  recoveryClaims,
  restaurants,
  suppliers,
  users,
} from '@restomatch/db';
import { computeLeakHero } from '../leak-hero';
import { computeOwnerKpis, emptyKpis } from '../owner-kpis';

const TEST_DB_URL =
  testDbUrl();
const db = createDb(TEST_DB_URL);

async function resetDb() {
  await db.delete(recoveryClaims);
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

/** A match run on an invoice of this month (savings is the hero's figure: leak lines of real invoices). */
async function invoiceRun(restaurantId: string, total = '100000.00') {
  const [i] = await db.insert(invoices).values({ restaurantId, source: 'manual', status: 'matched', totalInclVat: total }).returning();
  const [mr] = await db
    .insert(matchRuns)
    .values({ restaurantId, invoiceId: i!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
    .returning();
  return mr!;
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

  it('does not count the ₪0 QTY_SHORT twin of a short delivery billed in full as pending', async () => {
    const restaurantId = await seedRestaurant();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId, overallStatus: 'major', totalDiscrepancyAmount: '38.70' })
      .returning();
    await db.insert(discrepancies).values([
      { matchRunId: mr!.id, restaurantId, type: 'QTY_OVER', severity: 'block', resolutionStatus: 'open', deltaAmount: '38.70' },
      { matchRunId: mr!.id, restaurantId, type: 'QTY_SHORT', severity: 'warn', resolutionStatus: 'open', deltaAmount: '0' },
      { matchRunId: mr!.id, restaurantId, type: 'QTY_SHORT', severity: 'warn', resolutionStatus: 'open', deltaAmount: '16' },
    ]);
    const kpis = await computeOwnerKpis(db, restaurantId);
    expect(kpis.pendingApprovalsCount).toBe(2);
    expect(kpis.monthPotentialLossIls).toBeCloseTo(54.7, 2);
  });

  it('sums resolved discrepancies into savingsCaptured', async () => {
    const restaurantId = await seedRestaurant();
    const mr = await invoiceRun(restaurantId);

    await db.insert(discrepancies).values([
      {
        matchRunId: mr!.id,
        restaurantId,
        type: 'PRICE_HIGHER',
        severity: 'warn',
        resolutionStatus: 'accepted',
        resolvedAt: new Date(), // a person's accept (approvals.approve stamps resolved_at)
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

  it('G-15 Q8: a SYSTEM auto-accept (accepted, no resolved_at) is never counted as savings', async () => {
    const restaurantId = await seedRestaurant();
    const mr = await invoiceRun(restaurantId);
    await db.insert(discrepancies).values([
      // person's accept → savings
      { matchRunId: mr!.id, restaurantId, type: 'PRICE_HIGHER', severity: 'warn', resolutionStatus: 'accepted', resolvedAt: new Date(), deltaAmount: '300' },
      // routing engine auto-accepts (non-leak-acknowledge / minor-info) → not savings
      { matchRunId: mr!.id, restaurantId, type: 'QTY_SHORT', severity: 'info', resolutionStatus: 'accepted', deltaAmount: '95.23' },
      { matchRunId: mr!.id, restaurantId, type: 'PRICE_LOWER', severity: 'info', resolutionStatus: 'accepted', deltaAmount: '40' },
    ]);
    const kpis = await computeOwnerKpis(db, restaurantId);
    expect(kpis.monthSavingsCapturedIls).toBe(300);
  });

  it('G-14 Q3: savings is the hero\'s "claimed" — capped, a live claim at its amount, a write-off at what came back', async () => {
    const restaurantId = await seedRestaurant();
    const person = { resolvedAt: new Date() };
    const d = (mr: { id: string }, v: Partial<typeof discrepancies.$inferInsert>) =>
      db.insert(discrepancies).values({ matchRunId: mr.id, restaurantId, type: 'PRICE_HIGHER', severity: 'warn', resolutionStatus: 'open', deltaAmount: '0', ...v }).returning();
    const claim = (discrepancyId: string, v: Partial<typeof recoveryClaims.$inferInsert>) =>
      db.insert(recoveryClaims).values({ restaurantId, discrepancyId, amountAgorot: 0, ...v });
    // S4: a ₪10 accept on an ₪8 invoice → ₪8 (capped).
    await d(await invoiceRun(restaurantId, '8.00'), { resolutionStatus: 'accepted', deltaAmount: '10', ...person });
    // S5: an acknowledged ₪6 claim on a rejected row (₪6 claimed) + a ₪3 accept → ₪9.
    const s5 = await invoiceRun(restaurantId);
    const [rej] = await d(s5, { resolutionStatus: 'rejected', deltaAmount: '6', ...person });
    await claim(rej!.id, { status: 'acknowledged', amountAgorot: 600 });
    await d(s5, { type: 'QTY_SHORT', resolutionStatus: 'accepted', deltaAmount: '3', ...person });
    // S6: a ₪10 claim written off with ₪4 credited → ₪4 (the rest is waived).
    const [wo] = await d(await invoiceRun(restaurantId), { resolutionStatus: 'accepted', deltaAmount: '10', ...person });
    await claim(wo!.id, { status: 'written_off', amountAgorot: 1000, creditedAgorot: 400 });
    // A bare accept (no person, no rule; legacy) → ₪7, as the decision table says.
    await d(await invoiceRun(restaurantId), { resolutionStatus: 'accepted', deltaAmount: '7' });
    const kpis = await computeOwnerKpis(db, restaurantId);
    const hero = await computeLeakHero(db, restaurantId);
    expect(kpis.monthSavingsCapturedIls).toBe(28);
    expect(kpis.monthSavingsCapturedIls).toBe(hero.recoveredIls);
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

  // NUM-10 (deliberate contract change): no runs ⇒ null ("no matches yet"), not 100%.
  it('weekCleanMatchPct=null when no match_runs (nothing to judge yet)', async () => {
    const restaurantId = await seedRestaurant();
    const kpis = await computeOwnerKpis(db, restaurantId);
    expect(kpis.weekCleanMatchPct).toBeNull();
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
