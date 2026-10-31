/**
 * W2-04 tenant-warden findings (31.10): the gate, the audit and the claim use
 * ONE ₪ — what `materializeClaims` committed — and decision transactions lock
 * in one order. Repros from the review, red on a4c57cd.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  auditLog,
  createDb,
  discrepancies,
  eq,
  inArray,
  notificationsOutbox,
  recoveryClaims,
  testDbUrl,
} from '@restomatch/db';
import { resetDb } from './fixtures';
import { addGap, addInvoice, callerAs, payloadOf, seedDesk, type Desk } from './approvals-desk.fixtures';
import { AMOUNT_CHANGED_PREFIX, BULK_REFUSED_PREFIX } from '../routers/approvals';

const db = createDb(testDbUrl());
let T: Desk;
let n = 0;
const cmid = () => `cmid-c-${Date.now()}-${++n}`;
const items = (ids: string[]) => ids.map((discrepancyId) => ({ discrepancyId, expectedStatus: 'open' as const }));

beforeEach(async () => {
  await resetDb(db);
  T = await seedDesk(db, 'CM');
});
afterAll(async () => {
  await resetDb(db);
});

const claimsOf = (ids: string[]) => db.select().from(recoveryClaims).where(inArray(recoveryClaims.discrepancyId, ids));
const auditAmount = async (id: string) => {
  const [a] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'discrepancy.approved')));
  return (a!.after as { amountAgorot: number }).amountAgorot;
};

describe('HIGH-1: one ₪ for gate, audit and claim', () => {
  it('a PAID invoice: the preview reads 0, but 2 × ₪300 would be claimed → the bulk cap refuses (nothing written)', async () => {
    const { matchRunId } = await addInvoice(db, T, 'paid', { status: 'paid' });
    const ids = [await addGap(db, T, matchRunId, { deltaAmount: '300.00' }), await addGap(db, T, matchRunId, { deltaAmount: '300.00' })];
    const err = await callerAs(db, T, 'manager')
      .approvals.decideMany({ items: items(ids), decision: 'accepted', clientMutationId: cmid() })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'FORBIDDEN' });
    expect((payloadOf(err, BULK_REFUSED_PREFIX) as Array<{ reason: string }>).every((r) => r.reason === 'over_cap')).toBe(true);
    expect(await claimsOf(ids)).toHaveLength(0);
    const st = await db.select().from(discrepancies).where(inArray(discrepancies.id, ids));
    expect(st.every((d) => d.resolutionStatus === 'open')).toBe(true);
  });

  it('a pending-link VAT_MISMATCH Δ50: the audit records the committed 5000, not the preview 0', async () => {
    const { matchRunId } = await addInvoice(db, T, 'pl');
    await addGap(db, T, matchRunId, { deltaAmount: '1170.00', type: 'UNORDERED_ARRIVAL', severity: 'warn' });
    const vat = await addGap(db, T, matchRunId, { deltaAmount: '50.00', type: 'VAT_MISMATCH' });
    const res = await callerAs(db, T, 'manager').approvals.decideMany({ items: items([vat]), decision: 'accepted', clientMutationId: cmid() });
    const [c] = await claimsOf([vat]);
    expect(c!.amountAgorot).toBe(5000);
    expect(await auditAmount(vat)).toBe(5000);
    expect(res.totalAgorot).toBe(5000);
  });

  it('cap-binding 80/60 on a ₪100 invoice: every audit amount equals its claim (decision order)', async () => {
    const { matchRunId } = await addInvoice(db, T, 'cap', { totalInclVat: '100.00' });
    const g80 = await addGap(db, T, matchRunId, { deltaAmount: '80.00' });
    const g60 = await addGap(db, T, matchRunId, { deltaAmount: '60.00' });
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: g60 });
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: g80 });
    const claims = await claimsOf([g60, g80]);
    const by = Object.fromEntries(claims.map((c) => [c.discrepancyId, c.amountAgorot]));
    expect(await auditAmount(g60)).toBe(by[g60]);
    expect(await auditAmount(g80)).toBe(by[g80]);
    expect(by[g60]! + by[g80]!).toBeLessThanOrEqual(10_000);
  });

  it('bulk bypass through an unselected line: the preview gives the cap to the big line, the claims do not → refused', async () => {
    const { matchRunId } = await addInvoice(db, T, 'byp', { totalInclVat: '250.00' });
    await addGap(db, T, matchRunId, { deltaAmount: '240.00' }); // not selected
    const sel = [await addGap(db, T, matchRunId, { deltaAmount: '150.00' }), await addGap(db, T, matchRunId, { deltaAmount: '100.00' })];
    const err = await callerAs(db, T, 'manager')
      .approvals.decideMany({ items: items(sel), decision: 'accepted', clientMutationId: cmid() })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'FORBIDDEN' });
    expect(await claimsOf(sel)).toHaveLength(0);
  });

  it('seenClaimAgorot is compared with the COMMITTED claim (paid invoice: preview 0, committed 30000 → CONFLICT, rollback)', async () => {
    const { matchRunId } = await addInvoice(db, T, 'seen', { status: 'paid' });
    const id = await addGap(db, T, matchRunId, { deltaAmount: '300.00' });
    const err = await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: id, seenClaimAgorot: 0 }).catch((e) => e);
    expect(payloadOf(err, AMOUNT_CHANGED_PREFIX)).toEqual({ seenAgorot: 0, nowAgorot: 30_000 });
    expect(await claimsOf([id])).toHaveLength(0);
  });

  it("the quick channel caps the committed ₪ (paid invoice preview 0, committed ₪600 → refused)", async () => {
    const { matchRunId } = await addInvoice(db, T, 'q', { status: 'paid' });
    const id = await addGap(db, T, matchRunId, { deltaAmount: '600.00' });
    await expect(callerAs(db, T, 'manager').approvals.approve({ discrepancyId: id, channel: 'quick' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await claimsOf([id])).toHaveLength(0);
  });
});

describe('LOW fixes', () => {
  it('LOW-1: two opposite-order batches at once never deadlock (one wins, the other is a clean CONFLICT)', async () => {
    const { matchRunId } = await addInvoice(db, T, 'dl');
    const a = await addGap(db, T, matchRunId, { deltaAmount: '10.00' });
    const b = await addGap(db, T, matchRunId, { deltaAmount: '10.00' });
    const mgr = callerAs(db, T, 'manager');
    const own = callerAs(db, T, 'owner');
    const res = await Promise.allSettled([
      mgr.approvals.decideMany({ items: items([a, b]), decision: 'accepted', clientMutationId: cmid() }),
      own.approvals.decideMany({ items: items([b, a]), decision: 'accepted', clientMutationId: cmid() }),
    ]);
    const errors = res.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(errors.every((e) => e.code === 'CONFLICT')).toBe(true);
    expect(errors.some((e) => /deadlock/i.test(String(e.message)))).toBe(false);
  });

  it('LOW-2: undo deletes the bare claim; a re-accept by someone else creates it under THEM with a fresh clock', async () => {
    const { matchRunId } = await addInvoice(db, T, 'undo');
    const id = await addGap(db, T, matchRunId, { deltaAmount: '40.00' });
    await callerAs(db, T, 'manager').approvals.approve({ discrepancyId: id });
    const [first] = await claimsOf([id]);
    await callerAs(db, T, 'manager').approvals.reopen({ discrepancyId: id });
    expect(await claimsOf([id])).toHaveLength(0);
    await callerAs(db, T, 'owner').approvals.approve({ discrepancyId: id });
    const [again] = await claimsOf([id]);
    expect(again!.createdBy).toBe(T.ownerUserId);
    expect(again!.id).not.toBe(first!.id);
    expect(again!.claimedAt.getTime()).toBeGreaterThanOrEqual(first!.claimedAt.getTime());
  });

  it("LOW-6: undoing an escalation cancels that escalation's queued owner e-mails", async () => {
    await callerAs(db, T, 'manager').approvals.escalate({ discrepancyId: T.discrepancyId });
    const q = () =>
      db
        .select()
        .from(notificationsOutbox)
        .where(and(eq(notificationsOutbox.relatedEntityId, T.discrepancyId), eq(notificationsOutbox.relatedEntityType, 'discrepancy')));
    expect((await q()).every((r) => r.status === 'queued')).toBe(true);
    expect((await q()).length).toBeGreaterThan(0);
    await callerAs(db, T, 'manager').approvals.reopen({ discrepancyId: T.discrepancyId });
    expect((await q()).every((r) => r.status === 'cancelled')).toBe(true);
  });
});
