/**
 * W2-04 §5.3 — `approvals.decideMany` / `reopenMany`. The SERVER enforces the
 * owner's money limits: a blocking row is never bulk-decided, and an invoice
 * whose selected claimable ₪ > ₪200.00 (BULK_APPROVE_CAP_AGOROT) is refused.
 * All-or-nothing, one audit row per item, replay-safe by clientMutationId.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, createDb, discrepancies, eq, inArray, recoveryClaims, sql, testDbUrl } from '@restomatch/db';
import { resetDb } from './fixtures';
import { addGap, addInvoice, callerAs, payloadOf, seedDesk, type Desk } from './approvals-desk.fixtures';
import { BATCH_CONFLICT_PREFIX, BULK_REFUSED_PREFIX } from '../routers/approvals';
import { BULK_APPROVE_CAP_AGOROT, bulkRefusals } from '../approvals/bulkPolicy';

const db = createDb(testDbUrl());
let T: Desk;
let n = 0;
const cmid = () => `cmid-${Date.now()}-${++n}`;

beforeEach(async () => {
  await resetDb(db);
  T = await seedDesk(db, 'DM');
});
afterAll(async () => {
  await resetDb(db);
});

const items = (ids: string[], expectedStatus: 'open' | 'escalated' = 'open') =>
  ids.map((discrepancyId) => ({ discrepancyId, expectedStatus }));

async function statuses(ids: string[]) {
  const rows = await db
    .select({ id: discrepancies.id, s: discrepancies.resolutionStatus })
    .from(discrepancies)
    .where(inArray(discrepancies.id, ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.s]));
}
async function auditCount(ids: string[]) {
  const rows = await db.select({ id: auditLog.id }).from(auditLog).where(inArray(auditLog.entityId, ids));
  return rows.length;
}

describe('bulkPolicy (pure)', () => {
  it('the cap is ₪200.00 per invoice, in agorot', () => {
    expect(BULK_APPROVE_CAP_AGOROT).toBe(20_000);
    const at = (a: number, b: number) =>
      bulkRefusals([
        { discrepancyId: 'a', invoiceId: 'i1', severity: 'warn', claimAgorot: a },
        { discrepancyId: 'b', invoiceId: 'i1', severity: 'warn', claimAgorot: b },
      ]);
    expect(at(10_000, 10_000).size).toBe(0);
    expect([...at(10_000, 10_001).values()]).toEqual(['over_cap', 'over_cap']);
  });
});

describe('approvals.decideMany', () => {
  it('refuses a blocking row (server-side, nothing written)', async () => {
    const { matchRunId } = await addInvoice(db, T, '1');
    const ok = await addGap(db, T, matchRunId, { deltaAmount: '10.00' });
    const block = await addGap(db, T, matchRunId, { deltaAmount: '10.00', severity: 'block' });
    const err = await callerAs(db, T, 'manager')
      .approvals.decideMany({ items: items([ok, block]), decision: 'accepted', clientMutationId: cmid() })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'FORBIDDEN' });
    expect(payloadOf(err, BULK_REFUSED_PREFIX)).toEqual([{ discrepancyId: block, reason: 'block' }]);
    expect(await statuses([ok, block])).toEqual({ [ok]: 'open', [block]: 'open' });
    expect(await auditCount([ok, block])).toBe(0);
  });

  it('an invoice with selected ₪200.01 is refused; ₪200.00 is approved', async () => {
    const a = await addInvoice(db, T, 'cap-a');
    const over = [
      await addGap(db, T, a.matchRunId, { deltaAmount: '150.00' }),
      await addGap(db, T, a.matchRunId, { deltaAmount: '50.01' }),
    ];
    const err = await callerAs(db, T, 'manager')
      .approvals.decideMany({ items: items(over), decision: 'accepted', clientMutationId: cmid() })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'FORBIDDEN' });
    expect(payloadOf(err, BULK_REFUSED_PREFIX)).toEqual(over.map((discrepancyId) => ({ discrepancyId, reason: 'over_cap' })));
    expect(await statuses(over)).toEqual({ [over[0]!]: 'open', [over[1]!]: 'open' });

    const b = await addInvoice(db, T, 'cap-b');
    const atCap = [
      await addGap(db, T, b.matchRunId, { deltaAmount: '150.00' }),
      await addGap(db, T, b.matchRunId, { deltaAmount: '50.00' }),
    ];
    const res = await callerAs(db, T, 'manager').approvals.decideMany({
      items: items(atCap),
      decision: 'accepted',
      clientMutationId: cmid(),
    });
    expect(res.totalAgorot).toBe(20_000);
    expect(await statuses(atCap)).toEqual({ [atCap[0]!]: 'accepted', [atCap[1]!]: 'accepted' });
  });

  it('mixed invoices: one over-cap invoice refuses the whole batch (all-or-nothing)', async () => {
    const small = await addInvoice(db, T, 'mix-1');
    const big = await addInvoice(db, T, 'mix-2');
    const s1 = await addGap(db, T, small.matchRunId, { deltaAmount: '20.00' });
    const b1 = await addGap(db, T, big.matchRunId, { deltaAmount: '250.00' });
    const err = await callerAs(db, T, 'manager')
      .approvals.decideMany({ items: items([s1, b1]), decision: 'accepted', clientMutationId: cmid() })
      .catch((e) => e);
    expect(payloadOf(err, BULK_REFUSED_PREFIX)).toEqual([{ discrepancyId: b1, reason: 'over_cap' }]);
    expect(await statuses([s1, b1])).toEqual({ [s1]: 'open', [b1]: 'open' });
    expect(await auditCount([s1, b1])).toBe(0);
  });

  it('one stale expectedStatus → per-item CONFLICT and no audit rows', async () => {
    const { matchRunId } = await addInvoice(db, T, 'stale');
    const a = await addGap(db, T, matchRunId, { deltaAmount: '10.00' });
    const b = await addGap(db, T, matchRunId, { deltaAmount: '10.00' });
    const err = await callerAs(db, T, 'manager')
      .approvals.decideMany({
        items: [
          { discrepancyId: a, expectedStatus: 'open' },
          { discrepancyId: b, expectedStatus: 'escalated' },
        ],
        decision: 'accepted',
        clientMutationId: cmid(),
      })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'CONFLICT' });
    expect(payloadOf(err, BATCH_CONFLICT_PREFIX)).toEqual([{ discrepancyId: b, status: 'open' }]);
    expect(await auditCount([a, b])).toBe(0);
    expect(await statuses([a, b])).toEqual({ [a]: 'open', [b]: 'open' });
  });

  it('writes one audit row per item, with the decision and the ₪ the decider saw', async () => {
    const { matchRunId } = await addInvoice(db, T, 'audit');
    const ids = [
      await addGap(db, T, matchRunId, { deltaAmount: '12.34' }),
      await addGap(db, T, matchRunId, { deltaAmount: '0.66' }),
      await addGap(db, T, matchRunId, { deltaAmount: '3.00', type: 'QTY_SHORT', severity: 'info' }),
    ];
    const res = await callerAs(db, T, 'manager').approvals.decideMany({
      items: items(ids),
      decision: 'accepted',
      clientMutationId: cmid(),
    });
    expect(res.totalAgorot).toBe(1300);
    const audits = await db.select().from(auditLog).where(inArray(auditLog.entityId, ids));
    expect(audits).toHaveLength(3);
    expect(audits.map((a) => (a.after as { amountAgorot: number }).amountAgorot).sort((x, y) => x - y)).toEqual([0, 66, 1234]);
    for (const a of audits) {
      expect(a).toMatchObject({ action: 'discrepancy.approved', userId: T.users.manager });
      expect(a.after).toMatchObject({ decision: 'accepted', channel: 'bulk' });
    }
  });

  it('a bulk waive needs a reason; with one, every item is rejected', async () => {
    const { matchRunId } = await addInvoice(db, T, 'waive');
    const ids = [await addGap(db, T, matchRunId, { deltaAmount: '5.00' })];
    await expect(
      callerAs(db, T, 'manager').approvals.decideMany({ items: items(ids), decision: 'rejected', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await callerAs(db, T, 'manager').approvals.decideMany({
      items: items(ids),
      decision: 'rejected',
      reasonCode: 'price_agreed',
      clientMutationId: cmid(),
    });
    expect(await statuses(ids)).toEqual({ [ids[0]!]: 'rejected' });
  });

  it('reopenMany restores every item (and writes off the claims the decision made)', async () => {
    const { matchRunId } = await addInvoice(db, T, 'undo');
    const ids = [
      await addGap(db, T, matchRunId, { deltaAmount: '40.00' }),
      await addGap(db, T, matchRunId, { deltaAmount: '60.00' }),
    ];
    await callerAs(db, T, 'manager').approvals.decideMany({ items: items(ids), decision: 'accepted', clientMutationId: cmid() });
    const claims = await db.select().from(recoveryClaims).where(inArray(recoveryClaims.discrepancyId, ids));
    expect(claims.map((c) => c.status)).toEqual(['claimed', 'claimed']);
    const res = await callerAs(db, T, 'manager').approvals.reopenMany({ discrepancyIds: ids });
    expect(res.reopened.sort()).toEqual([...ids].sort());
    expect(await statuses(ids)).toEqual({ [ids[0]!]: 'open', [ids[1]!]: 'open' });
    const after = await db.select().from(recoveryClaims).where(inArray(recoveryClaims.discrepancyId, ids));
    expect(after.every((c) => c.status === 'written_off')).toBe(true);
  });

  it('reopenMany is all-or-nothing: an item nobody decided refuses the batch', async () => {
    const { matchRunId } = await addInvoice(db, T, 'undo2');
    const a = await addGap(db, T, matchRunId, { deltaAmount: '1.00' });
    const b = await addGap(db, T, matchRunId, { deltaAmount: '1.00' });
    await callerAs(db, T, 'manager').approvals.decideMany({ items: items([a]), decision: 'accepted', clientMutationId: cmid() });
    await expect(callerAs(db, T, 'manager').approvals.reopenMany({ discrepancyIds: [a, b] })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await statuses([a, b])).toEqual({ [a]: 'accepted', [b]: 'open' });
  });

  it('a replay of the same clientMutationId returns the first result and writes nothing', async () => {
    const { matchRunId } = await addInvoice(db, T, 'replay');
    const ids = [await addGap(db, T, matchRunId, { deltaAmount: '7.00' })];
    const id = cmid();
    const first = await callerAs(db, T, 'manager').approvals.decideMany({ items: items(ids), decision: 'accepted', clientMutationId: id });
    const again = await callerAs(db, T, 'manager').approvals.decideMany({ items: items(ids), decision: 'accepted', clientMutationId: id });
    expect(again).toMatchObject({ replayed: true, totalAgorot: first.totalAgorot, decided: first.decided });
    expect(await auditCount(ids)).toBe(1);
    const [{ c } = { c: -1 }] = (await db.execute(
      sql`SELECT count(*)::int AS c FROM recovery_claims WHERE discrepancy_id = ${ids[0]!}::uuid`,
    )) as unknown as Array<{ c: number }>;
    expect(c).toBe(1);
  });

  it('a role that may not act on a row refuses the batch (bookkeeper on manager rows)', async () => {
    const { matchRunId } = await addInvoice(db, T, 'role');
    const ids = [await addGap(db, T, matchRunId, { deltaAmount: '1.00' })];
    await expect(
      callerAs(db, T, 'bookkeeper').approvals.decideMany({ items: items(ids), decision: 'accepted', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await db.select().from(discrepancies).where(eq(discrepancies.id, ids[0]!)))[0]!.resolutionStatus).toBe('open');
  });
});
