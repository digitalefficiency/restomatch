/**
 * W2-04 §5.4 + §5.10: the role × scope matrix and the one-tap ("quick")
 * channel limits. Owner / manager / bookkeeper read (`mine` and `all`); the
 * bookkeeper decides only bookkeeper-routed rows; receiver and chef are
 * FORBIDDEN everywhere. `quick` refuses a blocking row and claimable ₪ > ₪500.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, testDbUrl, type UserRole } from '@restomatch/db';
import { resetDb } from './fixtures';
import { addGap, addInvoice, callerAs, payloadOf, seedDesk, type Desk } from './approvals-desk.fixtures';
import { QUICK_REFUSED_PREFIX } from '../routers/approvals';
import { ONE_TAP_APPROVE_CAP_AGOROT } from '../approvals/bulkPolicy';

const db = createDb(testDbUrl());
let T: Desk;
let bkRow: string;

async function seed() {
  await resetDb(db);
  T = await seedDesk(db, 'SC');
  const { matchRunId } = await addInvoice(db, T, 'bk');
  bkRow = await addGap(db, T, matchRunId, { deltaAmount: '1170.00', type: 'DUPLICATE_INVOICE', requiresRole: 'bookkeeper' });
}

describe('role × scope', () => {
  beforeAll(seed);
  afterAll(async () => {
    await resetDb(db);
  });

  it.each<UserRole>(['owner', 'manager', 'bookkeeper'])('%s reads mine and all; each row says canAct + waitingOn', async (role) => {
    const c = callerAs(db, T, role);
    const all = await c.approvals.myQueue({ scope: 'all' });
    expect(all.map((r) => r.id).sort()).toEqual([T.discrepancyId, bkRow].sort());
    const byId = Object.fromEntries(all.map((r) => [r.id, r]));
    expect(byId[T.discrepancyId]!.waitingOn).toBe('manager');
    expect(byId[bkRow]!.waitingOn).toBe('bookkeeper');
    expect(byId[T.discrepancyId]!.canAct).toBe(role !== 'bookkeeper');
    expect(byId[bkRow]!.canAct).toBe(role !== 'manager');
    const mine = await c.approvals.myQueue();
    expect(mine.every((r) => r.canAct)).toBe(true);
  });

  it('the bookkeeper reads everything but decides only bookkeeper-routed rows', async () => {
    const bk = callerAs(db, T, 'bookkeeper');
    expect((await bk.approvals.myQueue()).map((r) => r.id)).toEqual([bkRow]);
    await expect(bk.approvals.approve({ discrepancyId: T.discrepancyId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const sum = await bk.approvals.queueSummary();
    expect(sum.others.byRole.map((l) => [l.role, l.count])).toEqual([['manager', 1]]);
    expect(sum.others.amountIls).toBe(100);
  });

  it.each<UserRole>(['receiver', 'chef'])('%s is FORBIDDEN on the queue and on every decision', async (role) => {
    const c = callerAs(db, T, role);
    await expect(c.approvals.myQueue()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(c.approvals.myQueue({ scope: 'all' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(c.approvals.approve({ discrepancyId: T.discrepancyId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      c.approvals.decideMany({
        items: [{ discrepancyId: T.discrepancyId, expectedStatus: 'open' }],
        decision: 'accepted',
        clientMutationId: 'cmid-forbidden',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(c.approvals.history({ discrepancyId: T.discrepancyId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the queue output stays additive (the frozen mobile manager screen reads id/type/severity/deltaAmount)', async () => {
    const [row] = await callerAs(db, T, 'manager').approvals.myQueue();
    expect(row).toMatchObject({ id: T.discrepancyId, type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '100.00' });
  });
});

describe("approve({channel: 'quick'}) — the one-tap limits", () => {
  beforeEach(seed);
  afterAll(async () => {
    await resetDb(db);
  });

  const statusOf = async (id: string) =>
    (await db.select().from(discrepancies).where(eq(discrepancies.id, id)))[0]!.resolutionStatus;

  it('refuses claimable ₪500.01 and allows ₪500.00 (the cap is integer agorot)', async () => {
    expect(ONE_TAP_APPROVE_CAP_AGOROT).toBe(50_000);
    const { matchRunId } = await addInvoice(db, T, 'q');
    const over = await addGap(db, T, matchRunId, { deltaAmount: '500.01' });
    const err = await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: over, channel: 'quick' }).catch((e) => e);
    expect(err).toMatchObject({ code: 'FORBIDDEN' });
    expect(payloadOf(err, QUICK_REFUSED_PREFIX)).toEqual({ reason: 'over_cap' });
    expect(await statusOf(over)).toBe('open');

    const { matchRunId: m2 } = await addInvoice(db, T, 'q2');
    const at = await addGap(db, T, m2, { deltaAmount: '500.00' });
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: at, channel: 'quick' });
    expect(await statusOf(at)).toBe('accepted');
    // The desk channel has no one-tap cap.
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: over });
    expect(await statusOf(over)).toBe('accepted');
  });

  it('refuses a blocking row on the quick channel', async () => {
    const { matchRunId } = await addInvoice(db, T, 'qb');
    const block = await addGap(db, T, matchRunId, { deltaAmount: '5.00', severity: 'block' });
    const err = await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: block, channel: 'quick' }).catch((e) => e);
    expect(payloadOf(err, QUICK_REFUSED_PREFIX)).toEqual({ reason: 'block' });
    expect(await statusOf(block)).toBe('open');
  });
});
