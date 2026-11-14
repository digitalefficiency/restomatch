import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import { processDailyExpectations } from '../jobs/dailyExpectations';
import type { WorkerJob } from '../queue';

/**
 * AU-04 A4 · the 06:00 receiver truck brief rides daily-expectations through G-06
 * notify(): the receiver (and only the receiver) gets today's trucks, with no ₪;
 * zero deliveries → nothing; a Saturday 06:00 brief is perishable → skipped, never
 * queued; the option turns it off; the audit row is still written.
 */
process.env.DATABASE_URL ??= testDbUrl();
process.env.APP_BASE_URL = 'https://app.example.test';
const sql = queueSql(testDbUrl());
const job = <T>(data: T): WorkerJob<T> => ({ id: 't', name: 't', data, attemptsMade: 0, opts: { attempts: 1 } });
const TAG = `au04-a4-${process.pid}`;

// Tue 3 Nov 2026 06:00 IST = 04:00Z. Trucks at 09:00 IST and one with no time (IL midnight).
const TUE_0600 = '2026-11-03T04:00:00Z';
const TUE_0900 = '2026-11-03T07:00:00Z';
const TUE_MIDNIGHT = '2026-11-02T22:00:00Z';
// Sat 7 Nov 2026 06:00 IST: Shabbat → the brief would not go before Saturday night.
const SAT_0600 = '2026-11-07T04:00:00Z';
const SAT_0900 = '2026-11-07T07:00:00Z';

let rid = '';
let sid = '';
const uids: string[] = [];

async function rows() {
  return sql<{ target: string; body: string; html: string | null; dedupe_key: string; automation: string | null }[]>`
    select target, body, payload->>'__html' as html, dedupe_key, payload->>'automationId' as automation
    from notifications_outbox where restaurant_id = ${rid} order by target`;
}
async function po(expected: string, status = 'sent') {
  await sql`insert into purchase_orders (restaurant_id, supplier_id, status, expected_delivery_at)
            values (${rid}, ${sid}, ${status}, ${expected})`;
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const [r] = await sql<{ id: string }[]>`insert into restaurants (name) values (${TAG}) returning id`;
  rid = r!.id;
  for (const role of ['receiver', 'owner', 'chef']) {
    const [u] = await sql<{ id: string }[]>`insert into users (email, name) values (${`${TAG}-${role}@example.test`}, ${role}) returning id`;
    uids.push(u!.id);
    await sql`insert into memberships (user_id, restaurant_id, role) values (${u!.id}, ${rid}, ${role})`;
  }
  const [s] = await sql<{ id: string }[]>`insert into suppliers (restaurant_id, name) values (${rid}, 'תנובה') returning id`;
  sid = s!.id;
});

beforeEach(async () => {
  await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
  await sql`delete from audit_log where restaurant_id = ${rid}`;
  await sql`delete from purchase_orders where restaurant_id = ${rid}`;
  await sql`update restaurants set settings = '{}'::jsonb where id = ${rid}`;
});

afterAll(async () => {
  if (rid) {
    await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
    await sql`delete from purchase_orders where restaurant_id = ${rid}`;
    await sql`delete from suppliers where restaurant_id = ${rid}`;
    await sql`delete from memberships where restaurant_id = ${rid}`;
    await sql`delete from audit_log where restaurant_id = ${rid}`;
    await sql`delete from restaurants where id = ${rid}`;
  }
  for (const u of uids) await sql`delete from users where id = ${u}`;
});

describe('A4 receiver morning brief (DB)', () => {
  it('two trucks today → one e-mail, to the receiver only, no ₪, keyed au:A4 on the IL day', async () => {
    await po(TUE_0900);
    await po(TUE_MIDNIGHT);
    await processDailyExpectations(job({ restaurantId: rid, forDate: TUE_0600 }));
    const out = await rows();
    expect(out.map((o) => o.target)).toEqual([`${TAG}-receiver@example.test`]);
    const o = out[0]!;
    expect(o.body).toContain('בוקר טוב · היום צפויים 2 משלוחים');
    expect(o.body).toContain('תנובה ~09:00');
    expect(o.body).toContain('תנובה (ללא שעה)');
    expect(o.body).toContain('/dashboard/go?r=');
    expect(`${o.body}${o.html ?? ''}`).not.toContain('₪');
    expect(o.automation).toBe('A4');
    expect(o.dedupe_key.startsWith(`au:A4:2026-11-03:${rid}:`)).toBe(true);
    // The audit row is still written.
    const [a] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where restaurant_id = ${rid} and action = 'daily_expectations.computed'`;
    expect(a!.n).toBe(1);
  });

  it('a replay the same morning enqueues nothing new', async () => {
    await po(TUE_0900);
    await processDailyExpectations(job({ restaurantId: rid, forDate: TUE_0600 }));
    await processDailyExpectations(job({ restaurantId: rid, forDate: TUE_0600 }));
    expect(await rows()).toHaveLength(1);
  });

  it('no truck today → no message (never "0 משלוחים")', async () => {
    await processDailyExpectations(job({ restaurantId: rid, forDate: TUE_0600 }));
    expect(await rows()).toHaveLength(0);
  });

  it('Saturday 06:00 → perishable: skipped, not queued for Saturday night', async () => {
    await po(SAT_0900);
    await processDailyExpectations(job({ restaurantId: rid, forDate: SAT_0600 }));
    expect(await rows()).toHaveLength(0);
  });

  it('option off → nothing; back on → sent', async () => {
    await po(TUE_0900);
    await sql`update restaurants set settings = ${sql.json({ automations: { receiverBrief: false } })} where id = ${rid}`;
    await processDailyExpectations(job({ restaurantId: rid, forDate: TUE_0600 }));
    expect(await rows()).toHaveLength(0);
    await sql`update restaurants set settings = ${sql.json({ automations: { receiverBrief: true } })} where id = ${rid}`;
    await processDailyExpectations(job({ restaurantId: rid, forDate: TUE_0600 }));
    expect(await rows()).toHaveLength(1);
  });
});
