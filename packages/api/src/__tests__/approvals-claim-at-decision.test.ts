/**
 * W2-04 §5.8 (functional-flows-05, deep-fix class 6): the claim is born INSIDE
 * the approve transaction, under the decider's name, at the decision time.
 * Undecided rows never get a claim (decision 18); reads write nothing.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { activityEvents, createDb, discrepancies, eq, memberships, recoveryClaims, restaurants, sql, testDbUrl, users } from '@restomatch/db';
import { awaitingDecision } from '../approvals/awaiting';
import { DECISION_COPY } from '../notifications/templates';
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

  it('a waive (reject) makes no claim', async () => {
    await callerAs(db, T, 'manager').approvals.reject({ discrepancyId: T.discrepancyId, reason: 'מחיר מוסכם', reasonCode: 'price_agreed' });
    expect((await counts()).claims).toBe(0);
  });

  it('an accepted duplicate: one claim on the incl.-VAT basis + a held copy; never double-counted in awaitingDecision', async () => {
    const { invoiceId, matchRunId } = await addInvoice(db, T, 'dup');
    const dup = await addGap(db, T, matchRunId, { deltaAmount: '1170.00', type: 'DUPLICATE_INVOICE', severity: 'warn', requiresRole: 'bookkeeper' });
    const session = { restaurantId: T.restaurantId, role: 'owner' as const };
    const before = await awaitingDecision(db, { session }, { scope: 'all', filters: { invoiceIds: [invoiceId] } });
    expect(before.count).toBe(1);
    expect(before.ils).toMatchObject({ excl: 0, incl: 1170, vat: 0 });

    await callerAs(db, T, 'bookkeeper').approvals.approve({ discrepancyId: dup });
    const claims = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, dup));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ amountAgorot: 117_000, createdBy: T.users.bookkeeper, invoiceId });
    // The copy is held: the activity keeps the hold wording.
    const [act] = await db.select().from(activityEvents).where(eq(activityEvents.entityId, dup));
    expect(act!.title).toBe(DECISION_COPY.he.duplicateHeld);
    const after = await awaitingDecision(db, { session }, { scope: 'all', filters: { invoiceIds: [invoiceId] } });
    expect(after.count).toBe(0);
    expect(after.ils).toMatchObject({ excl: 0, incl: 0, vat: 0 });
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

  it('undo inside the window removes the bare claim; re-deciding creates exactly one fresh claim', async () => {
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: T.discrepancyId });
    await callerAs(db, T, 'manager').approvals.reopen({ discrepancyId: T.discrepancyId });
    // Bare (no letter, no money): deleted with the undo, not left as a write-off (warden LOW-2).
    expect((await counts()).claims).toBe(0);
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: T.discrepancyId });
    expect((await counts()).claims).toBe(1);
  });

  it('match.runForInvoice after an approve: the claim is rebound to the ORIGINAL decider, 0 claims lost (W2-04 rebind)', async () => {
    const owner = callerAs(db, T, 'owner');
    await owner.match.runForInvoice({ invoiceId: T.invoiceId });
    const rows = (await db.execute(sql`
      SELECT d.id FROM discrepancies d JOIN match_runs mr ON mr.id = d.match_run_id
      WHERE mr.invoice_id = ${T.invoiceId}::uuid AND d.severity IN ('warn','block')
        AND d.type IN ('QTY_SHORT','QTY_OVER','PRICE_HIGHER') AND d.delta_amount <> 0
      ORDER BY abs(d.delta_amount) DESC LIMIT 1`)) as unknown as Array<{ id: string }>;
    expect(rows.length).toBe(1);
    const id = rows[0]!.id;
    // A co-owner decides (the new run routes it to the owner again, so the decision is carried).
    const [co] = await db.insert(users).values({ email: 'coowner-cd@desk.test', name: 'שותפה' }).returning();
    await db.insert(memberships).values({ userId: co!.id, restaurantId: T.restaurantId, role: 'owner' });
    await callerAs(db, T, 'owner', co!.id).approvals.approve({ discrepancyId: id });
    const before = await counts();
    expect(before.claims).toBe(1);

    await owner.match.runForInvoice({ invoiceId: T.invoiceId });
    expect((await counts()).claims).toBe(before.claims);
    const [c] = (await db.execute(sql`
      SELECT c.created_by, d.resolution_status FROM recovery_claims c JOIN discrepancies d ON d.id = c.discrepancy_id
      WHERE c.restaurant_id = ${T.restaurantId}`)) as unknown as Array<{ created_by: string; resolution_status: string }>;
    expect(c).toMatchObject({ created_by: co!.id, resolution_status: 'accepted' });
  });
});
