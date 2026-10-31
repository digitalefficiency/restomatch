/**
 * W2-10a — claims at decision time (deep-fix class 6, functional-flows-05).
 *  - `materializeClaims` runs inside the decision transaction: created_by = the
 *    decider, claimed_at = the decision time, idempotent per discrepancy.
 *  - `recovery.summary` / `recovery.list` write nothing (row counts before/after).
 *  - MISSING_ON_INVOICE is never claimable (owner decision 31.10).
 *  - The catch-up `syncClaims` attributes to the decider, never to whoever ran it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  memberships,
  recoveryClaims,
  recoveryEvents,
  restaurants,
  sql,
  testDbUrl,
  users,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { materializeClaims, NEVER_CLAIMABLE_TYPES, syncClaims } from '../recovery/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let T: Tenant;
let deciderId: string;

function caller(role: Session['role'] = 'owner', userId = T.ownerUserId) {
  const ctx: AppContext = { db, session: { userId, restaurantId: T.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

async function counts() {
  const [row] = (await db.execute(sql`
    SELECT (SELECT count(*) FROM recovery_claims WHERE restaurant_id = ${T.restaurantId})::int AS claims,
           (SELECT count(*) FROM recovery_events WHERE restaurant_id = ${T.restaurantId})::int AS events
  `)) as unknown as Array<{ claims: number; events: number }>;
  return row!;
}

/** What a decision does: update the discrepancy and materialise in ONE transaction. */
async function decide(status: 'accepted' | 'rejected' | 'open', at: Date, by = deciderId, id = T.discrepancyId) {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Database;
    await tx
      .update(discrepancies)
      .set({ resolutionStatus: status, resolvedBy: status === 'open' ? null : by, resolvedAt: status === 'open' ? null : at })
      .where(eq(discrepancies.id, id));
    return materializeClaims(tx, { restaurantId: T.restaurantId, discrepancyIds: [id], actorId: by });
  });
}

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'M');
  const [u] = await db.insert(users).values({ email: 'decider-m@test.local', name: 'מנהלת מחליטה' }).returning();
  deciderId = u!.id;
  await db.insert(memberships).values({ userId: deciderId, restaurantId: T.restaurantId, role: 'manager' });
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
});

beforeEach(async () => {
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  await db
    .update(discrepancies)
    .set({ resolutionStatus: 'open', resolvedBy: null, resolvedAt: null, type: 'PRICE_HIGHER' })
    .where(eq(discrepancies.id, T.discrepancyId));
});

afterAll(async () => {
  await resetDb(db);
});

describe('materializeClaims (claims at decision)', () => {
  it('creates the claim inside the decision: created_by = the decider, claimed_at = the decision time', async () => {
    const at = new Date('2026-10-20T09:30:00.000Z');
    expect(await decide('accepted', at)).toBe(1);
    const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(c).toMatchObject({ status: 'claimed', amountAgorot: 10000, createdBy: deciderId, supplierId: T.supplierId });
    expect(c!.claimedAt.toISOString()).toBe(at.toISOString());
    const ev = await db.select().from(recoveryEvents).where(eq(recoveryEvents.claimId, c!.id));
    expect(ev.map((e) => [e.fromStatus, e.toStatus, e.actorId])).toEqual([[null, 'claimed', deciderId]]);
  });

  it('is idempotent per discrepancy (a second call, or a duplicate id, creates nothing)', async () => {
    const at = new Date('2026-10-20T09:30:00.000Z');
    expect(await decide('accepted', at)).toBe(1);
    const again = await db.transaction((raw) =>
      materializeClaims(raw as unknown as Database, {
        restaurantId: T.restaurantId,
        discrepancyIds: [T.discrepancyId, T.discrepancyId],
        actorId: T.ownerUserId,
      }),
    );
    expect(again).toBe(0);
    const rows = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdBy).toBe(deciderId);
    expect(await materializeClaims(db, { restaurantId: T.restaurantId, discrepancyIds: [], actorId: deciderId })).toBe(0);
  });

  it('rolls back with the decision: a failed decision leaves no claim behind', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Database;
        await tx
          .update(discrepancies)
          .set({ resolutionStatus: 'accepted', resolvedBy: deciderId, resolvedAt: new Date() })
          .where(eq(discrepancies.id, T.discrepancyId));
        await materializeClaims(tx, { restaurantId: T.restaurantId, discrepancyIds: [T.discrepancyId], actorId: deciderId });
        throw new Error('decision failed after materialising');
      }),
    ).rejects.toThrow('decision failed');
    expect((await counts()).claims).toBe(0);
  });

  it('a reject writes the untouched claim off; re-accepting re-opens it (scoped to the decided discrepancy)', async () => {
    await decide('accepted', new Date('2026-10-20T09:30:00Z'));
    await decide('rejected', new Date('2026-10-21T09:30:00Z'));
    let [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(c!.status).toBe('written_off');
    await decide('accepted', new Date('2026-10-22T09:30:00Z'));
    [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(c).toMatchObject({ status: 'claimed', amountAgorot: 10000 });
  });

  it('never claims a MISSING_ON_INVOICE (owner decision 31.10), nor PRICE_LOWER / UNORDERED_ARRIVAL', async () => {
    expect([...NEVER_CLAIMABLE_TYPES].sort()).toEqual(['MISSING_ON_INVOICE', 'PRICE_LOWER', 'UNORDERED_ARRIVAL']);
    for (const type of NEVER_CLAIMABLE_TYPES) {
      await db.update(discrepancies).set({ type }).where(eq(discrepancies.id, T.discrepancyId));
      expect(await decide('accepted', new Date())).toBe(0);
    }
    expect((await counts()).claims).toBe(0);
  });

  it('only touches the named discrepancies: another accepted one stays unclaimed', async () => {
    const [other] = await db
      .insert(discrepancies)
      .values({
        matchRunId: T.matchRunId,
        restaurantId: T.restaurantId,
        type: 'QTY_OVER',
        severity: 'warn',
        deltaAmount: '5.00',
        resolutionStatus: 'accepted',
        resolvedBy: T.ownerUserId,
        resolvedAt: new Date(),
      })
      .returning();
    try {
      expect(await decide('accepted', new Date())).toBe(1);
      const rows = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
      expect(rows.map((r) => r.discrepancyId)).toEqual([T.discrepancyId]);
    } finally {
      await db.delete(recoveryClaims).where(eq(recoveryClaims.discrepancyId, other!.id));
      await db.delete(discrepancies).where(eq(discrepancies.id, other!.id));
    }
  });
});

describe('reads write nothing', () => {
  it('recovery.summary and recovery.list leave recovery_claims / recovery_events untouched, even with an unclaimed accepted gap', async () => {
    // An accepted discrepancy with no claim yet: the old read path created it here.
    await db
      .update(discrepancies)
      .set({ resolutionStatus: 'accepted', resolvedBy: deciderId, resolvedAt: new Date() })
      .where(eq(discrepancies.id, T.discrepancyId));
    const before = await counts();
    const c = caller('bookkeeper');
    await c.recovery.summary();
    await c.recovery.list();
    await c.recovery.list({ limit: 5 });
    expect(await counts()).toEqual(before);
    expect(before.claims).toBe(0);
  });

  it('with an existing claim, a GET still writes nothing', async () => {
    await decide('accepted', new Date());
    const before = await counts();
    await caller().recovery.summary();
    await caller().recovery.list();
    expect(await counts()).toEqual(before);
  });
});

describe('syncClaims catch-up (jobs and scripts only)', () => {
  it('attributes a new claim to the decider and the decision time, never to whoever ran it', async () => {
    const at = new Date('2026-10-19T07:00:00.000Z');
    await db
      .update(discrepancies)
      .set({ resolutionStatus: 'accepted', resolvedBy: deciderId, resolvedAt: at })
      .where(eq(discrepancies.id, T.discrepancyId));
    expect(await syncClaims(db, T.restaurantId)).toBe(1);
    const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(c!.createdBy).toBe(deciderId);
    expect(c!.claimedAt.toISOString()).toBe(at.toISOString());
    const ev = await db.select().from(recoveryEvents).where(eq(recoveryEvents.claimId, c!.id));
    expect(ev[0]!.actorId).toBe(deciderId);
  });
});
