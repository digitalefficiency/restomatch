import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import { legacyOrderReminderKey, orderReminderUrl, processOrderReminders } from '../jobs/orderReminders';
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

/**
 * AU-04 A5 · order-reminder truth: "ordered today" = SENT in today's Israel day
 * (never created_at); an unsent draft — whatever day it was created — is not an
 * order and is the linked draft; the chef hears it; no ₪; the option is honoured.
 */
describe('A5 order-reminder truth (DB)', () => {
  const TAG5 = `au04-a5-${process.pid}`;
  // Sun 25.10 09:00 IL (IST, UTC+2) = 07:00Z; Sat 24.10 08:00Z = 11:00 IL (IDT, UTC+3).
  const SLOT = '2026-10-25T07:00:00Z';
  const YESTERDAY = '2026-10-24T08:00:00Z';
  const TODAY_EARLY = '2026-10-25T05:30:00Z'; // 07:30 IL today
  let rid = '';
  let sid = '';
  const uids: string[] = [];

  async function resetPos() {
    await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
    await sql`delete from purchase_orders where restaurant_id = ${rid}`;
  }
  async function po(status: string, createdAt: string, sentAt: string | null, source = 'manual') {
    const [p] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, status, created_at, sent_at, source)
      values (${rid}, ${sid}, ${status}, ${createdAt}, ${sentAt}, ${source}) returning id`;
    return p!.id;
  }
  async function rows() {
    return sql<{ target: string; body: string; html: string; dedupe_key: string; automation: string | null }[]>`
      select target, body, payload->>'__html' as html, dedupe_key, payload->>'automationId' as automation
      from notifications_outbox where restaurant_id = ${rid} order by target`;
  }

  beforeAll(async () => {
    const [r] = await sql<{ id: string }[]>`insert into restaurants (name) values (${TAG5}) returning id`;
    rid = r!.id;
    for (const role of ['owner', 'manager', 'chef', 'receiver', 'bookkeeper']) {
      const [u] = await sql<{ id: string }[]>`insert into users (email, name) values (${`${TAG5}-${role}@example.test`}, ${role}) returning id`;
      uids.push(u!.id);
      await sql`insert into memberships (user_id, restaurant_id, role) values (${u!.id}, ${rid}, ${role})`;
    }
    const schedule = { windows: [{ orderDays: [0], cutoff: '16:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }] };
    const [s] = await sql<{ id: string }[]>`
      insert into suppliers (restaurant_id, name, active, order_schedule)
      values (${rid}, 'תנובה', true, ${sql.json(schedule)}) returning id`;
    sid = s!.id;
  });

  afterAll(async () => {
    if (rid) {
      await resetPos();
      await sql`delete from suppliers where restaurant_id = ${rid}`;
      await sql`delete from memberships where restaurant_id = ${rid}`;
      await sql`delete from restaurants where id = ${rid}`;
    }
    for (const u of uids) await sql`delete from users where id = ${u}`;
  });

  it('draft-only (created today) → a reminder to owner, manager and chef, linking the draft; no ₪', async () => {
    await resetPos();
    const draft = await po('draft', TODAY_EARLY, null);
    const r = await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect(r).toMatchObject({ dueToday: 1, enqueued: 3 });
    const out = await rows();
    expect(out.map((o) => o.target.split('-').pop())).toEqual([
      'chef@example.test',
      'manager@example.test',
      'owner@example.test',
    ]);
    for (const o of out) {
      expect(o.body).toContain('יש טיוטה שלא נשלחה לתנובה · השליחה עד 16:00');
      expect(o.body).toContain(`https://app.example.test/dashboard/orders/${draft}`);
      expect(`${o.body}${o.html}`).not.toContain('₪');
      expect(o.automation).toBe('A5');
      expect(o.dedupe_key).toMatch(new RegExp(`^au:A5:${rid}:[0-9a-f-]{36}:${sid}:2026-10-25$`));
    }
  });

  it('a draft created yesterday and still unsent → reminder linking that draft', async () => {
    await resetPos();
    const draft = await po('draft', YESTERDAY, null);
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const out = await rows();
    expect(out).toHaveLength(3);
    expect(out[0]!.body).toContain(`/dashboard/orders/${draft}`);
  });

  it('a draft created yesterday and SENT today → ordered, no reminder', async () => {
    await resetPos();
    await po('sent', YESTERDAY, TODAY_EARLY);
    const r = await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect(r).toMatchObject({ dueToday: 0, enqueued: 0 });
    expect(await rows()).toHaveLength(0);
  });

  it('a PO created and sent yesterday → not ordered today → reminder with the wizard link', async () => {
    await resetPos();
    await po('confirmed', YESTERDAY, YESTERDAY);
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const out = await rows();
    expect(out).toHaveLength(3);
    expect(out[0]!.body).toContain(`https://app.example.test/dashboard/orders/new?supplierId=${sid}`);
  });

  it('a platform import today (sent, no sent_at) → ordered; a checksum-held import draft too, never linked', async () => {
    await resetPos();
    await po('sent', TODAY_EARLY, null, 'platform');
    expect((await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }))).enqueued).toBe(0);
    await resetPos();
    await po('draft', TODAY_EARLY, null, 'platform');
    expect((await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }))).enqueued).toBe(0);
    await resetPos();
    await po('draft', YESTERDAY, null, 'platform'); // an old held import is not today's order and not "your draft"
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const out = await rows();
    expect(out).toHaveLength(3);
    expect(out[0]!.body).toContain('/dashboard/orders/new?supplierId=');
  });

  it('deploy day: a recipient already reminded under the OLD key is not reminded again; the chef (new) is', async () => {
    await resetPos();
    for (const role of ['owner', 'manager']) {
      const email = `${TAG5}-${role}@example.test`;
      await sql`insert into notifications_outbox (restaurant_id, channel, target, body, status, dedupe_key)
                values (${rid}, 'email', ${email}, 'old', 'sent', ${legacyOrderReminderKey(sid, '2026-10-25', email)})`;
    }
    const r = await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect(r.enqueued).toBe(1);
    const fresh = (await rows()).filter((o) => o.dedupe_key.startsWith('au:A5:'));
    expect(fresh.map((o) => o.target)).toEqual([`${TAG5}-chef@example.test`]);
    // a different day's old key does not suppress today's reminder
    await resetPos();
    const email = `${TAG5}-owner@example.test`;
    await sql`insert into notifications_outbox (restaurant_id, channel, target, body, status, dedupe_key)
              values (${rid}, 'email', ${email}, 'old', 'sent', ${legacyOrderReminderKey(sid, '2026-10-24', email)})`;
    expect((await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }))).enqueued).toBe(3);
  });

  it('a replay the same day enqueues nothing new', async () => {
    await resetPos();
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const again = await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect(again.enqueued).toBe(0);
    expect(await rows()).toHaveLength(3);
  });

  it('option off → skipped, nothing enqueued; back on → sends', async () => {
    await resetPos();
    await sql`update restaurants set settings = ${sql.json({ automations: { orderReminders: false } })} where id = ${rid}`;
    const off = await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect(off).toMatchObject({ enqueued: 0 });
    expect(await rows()).toHaveLength(0);
    await sql`update restaurants set settings = ${sql.json({ automations: { orderReminders: true } })} where id = ${rid}`;
    const on = await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect(on).toMatchObject({ enqueued: 3 });
    await sql`update restaurants set settings = '{}'::jsonb where id = ${rid}`;
  });
});
