import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, matchRuns, restaurants, testDbUrl, type UserRole } from '@restomatch/db';
import { appRouter, type AppContext } from '@restomatch/api';
import { decideSummary } from '../queue-summary';

/**
 * "ממתין להחלטה שלך" — the home's decision-queue figures are ONE server-side
 * aggregate over the whole queue (never a capped page or a client sum), with the
 * same filters approvals.myQueue lists. Runs against the test DB.
 */
const db = createDb(testDbUrl());
const tag = `qs-${Date.now()}`;
let rid: string;
let otherRid: string;
let runId: string;

type Row = {
  type: 'PRICE_HIGHER' | 'PRICE_LOWER' | 'QTY_SHORT' | 'DUPLICATE_INVOICE';
  severity: 'info' | 'warn' | 'block';
  deltaAmount: string | null;
  requiresRole: UserRole | null;
  resolutionStatus?: 'open' | 'escalated' | 'accepted' | 'rejected';
};

async function add(restaurantId: string, matchRunId: string, rows: Row[]) {
  if (rows.length === 0) return;
  await db.insert(discrepancies).values(rows.map((r) => ({ restaurantId, matchRunId, resolutionStatus: 'open' as const, ...r })));
}

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: `Queue ${tag}` }).returning();
  const [o] = await db.insert(restaurants).values({ name: `Other ${tag}` }).returning();
  rid = r!.id;
  otherRid = o!.id;
  const [mr] = await db.insert(matchRuns).values({ restaurantId: rid, overallStatus: 'minor' }).returning();
  const [omr] = await db.insert(matchRuns).values({ restaurantId: otherRid, overallStatus: 'minor' }).returning();
  runId = mr!.id;
  // A big foreign queue: must never leak into ours.
  await add(otherRid, omr!.id, Array.from({ length: 20 }, () => ({ type: 'PRICE_HIGHER', severity: 'block', deltaAmount: '999.00', requiresRole: 'manager' })));
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, rid));
  await db.delete(restaurants).where(eq(restaurants.id, otherRid));
});

describe('decideSummary — the whole queue as one aggregate', () => {
  it('matches what approvals.myQueue lists, per role (count, Σ|Δ| without PRICE_LOWER, blocking)', async () => {
    await add(rid, runId, [
      { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '10.10', requiresRole: 'manager' },
      { type: 'PRICE_HIGHER', severity: 'block', deltaAmount: '-2.20', requiresRole: 'manager', resolutionStatus: 'escalated' },
      { type: 'PRICE_LOWER', severity: 'info', deltaAmount: '-5.00', requiresRole: 'manager' },
      { type: 'QTY_SHORT', severity: 'warn', deltaAmount: '0', requiresRole: 'manager' }, // zero-₪ twin: hidden
      { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '7.00', requiresRole: 'manager', resolutionStatus: 'accepted' }, // decided
      { type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: '100.00', requiresRole: 'bookkeeper' },
      { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '3.33', requiresRole: 'owner' },
      { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: null, requiresRole: 'owner' },
    ]);
    const expected: Record<'owner' | 'manager' | 'bookkeeper', { count: number; atRiskIls: number; blocking: number }> = {
      manager: { count: 3, atRiskIls: 12.3, blocking: 1 },
      bookkeeper: { count: 1, atRiskIls: 100, blocking: 1 },
      owner: { count: 6, atRiskIls: 115.63, blocking: 2 },
    };
    for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
      const s = await decideSummary(db, rid, role);
      expect(s).toEqual(expected[role]);
      const caller = appRouter.createCaller({ db, session: { userId: crypto.randomUUID(), restaurantId: rid, role } } as unknown as AppContext);
      const listed = await caller.approvals.myQueue({ limit: 100 });
      expect(listed).toHaveLength(s.count);
      const agorot = listed.filter((d) => d.type !== 'PRICE_LOWER').reduce((a, d) => a + Math.round(Math.abs(Number(d.deltaAmount ?? 0)) * 100), 0);
      expect(agorot / 100).toBe(s.atRiskIls);
    }
    await db.delete(discrepancies).where(eq(discrepancies.restaurantId, rid));
  });

  it('250 open items: count and ₪ cover all of them (not one 100-row page)', async () => {
    await add(
      rid,
      runId,
      Array.from({ length: 250 }, (_, i) => ({ type: 'PRICE_HIGHER' as const, severity: i < 3 ? ('block' as const) : ('warn' as const), deltaAmount: '1.10', requiresRole: 'manager' as const })),
    );
    expect(await decideSummary(db, rid, 'manager')).toEqual({ count: 250, atRiskIls: 275, blocking: 3 });
    await db.delete(discrepancies).where(eq(discrepancies.restaurantId, rid));
  });

  it('an empty queue is zeros; a role with nothing routed to it sees nothing', async () => {
    expect(await decideSummary(db, rid, 'manager')).toEqual({ count: 0, atRiskIls: 0, blocking: 0 });
    await add(rid, runId, [{ type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '4.00', requiresRole: 'bookkeeper' }]);
    expect(await decideSummary(db, rid, 'manager')).toEqual({ count: 0, atRiskIls: 0, blocking: 0 });
    await db.delete(discrepancies).where(eq(discrepancies.restaurantId, rid));
  });
});
