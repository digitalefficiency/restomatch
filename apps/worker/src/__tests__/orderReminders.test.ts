import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import { orderReminderUrl, processOrderReminders } from '../jobs/orderReminders';
import type { WorkerJob } from '../queue';

/**
 * The "no order placed today" reminder must land on the wizard WITH the supplier
 * picked. It used to link `/dashboard/orders/new?supplier=<id>` while the page read
 * only `?supplierId=`, so the manager landed on an empty supplier picker (orders-05).
 */
process.env.DATABASE_URL ??= testDbUrl();
process.env.APP_BASE_URL = 'https://app.example.test';

const sql = queueSql(testDbUrl());
const job = <T>(data: T): WorkerJob<T> => ({ id: 'test', name: 'test', data, attemptsMade: 0, opts: { attempts: 1 } });
const TAG = `w1-11-reminder-${process.pid}`;

let restaurantId = '';
let supplierId = '';
let userId = '';

describe('orderReminderUrl', () => {
  it('emits ?supplierId= (what the wizard reads)', () => {
    expect(orderReminderUrl('https://app.example.test', 'abc-123')).toBe(
      'https://app.example.test/dashboard/orders/new?supplierId=abc-123',
    );
  });
});

describe('order-reminders e-mail link (DB)', () => {
  beforeAll(async () => {
    const [r] = await sql<{ id: string }[]>`insert into restaurants (name) values (${TAG}) returning id`;
    restaurantId = r!.id;
    const [u] = await sql<{ id: string }[]>`insert into users (email, name) values (${`${TAG}@example.test`}, 'מנהלת') returning id`;
    userId = u!.id;
    await sql`insert into memberships (user_id, restaurant_id, role) values (${userId}, ${restaurantId}, 'manager')`;
    // Sunday order day, cutoff 16:00, delivered the next day.
    const schedule = { windows: [{ orderDays: [0], cutoff: '16:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }] };
    const [s] = await sql<{ id: string }[]>`
      insert into suppliers (restaurant_id, name, active, order_schedule)
      values (${restaurantId}, 'ירקות השרון', true, ${sql.json(schedule)}) returning id`;
    supplierId = s!.id;
  });

  afterAll(async () => {
    if (restaurantId) {
      await sql`delete from notifications_outbox where restaurant_id = ${restaurantId}`;
      await sql`delete from suppliers where restaurant_id = ${restaurantId}`;
      await sql`delete from memberships where restaurant_id = ${restaurantId}`;
      await sql`delete from restaurants where id = ${restaurantId}`;
    }
    if (userId) await sql`delete from users where id = ${userId}`;
    // No sql.end(): queueSql() is a memoized client shared by the other suites in this fork.
  });

  it('on the order day with no PO, the queued e-mail links the wizard with ?supplierId=', async () => {
    // 2026-10-25 is a Sunday; 07:00Z = 09:00 IL (the job's slot).
    const r = await processOrderReminders(job({ restaurantId, forDate: '2026-10-25T07:00:00Z' }));
    expect(r).toMatchObject({ date: '2026-10-25', dueToday: 1, enqueued: 1 });
    const rows = await sql<{ body: string; html: string | null }[]>`
      select body, payload::text as html from notifications_outbox where restaurant_id = ${restaurantId}`;
    expect(rows).toHaveLength(1);
    const want = `https://app.example.test/dashboard/orders/new?supplierId=${supplierId}`;
    expect(rows[0]!.body).toContain(want);
    if (rows[0]!.html) expect(rows[0]!.html).toContain(want);
    expect(`${rows[0]!.body}${rows[0]!.html ?? ''}`).not.toMatch(/[?&]supplier=/);
  });
});
