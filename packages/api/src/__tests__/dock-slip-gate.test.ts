import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  eq,
  goodsReceipts,
  invoices,
  matchRuns,
  restaurants,
  sql,
  testDbUrl,
  users,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * receiving.dockSlip — the "engine ₪ only after the count" gate, end to end
 * through submitReceipt:
 *  • the close time and match_runs.run_at are BOTH DB time (an API clock ahead
 *    of the DB must not make the post-count run look older than the close);
 *  • a re-match the worker will hold (rematchHoldReason) is reported at once;
 *  • the receiver's line carries a display name only, never the login e-mail.
 */
const db = createDb(testDbUrl());
let A: Tenant;

const caller = () =>
  appRouter.createCaller({ db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' } } as AppContext);

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'G');
  await db
    .update(restaurants)
    .set({ settings: { features: { dockSlip: true } } as (typeof restaurants.$inferInsert)['settings'] })
    .where(eq(restaurants.id, A.restaurantId));
});
afterAll(() => resetDb(db));

async function slip() {
  const s = await caller().receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId });
  if (!s.enabled) throw new Error('flag off');
  return s;
}

describe('dock slip gate', () => {
  it('the close is stamped in DB time: an API clock 2 h ahead does not hide the post-count run', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
    try {
      await caller().receiving.submitReceipt({ grId: A.grId });
    } finally {
      vi.useRealTimers();
    }
    const [gr] = await db
      .select({ closedAt: goodsReceipts.updatedAt, dbNow: sql<Date>`now()` })
      .from(goodsReceipts)
      .where(eq(goodsReceipts.id, A.grId));
    expect(new Date(gr!.closedAt).getTime()).toBeLessThanOrEqual(new Date(gr!.dbNow).getTime());
    // The worker's re-match after the count (run_at = DB now()).
    await db.update(matchRuns).set({ runAt: sql`now()` }).where(eq(matchRuns.id, A.matchRunId));
    const s = await slip();
    expect(s.engine.ready).toBe(true);
    expect(s.engine.totalIls).toBe(100);
  });

  it('a never-matched invoice held for review: says so at once (no wait for a run that will not come)', async () => {
    await db.delete(matchRuns).where(eq(matchRuns.invoiceId, A.invoiceId));
    await db.update(invoices).set({ status: 'parsed' }).where(eq(invoices.id, A.invoiceId));
    await caller().receiving.submitReceipt({ grId: A.grId });
    expect((await slip()).engine).toMatchObject({ receiptClosed: true, ready: false, holdReason: 'awaiting_review', lines: [] });
  });

  it('an invoice already approved on an earlier run: "settled", never the old ₪', async () => {
    await db.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, A.invoiceId));
    await caller().receiving.submitReceipt({ grId: A.grId });
    expect((await slip()).engine).toMatchObject({ receiptClosed: true, ready: false, holdReason: 'settled', totalIls: 0 });
  });

  it('a re-match on its way: no hold reason (the slip keeps waiting)', async () => {
    await caller().receiving.submitReceipt({ grId: A.grId });
    expect((await slip()).engine).toMatchObject({ receiptClosed: true, ready: false, holdReason: null });
  });

  it("the receiver's line is a display name only — never the login e-mail", async () => {
    expect((await slip()).header.receiverName).toBe('Owner G');
    await db.update(users).set({ name: null }).where(eq(users.id, A.ownerUserId));
    const s = await slip();
    expect(s.header.receiverName).toBeNull();
    expect(JSON.stringify(s)).not.toContain('@attack.test');
  });
});
