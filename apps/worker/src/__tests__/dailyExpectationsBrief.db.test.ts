import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  and,
  createDb,
  eq,
  memberships,
  notificationsOutbox,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
  users,
  type UserRole,
} from '@restomatch/db';
import { processDailyExpectations } from '../jobs/dailyExpectations';
import type { WorkerJob } from '../queue';

/**
 * W3-03b: the 06:00 receiver brief ("N משלוחים היום") goes through notify() to the
 * receivers only, carries no ₪, dedupes per IL day, and respects the owner option.
 */
process.env.DATABASE_URL ??= testDbUrl();
const db = createDb(testDbUrl());
const RUN = `${process.pid}-${Date.now()}`;
const job = <T>(data: T): WorkerJob<T> => ({ id: 't', name: 't', data, attemptsMade: 0, opts: { attempts: 1 } });

// Tue 3 Nov 2026, 06:00 IST; deliveries at 09:00 and 11:30 IST the same day.
const RUN_AT = '2026-11-03T04:00:00Z';
const NEXT_DAY = '2026-11-04T04:00:00Z';
const restaurantIds: string[] = [];
const userIds: string[] = [];

async function member(restaurantId: string, tag: string, role: UserRole) {
  const [u] = await db
    .insert(users)
    .values({ email: `${tag}-${RUN}@brief.test`, name: tag, emailVerified: new Date() })
    .returning();
  userIds.push(u!.id);
  await db.insert(memberships).values({ userId: u!.id, restaurantId, role });
  return u!.id;
}

async function tenant(tag: string, settings: Record<string, unknown> = {}) {
  const [r] = await db.insert(restaurants).values({ name: `w3-03 brief ${tag} ${RUN}`, settings }).returning();
  restaurantIds.push(r!.id);
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ירקות השרון' }).returning();
  return { restaurantId: r!.id, supplierId: s!.id };
}

async function po(t: { restaurantId: string; supplierId: string }, at: string) {
  await db.insert(purchaseOrders).values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'sent', expectedDeliveryAt: new Date(at) });
}

const briefRows = (restaurantId: string) =>
  db
    .select()
    .from(notificationsOutbox)
    .where(and(eq(notificationsOutbox.restaurantId, restaurantId), sql`${notificationsOutbox.payload}->>'event' like 'receiver.morning_brief:%'`));

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(async () => {
  for (const id of restaurantIds) await db.delete(restaurants).where(eq(restaurants.id, id));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
});

describe('06:00 receiver brief (W3-03b)', () => {
  it('reaches the receivers only, no ₪, once per IL day', async () => {
    const t = await tenant('main');
    const receiver = await member(t.restaurantId, 'rcv', 'receiver');
    await member(t.restaurantId, 'own', 'owner');
    await po(t, '2026-11-03T07:00:00Z');
    await po(t, '2026-11-03T09:30:00Z');

    const res = await processDailyExpectations(job({ restaurantId: t.restaurantId, forDate: RUN_AT }));
    expect(res.summary).toEqual([{ restaurantId: t.restaurantId, count: 2, briefed: 1 }]);

    const rows = await briefRows(t.restaurantId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect((row.payload as { userId: string }).userId).toBe(receiver);
    expect(row.channel).toBe('email');
    expect(`${row.subject ?? ''} ${row.body}`).toContain('2');
    expect(`${row.subject ?? ''} ${row.body} ${JSON.stringify(row.payload)}`).not.toContain('₪');
    expect((row.payload as { deepLink: string }).deepLink).toBe('/dashboard/receiving');

    // A re-run the same morning dedupes; the next day's run is a new brief.
    await processDailyExpectations(job({ restaurantId: t.restaurantId, forDate: RUN_AT }));
    expect(await briefRows(t.restaurantId)).toHaveLength(1);
    await po(t, '2026-11-04T07:00:00Z');
    await processDailyExpectations(job({ restaurantId: t.restaurantId, forDate: NEXT_DAY }));
    expect(await briefRows(t.restaurantId)).toHaveLength(2);
  });

  it('sends nothing on a day with no deliveries, or with the option off', async () => {
    const empty = await tenant('empty');
    await member(empty.restaurantId, 'rcv-empty', 'receiver');
    const r1 = await processDailyExpectations(job({ restaurantId: empty.restaurantId, forDate: RUN_AT }));
    expect(r1.summary).toEqual([{ restaurantId: empty.restaurantId, count: 0 }]);
    expect(await briefRows(empty.restaurantId)).toHaveLength(0);

    const off = await tenant('off', { automations: { receiverBrief: false } });
    await member(off.restaurantId, 'rcv-off', 'receiver');
    await po(off, '2026-11-03T07:00:00Z');
    const r2 = await processDailyExpectations(job({ restaurantId: off.restaurantId, forDate: RUN_AT }));
    expect(r2.summary).toEqual([{ restaurantId: off.restaurantId, count: 1 }]);
    expect(await briefRows(off.restaurantId)).toHaveLength(0);
  });
});
