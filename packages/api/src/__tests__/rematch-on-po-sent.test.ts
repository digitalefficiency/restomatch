import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, invoices, matchRuns, sql, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { invoicesAwaitingPo, poSentRematchKey, rematchOnPoSent } from '../match/rematchOnPoSent';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-04 follow-up Q4 (owner decision 11.11): when a draft order is sent, the invoices
 * it can now serve are re-matched automatically, once — nobody has to press
 * "התאם מחדש". Same restaurant and supplier only; settled invoices never.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const caller = (t: Tenant) => {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' };
  return appRouter.createCaller({ db, session } as AppContext);
};
const LINE = { rawDescription: 'עגבניות', qty: 4, unit: 'ק״ג', unitPriceExpected: 6.5 };
const DAY = 24 * 60 * 60 * 1000;

/** An invoice whose LATEST match run is `last` (and an optional older run before it). */
async function invoice(
  t: Tenant,
  o: {
    supplierId?: string;
    daysFromNow?: number;
    status?: 'parsed' | 'matched' | 'approved';
    last: { unordered?: boolean; poId?: string | null; resolution?: 'open' | 'escalated' | 'resolved' };
    older?: { unordered?: boolean };
    linkPinPoId?: string;
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
      ...(o.linkPinPoId ? { ocrPayload: { linkPinPoId: o.linkPinPoId } as unknown as (typeof invoices.$inferInsert)['ocrPayload'] } : {}),
    })
    .returning({ id: invoices.id });
  const run = async (when: Date, r: { unordered?: boolean; poId?: string | null; resolution?: 'open' | 'escalated' | 'resolved' }) => {
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: t.restaurantId, invoiceId: inv!.id, poId: r.poId ?? null, runAt: when, overallStatus: r.unordered ? 'blocked' : 'clean' })
      .returning({ id: matchRuns.id });
    if (r.unordered) {
      await db.insert(discrepancies).values({
        restaurantId: t.restaurantId,
        matchRunId: mr!.id,
        type: 'UNORDERED_ARRIVAL',
        severity: 'block',
        deltaAmount: '120.00',
        resolutionStatus: r.resolution ?? 'open',
      });
    }
  };
  if (o.older) await run(new Date(Date.now() - 2 * DAY), o.older);
  await run(new Date(Date.now() - DAY), o.last);
  return inv!.id;
}

const queued = async () =>
  (await db.execute(sql`
    select payload->>'invoiceId' as "invoiceId", (payload->>'rematch')::boolean as rematch, dedupe_key as "dedupeKey"
    from job_queue where queue = 'match-invoice' order by payload->>'invoiceId'
  `)) as unknown as Array<{ invoiceId: string; rematch: boolean; dedupeKey: string | null }>;

beforeEach(async () => {
  await resetDb(db);
  await db.execute(sql`delete from job_queue`);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(async () => {
  await db.execute(sql`delete from job_queue`);
  await resetDb(db);
});

describe('G-04 Q4: sending a draft order re-matches the invoices it can now serve', () => {
  it('placeOrder queues exactly the same-supplier invoices waiting for it, once each, with rematch on', async () => {
    const { poId } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    const [other] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ספק אחר' }).returning({ id: suppliers.id });

    const waiting = await invoice(A, { last: { unordered: true } }); // open UNORDERED_ARRIVAL, in the window
    const escalated = await invoice(A, { daysFromNow: -5, last: { unordered: true, resolution: 'escalated' } });
    const pinned = await invoice(A, { last: { poId } }); // latest run already points at this PO
    const linked = await invoice(A, { daysFromNow: 40, last: {}, linkPinPoId: poId }); // link-pinned, any date

    const farAway = await invoice(A, { daysFromNow: 30, last: { unordered: true } }); // outside the window
    const otherSupplier = await invoice(A, { supplierId: other!.id, last: { unordered: true } });
    const nowClean = await invoice(A, { older: { unordered: true }, last: {} }); // the hold was on an OLDER run
    const resolved = await invoice(A, { last: { unordered: true, resolution: 'resolved' } });
    const settled = await invoice(A, { status: 'approved', last: { unordered: true } });
    const foreign = await invoice(B, { last: { unordered: true } }); // another restaurant

    await expect(caller(A).orders.placeOrder({ poId, channel: 'none' })).resolves.toMatchObject({ ok: true });

    const jobs = await queued();
    expect(jobs.map((j) => j.invoiceId).sort()).toEqual([waiting, escalated, pinned, linked].sort());
    for (const j of jobs) {
      expect(j.rematch).toBe(true);
      expect(j.dedupeKey).toBe(poSentRematchKey(poId, j.invoiceId));
    }
    for (const id of [farAway, otherSupplier, nowClean, resolved, settled, foreign]) {
      expect(jobs.some((j) => j.invoiceId === id)).toBe(false);
    }
  });

  it('is idempotent: a second run queues nothing new, and a sent order cannot be sent again', async () => {
    const { poId } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    const waiting = await invoice(A, { last: { unordered: true } });
    await caller(A).orders.placeOrder({ poId, channel: 'none' });
    expect((await queued()).map((j) => j.invoiceId)).toEqual([waiting]);

    const again = await rematchOnPoSent(db, A.restaurantId, poId);
    expect(again.failed).toBe(0);
    expect((await queued()).map((j) => j.invoiceId)).toEqual([waiting]);
    await expect(caller(A).orders.placeOrder({ poId, channel: 'none' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('sendMany re-matches too', async () => {
    const { poId } = await caller(A).orders.createDraft({ supplierId: A.supplierId, lines: [LINE] });
    const waiting = await invoice(A, { last: { unordered: true } });
    await caller(A).orders.sendMany({ items: [{ poId, expectedStatus: 'draft' }], channel: 'none' });
    expect((await queued()).map((j) => j.invoiceId)).toEqual([waiting]);
  });

  it('never reads another restaurant: a foreign PO id finds nothing', async () => {
    const { poId } = await caller(B).orders.createDraft({ supplierId: B.supplierId, lines: [LINE] });
    await invoice(A, { last: { unordered: true } });
    expect(await invoicesAwaitingPo(db, A.restaurantId, poId)).toEqual([]);
  });
});
