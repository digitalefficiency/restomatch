/**
 * W2-04 §5.8 (functional-flows-05, deep-fix class 6): the claim is born INSIDE
 * the approve transaction, under the decider's name, at the decision time.
 * Undecided rows never get a claim (decision 18); reads write nothing.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, recoveryClaims, restaurants, sql, testDbUrl } from '@restomatch/db';
import { resetDb } from './fixtures';
import { addGap, addInvoice, callerAs, payloadOf, seedDesk, type Desk } from './approvals-desk.fixtures';
import { AMOUNT_CHANGED_PREFIX } from '../routers/approvals';

const db = createDb(testDbUrl());
let T: Desk;

beforeEach(async () => {
  await resetDb(db);
  T = await seedDesk(db, 'CD');
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
});
afterAll(async () => {
  await resetDb(db);
});

async function counts() {
  const [row] = (await db.execute(sql`
    SELECT (SELECT count(*) FROM recovery_claims WHERE restaurant_id = ${T.restaurantId})::int AS claims,
           (SELECT count(*) FROM recovery_events WHERE restaurant_id = ${T.restaurantId})::int AS events
  `)) as unknown as Array<{ claims: number; events: number }>;
  return row!;
}

describe('claim at decision', () => {
  it('approve → exactly one claim: created_by = the decider, claimed_at = resolved_at', async () => {
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: T.discrepancyId });
    const [d] = await db.select().from(discrepancies).where(eq(discrepancies.id, T.discrepancyId));
    const claims = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ discrepancyId: T.discrepancyId, createdBy: T.users.manager, amountAgorot: 10_000 });
    expect(claims[0]!.claimedAt.toISOString()).toBe(d!.resolvedAt!.toISOString());
    expect(d!.resolvedBy).toBe(T.users.manager);
  });

  it('re-approving (a stale card) is CONFLICT and makes no second claim', async () => {
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: T.discrepancyId });
    await expect(callerAs(db, T, 'owner').approvals.approve({ discrepancyId: T.discrepancyId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await counts()).claims).toBe(1);
    const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(c!.createdBy).toBe(T.users.manager);
  });

  it('undecided rows never get a claim — not by a decision on a sibling row, not by any read', async () => {
    const { matchRunId } = await addInvoice(db, T, 'sib');
    const decided = await addGap(db, T, matchRunId, { deltaAmount: '30.00' });
    const undecided = await addGap(db, T, matchRunId, { deltaAmount: '45.00' });
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: decided });
    const before = await counts();
    expect(before.claims).toBe(1);

    const owner = callerAs(db, T, 'owner');
    await owner.approvals.myQueue({ scope: 'all' });
    await owner.approvals.queueSummary();
    await owner.recovery.summary();
    await owner.recovery.list();
    expect(await counts()).toEqual(before);
    const rows = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, undecided));
    expect(rows).toHaveLength(0);
  });

  it('a waive (reject) makes no claim; an accepted duplicate is a hold, not a claim', async () => {
    await callerAs(db, T, 'manager').approvals.reject({ discrepancyId: T.discrepancyId, reason: 'מחיר מוסכם', reasonCode: 'price_agreed' });
    const { matchRunId } = await addInvoice(db, T, 'dup');
    const dup = await addGap(db, T, matchRunId, { deltaAmount: '1170.00', type: 'DUPLICATE_INVOICE', severity: 'warn', requiresRole: 'bookkeeper' });
    await callerAs(db, T, 'bookkeeper').approvals.approve({ discrepancyId: dup });
    expect((await counts()).claims).toBe(0);
  });

  it('the ₪ the decider saw moved → CONFLICT, nothing decided, no claim', async () => {
    const err = await callerAs(db, T, 'manager')
      .approvals.approve({ discrepancyId: T.discrepancyId, seenClaimAgorot: 9_999 })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'CONFLICT' });
    expect(payloadOf(err, AMOUNT_CHANGED_PREFIX)).toEqual({ seenAgorot: 9_999, nowAgorot: 10_000 });
    const [d] = await db.select().from(discrepancies).where(eq(discrepancies.id, T.discrepancyId));
    expect(d!.resolutionStatus).toBe('open');
    expect((await counts()).claims).toBe(0);
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: T.discrepancyId, seenClaimAgorot: 10_000 });
    expect((await counts()).claims).toBe(1);
  });

  it('undo inside the window writes the claim off with the decision', async () => {
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: T.discrepancyId });
    await callerAs(db, T, 'manager').approvals.reopen({ discrepancyId: T.discrepancyId });
    const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(c!.status).toBe('written_off');
    // Re-deciding re-opens the same claim under the system write-off rule: still one claim.
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: T.discrepancyId });
    expect((await counts()).claims).toBe(1);
  });
});
