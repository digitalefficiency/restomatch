import { randomUUID } from 'node:crypto';
import { auditLog, createDb, eq, and, goodsReceipts, grLines, matchRuns, poLines, purchaseOrders, sql, testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '../index';
import { LEGACY_LENIENT_CLOSE } from '../routers/receiving';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W2-05 slice B · count truth on the server (deep-fix class 1): "לא נספר" is a
 * server state, "חסר" is 0/0/missing, a stale write is a CONFLICT, a replay is
 * a success, and one close is one close.
 */
const db = createDb(testDbUrl());
let t: Tenant;
const caller = () => appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } });

beforeEach(async () => {
  await resetDb(db);
  await db.execute(sql`DELETE FROM job_queue`);
  t = await seedTenant(db, 'count-truth');
});
afterAll(async () => {
  await resetDb(db);
});

async function receiptWith(n: number) {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'sent', source: 'manual', expectedDeliveryAt: new Date() })
    .returning();
  for (let i = 0; i < n; i += 1) {
    await db.insert(poLines).values({ poId: po!.id, rawDescription: `שורה ${i + 1}`, qtyOrdered: '4', unit: 'ק״ג', unitPriceExpected: '10' });
  }
  const { receiptId } = await caller().receiving.startReceipt({ poId: po!.id });
  const lines = await db.select({ id: grLines.id }).from(grLines).where(eq(grLines.grId, receiptId)).orderBy(grLines.id);
  return { grId: receiptId, lineIds: lines.map((l) => l.id) };
}

const audits = (action: string, entityId: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.entityId, entityId)));

describe('submitReceipt: "לא נספר" is a server state', () => {
  it('5 of 12 counted → PRECONDITION_FAILED {uncounted_lines: 7}; closeAs partial closes partial and records the 7 ids', async () => {
    const r = await receiptWith(12);
    for (const id of r.lineIds.slice(0, 5)) await caller().receiving.markGrLine({ grLineId: id, qtyReceived: 4, qtyRejected: 0 });
    const err = await caller()
      .receiving.submitReceipt({ grId: r.grId, clientMutationId: randomUUID() })
      .catch((e: unknown) => e as { code?: string; message?: string });
    expect(err).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(JSON.parse((err as { message: string }).message)).toEqual({ uncounted_lines: 7 });
    const [still] = await db.select({ status: goodsReceipts.status }).from(goodsReceipts).where(eq(goodsReceipts.id, r.grId));
    expect(still!.status).toBe('pending');

    const closed = await caller().receiving.submitReceipt({ grId: r.grId, clientMutationId: randomUUID(), closeAs: 'partial' });
    expect(closed.status).toBe('partial');
    const [row] = await audits('goods_receipt.closed', r.grId);
    expect(new Set((row!.after as { uncountedLineIds: string[] }).uncountedLineIds)).toEqual(new Set(r.lineIds.slice(5)));
  });

  it('"חסר" is stored 0 received / 0 rejected / missing — never a rejection — and counts as counted', async () => {
    const r = await receiptWith(1);
    await caller().receiving.markGrLine({ grLineId: r.lineIds[0]!, qtyReceived: 3, qtyRejected: 2, outcome: 'missing' });
    const [l] = await db.select().from(grLines).where(eq(grLines.id, r.lineIds[0]!));
    expect([Number(l!.qtyReceived), Number(l!.qtyRejected), l!.rejectReason]).toEqual([0, 0, 'missing']);
    await expect(caller().receiving.submitReceipt({ grId: r.grId, clientMutationId: randomUUID() })).resolves.toMatchObject({
      status: 'partial',
    });
  });

  it('decision 20: a bulk "הכל הגיע" close records which lines were attested, not counted by hand', async () => {
    const r = await receiptWith(4);
    // W1-06: two lines spot-checked by hand, the rest confirmed "as ordered".
    for (const [i, id] of r.lineIds.entries()) {
      await caller().receiving.markGrLine({
        grLineId: id,
        qtyReceived: 4,
        qtyRejected: 0,
        conditionNotes: i < 2 ? 'count:spot_check' : 'count:bulk_as_ordered',
      });
    }
    await caller().receiving.submitReceipt({ grId: r.grId, clientMutationId: randomUUID() });
    const [row] = await audits('goods_receipt.closed', r.grId);
    const after = row!.after as { attestedLineIds: string[]; uncountedLineIds: string[] };
    expect(new Set(after.attestedLineIds)).toEqual(new Set(r.lineIds.slice(2)));
    expect(after.uncountedLineIds).toEqual([]);
    // Never rewritten as a hand count.
    const notes = await db.select({ n: grLines.conditionNotes }).from(grLines).where(eq(grLines.grId, r.grId));
    expect(notes.filter((x) => x.n?.includes('count:bulk_as_ordered'))).toHaveLength(2);
    expect(notes.some((x) => x.n?.includes('per_line'))).toBe(false);
  });
});

describe('markGrLine: CAS in the UPDATE, replay = success', () => {
  it('a stale CAS → CONFLICT; the stored count is untouched', async () => {
    const r = await receiptWith(1);
    const id = r.lineIds[0]!;
    await caller().receiving.markGrLine({ grLineId: id, qtyReceived: 4, qtyRejected: 0 }); // phone 1
    await expect(
      caller().receiving.markGrLine({
        grLineId: id,
        qtyReceived: 2,
        qtyRejected: 0,
        // phone 2 still thinks the line is untouched
        expected: { qtyReceived: 0, qtyRejected: 0, rejectReason: null, conditionNotes: null },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const [l] = await db.select({ q: grLines.qtyReceived }).from(grLines).where(eq(grLines.id, id));
    expect(Number(l!.q)).toBe(4);
  });

  it('the right CAS writes; an identical replay returns the same row and writes ONE audit row', async () => {
    const r = await receiptWith(1);
    const id = r.lineIds[0]!;
    const write = {
      grLineId: id,
      qtyReceived: 3,
      qtyRejected: 0,
      expected: { qtyReceived: 0, qtyRejected: 0, rejectReason: null, conditionNotes: null },
    };
    const first = await caller().receiving.markGrLine(write);
    const replay = await caller().receiving.markGrLine(write); // the answer was lost; the outbox resends
    expect(replay.id).toBe(first.id);
    expect(Number(replay.qtyReceived)).toBe(3);
    expect(await audits('gr_line.marked', id)).toHaveLength(1);
  });

  it('the same clientMutationId replays the recorded row; reused for another write → CONFLICT', async () => {
    const r = await receiptWith(1);
    const id = r.lineIds[0]!;
    const key = randomUUID();
    await caller().receiving.markGrLine({ grLineId: id, qtyReceived: 1, qtyRejected: 0, clientMutationId: key });
    const again = await caller().receiving.markGrLine({ grLineId: id, qtyReceived: 1, qtyRejected: 0, clientMutationId: key });
    expect(Number(again.qtyReceived)).toBe(1);
    expect(await audits('gr_line.marked', id)).toHaveLength(1);
    await expect(
      caller().receiving.markGrLine({ grLineId: id, qtyReceived: 9, qtyRejected: 0, clientMutationId: key }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('counting lines on a pending receipt changes no match_runs', async () => {
    const r = await receiptWith(5);
    const before = (await db.select({ id: matchRuns.id }).from(matchRuns)).length;
    for (const id of r.lineIds) await caller().receiving.markGrLine({ grLineId: id, qtyReceived: 4, qtyRejected: 0 });
    expect((await db.select({ id: matchRuns.id }).from(matchRuns)).length).toBe(before);
  });
});

describe('submitReceipt: one close per clientMutationId', () => {
  it('a replayed submit is one close, one close audit, one re-match', async () => {
    const r = await receiptWith(2);
    for (const id of r.lineIds) await caller().receiving.markGrLine({ grLineId: id, qtyReceived: 4, qtyRejected: 0 });
    const key = randomUUID();
    const one = await caller().receiving.submitReceipt({ grId: r.grId, clientMutationId: key });
    const two = await caller().receiving.submitReceipt({ grId: r.grId, clientMutationId: key });
    expect(two.id).toBe(one.id);
    expect(two.status).toBe('completed');
    expect(await audits('goods_receipt.closed', r.grId)).toHaveLength(1);
    const replays = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'idempotency.recorded'), sql`${auditLog.after}->>'clientMutationId' = ${key}`));
    expect(replays).toHaveLength(1);
  });
});

describe('LEGACY_LENIENT_CLOSE (orchestrator 31.10, until the frozen mobile app retires)', () => {
  it('is ONE named switch, on for now', () => {
    expect(LEGACY_LENIENT_CLOSE).toBe(true);
  });

  it('a W2-05-contract caller (clientMutationId) is refused on uncounted lines', async () => {
    const r = await receiptWith(3);
    await caller().receiving.markGrLine({ grLineId: r.lineIds[0]!, qtyReceived: 4, qtyRejected: 0 });
    await expect(caller().receiving.submitReceipt({ grId: r.grId, clientMutationId: randomUUID() })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('a legacy close (no clientMutationId) still closes — and the uncounted lines are recorded AND surfaced on the receipt', async () => {
    const r = await receiptWith(3);
    await caller().receiving.markGrLine({ grLineId: r.lineIds[0]!, qtyReceived: 4, qtyRejected: 0 });
    const closed = await caller().receiving.submitReceipt({ grId: r.grId });
    expect(closed.status).toBe('partial');
    const [row] = await audits('goods_receipt.closed', r.grId);
    expect(row!.after).toMatchObject({ contract: 'legacy' });
    expect((row!.after as { uncountedLineIds: string[] }).uncountedLineIds).toHaveLength(2);
    // getReceipt carries the count the manager sees ("N שורות נסגרו בלי ספירה").
    expect((await caller().receiving.getReceipt({ grId: r.grId })).closedUncounted).toBe(2);
  });

  it('a fully counted receipt surfaces nothing', async () => {
    const r = await receiptWith(2);
    for (const id of r.lineIds) await caller().receiving.markGrLine({ grLineId: id, qtyReceived: 4, qtyRejected: 0 });
    await caller().receiving.submitReceipt({ grId: r.grId, clientMutationId: randomUUID() });
    expect((await caller().receiving.getReceipt({ grId: r.grId })).closedUncounted).toBe(0);
  });
});
