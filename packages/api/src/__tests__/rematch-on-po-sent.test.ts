import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, discrepancies, eq, invoices, matchRuns, purchaseOrders, sql, suppliers } from '@restomatch/db';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-04 follow-up Q4 (owner decision 11.11): when a draft order leaves 'draft',
 * the invoices PINNED to it are re-matched automatically, once — nobody has to
 * press "התאם מחדש". Same restaurant and supplier only; settled invoices never;
 * unpinned UNORDERED_ARRIVAL invoices never (review 28.11). The enqueue happens
 * only after the send commits, so a rolled-back batch queues nothing.
 */

// Records the PO's status as a SEPARATE connection sees it at the moment each
// re-match is enqueued: 'sent' proves the enqueue ran after the commit.
const probe = vi.hoisted(() => ({ statusAtEnqueue: [] as Array<string | null>, read: null as null | ((invoiceId: string) => Promise<string | null>) }));
vi.mock('@restomatch/queue', async (orig) => {
  const real = await orig<typeof import('@restomatch/queue')>();
  return {
    ...real,
    enqueueOutcome: async (...args: Parameters<typeof real.enqueueOutcome>) => {
      const payload = args[1] as { invoiceId?: string };
      if (probe.read && payload.invoiceId) probe.statusAtEnqueue.push(await probe.read(payload.invoiceId));
      return real.enqueueOutcome(...args);
    },
  };
});
const { appRouter } = await import('../index');
const { invoicesAwaitingPo, rematchOnPoSent } = await import('../match/rematchOnPoSent');

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let currentPo: string | null = null;
probe.read = async () => {
  if (!currentPo) return null;
  const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, currentPo));
  return po?.status ?? null;
};

const caller = (t: Tenant) => {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' };
  return appRouter.createCaller({ db, session } as AppContext);
};
const LINE = { rawDescription: 'עגבניות', qty: 4, unit: 'ק״ג', unitPriceExpected: 6.5 };
const DAY = 24 * 60 * 60 * 1000;
type Resolution = 'open' | 'escalated' | 'resolved';

/** An invoice whose LATEST match run is `last`. */
async function invoice(
  t: Tenant,
  o: {
    supplierId?: string;
    daysFromNow?: number;
    status?: 'parsed' | 'matched' | 'approved';
    last: { unordered?: boolean; poId?: string | null; resolution?: Resolution };
    pin?: { linkPinPoId?: string; heldPoId?: string };
  },
) {
  const at = new Date(Date.now() + (o.daysFromNow ?? 0) * DAY);
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: o.supplierId ?? t.supplierId,
      invoiceNumber: `INV-${Math.random().toString(36).slice(2, 8)}`,
      invoiceDate: at,
      source: 'email',
      status: o.status ?? 'matched',
      ...(o.pin ? { ocrPayload: o.pin as unknown as (typeof invoices.$inferInsert)['ocrPayload'] } : {}),
    })
    .returning({ id: invoices.id });
  const [mr] = await db
    .insert(matchRuns)
    .values({
      restaurantId: t.restaurantId,
      invoiceId: inv!.id,
      poId: o.last.poId ?? null,
      runAt: new Date(Date.now() - DAY),
      overallStatus: o.last.unordered ? 'blocked' : 'clean',
    })
    .returning({ id: matchRuns.id });
  if (o.last.unordered) {
    await db.insert(discrepancies).values({
      restaurantId: t.restaurantId,
      matchRunId: mr!.id,
      type: 'UNORDERED_ARRIVAL',
      severity: 'block',
      deltaAmount: '120.00',
      resolutionStatus: o.last.resolution ?? 'open',
    });
  }
  return inv!.id;
}

const queued = async () =>
  (await db.execute(sql`
    select payload->>'invoiceId' as "invoiceId", (payload->>'rematch')::boolean as rematch, dedupe_key as "dedupeKey"
    from job_queue where queue = 'match-invoice' order by payload->>'invoiceId'
  `)) as unknown as Array<{ invoiceId: string; rematch: boolean; dedupeKey: string | null }>;

const poStatus = async (poId: string) =>
  (await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, poId)))[0]?.status;

beforeEach(async () => {
  await resetDb(db);
  await db.execute(sql`delete from job_queue`);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  currentPo = null;
  probe.statusAtEnqueue.length = 0;
});
afterAll(async () => {
  await db.execute(sql`delete from job_queue`);
  await resetDb(db);
});

describe('G-04 Q4: sending a draft order re-matches the invoices pinned to it', () => {
  it('placeOrder queues exactly the pinned same-supplier invoices, once each, with rematch on, after the commit', async () => {
    const { poId } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    const [other] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ספק אחר' }).returning({ id: suppliers.id });

    const pinned = await invoice(A, { last: { poId } }); // latest run already points at this PO (draft pin)
    const pinnedBlocked = await invoice(A, { last: { poId, unordered: true } });
    const linked = await invoice(A, { daysFromNow: 40, last: {}, pin: { linkPinPoId: poId } }); // link-pinned, any date
    const held = await invoice(A, { last: { unordered: true }, pin: { heldPoId: poId } }); // held for this order

    // Review 28.11 (owner signed "pinned" only): unpinned UNORDERED_ARRIVAL invoices stay put, even in the window.
    const waitingUnpinned = await invoice(A, { last: { unordered: true } });
    const escalatedUnpinned = await invoice(A, { daysFromNow: -6, last: { unordered: true, resolution: 'escalated' } });
    const otherSupplier = await invoice(A, { supplierId: other!.id, last: { poId } });
    const settled = await invoice(A, { status: 'approved', last: { poId } });
    const foreign = await invoice(B, { last: { unordered: true }, pin: { linkPinPoId: poId } }); // another restaurant

    currentPo = poId;
    await expect(caller(A).orders.placeOrder({ poId, channel: 'none' })).resolves.toMatchObject({ ok: true });

    const jobs = await queued();
    expect(jobs.map((j) => j.invoiceId).sort()).toEqual([pinned, pinnedBlocked, linked, held].sort());
    for (const j of jobs) {
      expect(j.rematch).toBe(true);
      expect(j.dedupeKey).toMatch(new RegExp(`^rematch:po-sent:${poId}:\\d+:${j.invoiceId}$`));
    }
    for (const id of [waitingUnpinned, escalatedUnpinned, otherSupplier, settled, foreign]) {
      expect(jobs.some((j) => j.invoiceId === id)).toBe(false);
    }
    // Every enqueue saw the order already 'sent' from outside the transaction.
    expect(probe.statusAtEnqueue).toEqual(['sent', 'sent', 'sent', 'sent']);
  });

  it('an escalated or unpinned UNORDERED_ARRIVAL invoice is never queued', async () => {
    const { poId } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    await invoice(A, { daysFromNow: -6, last: { unordered: true, resolution: 'escalated' } });
    await invoice(A, { last: { unordered: true } });
    await caller(A).orders.placeOrder({ poId, channel: 'none' });
    expect(await queued()).toEqual([]);
    expect(await invoicesAwaitingPo(db, A.restaurantId, poId)).toEqual([]);
  });

  it('is idempotent: a second run queues nothing new and says so; a sent order cannot be sent again', async () => {
    const { poId } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    const pinned = await invoice(A, { last: { poId } });
    await caller(A).orders.placeOrder({ poId, channel: 'none' });
    expect((await queued()).map((j) => j.invoiceId)).toEqual([pinned]);

    const again = await rematchOnPoSent(db, A.restaurantId, poId);
    expect(again).toMatchObject({ requeued: 0, alreadyQueued: 1, failed: 0 });
    expect((await queued()).map((j) => j.invoiceId)).toEqual([pinned]);
    await expect(caller(A).orders.placeOrder({ poId, channel: 'none' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a draft queues nothing (rematchOnPoSent before the send)', async () => {
    const { poId } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    await invoice(A, { last: { poId } });
    expect(await rematchOnPoSent(db, A.restaurantId, poId)).toMatchObject({ requeued: 0, failed: 0 });
    expect(await queued()).toEqual([]);
  });

  it('sendMany re-matches too', async () => {
    const { poId } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    const pinned = await invoice(A, { last: { poId } });
    currentPo = poId;
    await caller(A).orders.sendMany({ items: [{ poId, expectedStatus: 'draft' }], channel: 'none' });
    expect((await queued()).map((j) => j.invoiceId)).toEqual([pinned]);
    expect(probe.statusAtEnqueue).toEqual(['sent']);
  });

  it('a rolled-back sendMany queues nothing; sending PO1 alone later re-matches it while it reads sent', async () => {
    await db.update(suppliers).set({ contactEmail: 'orders@supplier.test' }).where(eq(suppliers.id, A.supplierId));
    const [noEmail] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ספק בלי מייל' }).returning({ id: suppliers.id });
    const { poId: po1 } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    const { poId: po2 } = await caller(A).orders.createDraft({ supplierId: noEmail!.id, lines: [LINE] });
    const pinned = await invoice(A, { last: { poId: po1 } });

    currentPo = po1;
    await expect(
      caller(A).orders.sendMany({
        items: [
          { poId: po1, expectedStatus: 'draft' },
          { poId: po2, expectedStatus: 'draft' },
        ],
        channel: 'email',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await poStatus(po1)).toBe('draft');
    expect(await queued()).toEqual([]);
    expect(probe.statusAtEnqueue).toEqual([]);

    await caller(A).orders.placeOrder({ poId: po1, channel: 'none' });
    expect((await queued()).map((j) => j.invoiceId)).toEqual([pinned]);
    expect(probe.statusAtEnqueue).toEqual(['sent']);
  });

  it('markSentManually ("שלחתי מהוואטסאפ שלי") re-matches; its replay queues nothing new', async () => {
    const { poId } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    const pinned = await invoice(A, { last: { poId } });
    currentPo = poId;
    const first = await caller(A).orders.markSentManually({ poId, clientMutationId: 'manual-send-1' });
    expect(first).toMatchObject({ status: 'sent', replayed: false });
    expect((await queued()).map((j) => j.invoiceId)).toEqual([pinned]);
    expect(probe.statusAtEnqueue).toEqual(['sent']);

    const replay = await caller(A).orders.markSentManually({ poId, clientMutationId: 'manual-send-1' });
    expect(replay).toMatchObject({ replayed: true });
    expect((await queued()).map((j) => j.invoiceId)).toEqual([pinned]);
    expect(probe.statusAtEnqueue).toEqual(['sent']);
  });

  it('never reads another restaurant: a foreign PO id finds nothing', async () => {
    const { poId } = await caller(B).orders.createDraft({ supplierId: B.supplierId, lines: [LINE] });
    await invoice(A, { last: { unordered: true }, pin: { linkPinPoId: poId } });
    expect(await invoicesAwaitingPo(db, A.restaurantId, poId)).toEqual([]);
  });
});
