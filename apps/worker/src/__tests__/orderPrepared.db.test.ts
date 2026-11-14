import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import { processOrderReminders } from '../jobs/orderReminders';
import type { WorkerJob } from '../queue';

/**
 * W3-09 / AU-11 at the 09:00 order-reminders run (fixed Israel clock):
 *  - prepared draft + ONE message per supplier per person, replacing the A5 line;
 *  - option off → A5 exactly as before, no draft;
 *  - an early cut-off (07:30) → tomorrow's draft today when tomorrow is an order day;
 *  - a failed send in the last 48 h → a notice to its sender;
 *  - never a row to a supplier target, never ₪.
 */
process.env.DATABASE_URL ??= testDbUrl();
process.env.APP_BASE_URL = 'https://app.example.test';

const sql = queueSql(testDbUrl());
const job = <T>(data: T): WorkerJob<T> => ({ id: 'test', name: 'test', data, attemptsMade: 0, opts: { attempts: 1 } });
const TAG = `au11-prepared-${process.pid}`;
// Sun 25.10 09:00 IL (IST, UTC+2) = 07:00Z.
const SLOT = '2026-10-25T07:00:00Z';

let rid = '';
let sid = '';
let earlySid = '';
let pid = '';
const uids: Record<string, string> = {};

async function setOption(automations: Record<string, boolean>) {
  await sql`update restaurants set settings = ${sql.json({ automations })} where id = ${rid}`;
}

/** Three placed POs over the last weeks → a guide with 2 rows (tomatoes, onions). */
async function guide(supplierId: string) {
  for (const daysAgo of [21, 14, 7]) {
    const at = new Date(new Date(SLOT).getTime() - daysAgo * 86_400_000).toISOString();
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, status, source, created_at, sent_at, created_by)
      values (${rid}, ${supplierId}, 'sent', 'manual', ${at}, ${at}, ${uids.chef!}) returning id`;
    await sql`insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
              values (${po!.id}, ${pid}, 'עגבניות', 10, 'kg', 8.5), (${po!.id}, null, 'בצל', 3, 'kg', 4)`;
  }
}

const rows = () =>
  sql<{ target: string; subject: string | null; body: string; dedupe_key: string; related_entity_type: string | null }[]>`
    select target, subject, body, dedupe_key, related_entity_type from notifications_outbox where restaurant_id = ${rid} order by dedupe_key, target`;

beforeAll(async () => {
  const [r] = await sql<{ id: string }[]>`insert into restaurants (name) values (${TAG}) returning id`;
  rid = r!.id;
  for (const role of ['owner', 'manager', 'chef', 'receiver']) {
    const [u] = await sql<{ id: string }[]>`insert into users (email, name) values (${`${TAG}-${role}@example.test`}, ${role}) returning id`;
    uids[role] = u!.id;
    await sql`insert into memberships (user_id, restaurant_id, role) values (${u!.id}, ${rid}, ${role})`;
  }
  const sunday = { windows: [{ orderDays: [0], cutoff: '14:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }] };
  const [s] = await sql<{ id: string }[]>`
    insert into suppliers (restaurant_id, name, active, order_schedule) values (${rid}, 'תנובה', true, ${sql.json(sunday)}) returning id`;
  sid = s!.id;
  // Orders on Monday with a 07:30 cut-off → its draft must be ready at Sunday's 09:00.
  const monday = { windows: [{ orderDays: [1], cutoff: '07:30', fulfillment: { kind: 'lead_days', leadDays: 1 } }] };
  const [e] = await sql<{ id: string }[]>`
    insert into suppliers (restaurant_id, name, active, order_schedule) values (${rid}, 'שטראוס', true, ${sql.json(monday)}) returning id`;
  earlySid = e!.id;
  const [p] = await sql<{ id: string }[]>`
    insert into products (restaurant_id, canonical_name, category, default_unit) values (${rid}, 'עגבניה', 'ירקות', 'kg') returning id`;
  pid = p!.id;
});

beforeEach(async () => {
  await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
  await sql`delete from audit_log where restaurant_id = ${rid}`;
  await sql`delete from goods_receipts where restaurant_id = ${rid}`;
  await sql`delete from purchase_orders where restaurant_id = ${rid}`;
  await setOption({});
});

afterAll(async () => {
  if (rid) {
    await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
    await sql`delete from audit_log where restaurant_id = ${rid}`;
    await sql`delete from purchase_orders where restaurant_id = ${rid}`;
    await sql`delete from products where restaurant_id = ${rid}`;
    await sql`delete from suppliers where restaurant_id = ${rid}`;
    await sql`delete from memberships where restaurant_id = ${rid}`;
    await sql`delete from restaurants where id = ${rid}`;
  }
  for (const u of Object.values(uids)) await sql`delete from users where id = ${u}`;
});

describe('09:00 prepared drafts (AU-11 a)', () => {
  it('option off (default) → AU-04 A5 lines only, no prepared draft', async () => {
    await guide(sid);
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const drafts = await sql`select id from purchase_orders where restaurant_id = ${rid} and source = 'recurring'`;
    expect(drafts).toHaveLength(0);
    const out = await rows();
    expect(out.every((o) => o.dedupe_key.startsWith('au:A5:'))).toBe(true);
    expect(out).toHaveLength(3); // owner, manager, chef
  });

  it('option on → one draft; one "טיוטה מוכנה" message per orderer instead of A5; a re-run adds nothing', async () => {
    await guide(sid);
    await setOption({ preparedOrderDraft: true });
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const drafts = await sql<{ id: string; source_ref: string; created_by: string | null }[]>`
      select id, source_ref, created_by from purchase_orders where restaurant_id = ${rid} and supplier_id = ${sid} and status = 'draft'`;
    expect(drafts).toEqual([{ id: drafts[0]!.id, source_ref: `au:A16:${sid}:2026-10-25`, created_by: null }]);
    const out = await rows();
    const forSupplier = out.filter((o) => o.dedupe_key.includes(sid));
    expect(forSupplier.map((o) => o.dedupe_key.split(':')[1])).toEqual(['A16', 'A16', 'A16']); // never an A5 line for it
    expect(forSupplier.map((o) => o.target.split('-').pop()).sort()).toEqual(['chef@example.test', 'manager@example.test', 'owner@example.test']);
    for (const o of forSupplier) {
      expect(o.subject).toBe('טיוטה מוכנה לתנובה · 2 פריטים · השליחה עד 14:00');
      expect(o.body).toContain(`/dashboard/go?r=${rid}`);
      expect(o.body).not.toMatch(/₪|\d+\.\d{2}(?!\d)/);
    }
    // No row ever goes to a supplier.
    expect(out.some((o) => o.related_entity_type === 'supplier' && o.dedupe_key.startsWith('po:'))).toBe(false);

    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect(await rows()).toHaveLength(out.length);
    expect(await sql`select id from purchase_orders where restaurant_id = ${rid} and source = 'recurring'`).toHaveLength(drafts.length); // the early supplier has no guide here → no draft
  });

  it("an early cut-off (07:30 on Monday) → tomorrow's draft at Sunday's 09:00, named for tomorrow", async () => {
    await guide(earlySid);
    await setOption({ preparedOrderDraft: true });
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const [d] = await sql<{ source_ref: string }[]>`
      select source_ref from purchase_orders where restaurant_id = ${rid} and supplier_id = ${earlySid} and status = 'draft'`;
    expect(d!.source_ref).toBe(`au:A16:${earlySid}:2026-10-26`);
    const msgs = (await rows()).filter((o) => o.dedupe_key.includes(earlySid));
    expect(msgs).toHaveLength(3);
    expect(msgs[0]!.subject).toBe('טיוטה מוכנה למחר לשטראוס · 2 פריטים · השליחה עד 07:30');
  });

  it('a supplier already ordered today → no draft, no message', async () => {
    await guide(sid);
    await setOption({ preparedOrderDraft: true });
    await sql`insert into purchase_orders (restaurant_id, supplier_id, status, source, created_at, sent_at)
              values (${rid}, ${sid}, 'sent', 'manual', '2026-10-25T05:00:00Z', '2026-10-25T05:00:00Z')`;
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect(await sql`select id from purchase_orders where restaurant_id = ${rid} and supplier_id = ${sid} and status = 'draft'`).toHaveLength(0);
    expect((await rows()).filter((o) => o.dedupe_key.includes(sid))).toHaveLength(0);
  });
});

describe('09:00 failed-send rescue (AU-11 c)', () => {
  it("an order whose send had no provider → one notice to its sender; option off → none", async () => {
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, status, source, created_at, sent_at, created_by)
      values (${rid}, ${sid}, 'sent', 'manual', '2026-10-24T10:00:00Z', '2026-10-24T10:00:00Z', ${uids.chef!}) returning id`;
    await sql`insert into notifications_outbox (restaurant_id, channel, target, body, status, last_error, related_entity_type, related_entity_id, dedupe_key)
              values (${rid}, 'email', 'supplier@example.test', 'order', 'failed', 'skipped_no_provider', 'purchase_order', ${po!.id}, ${`po:${po!.id}:placed`})`;
    await setOption({ sendRescue: false });
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect((await rows()).filter((o) => o.dedupe_key.startsWith('au:A16c:'))).toHaveLength(0);

    await setOption({});
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const notices = (await rows()).filter((o) => o.dedupe_key.startsWith('au:A16c:'));
    expect(notices.map((o) => o.target)).toEqual([`${TAG}-chef@example.test`]);
    expect(notices[0]!.subject).toBe('ההזמנה לתנובה לא נשלחה · שלחו מהוואטסאפ שלכם בלחיצה');
    expect(notices[0]!.body).not.toMatch(/₪/);
  });
});

describe('early cut-off, daily supplier (review fixes)', () => {
  let dailySid = '';
  beforeAll(async () => {
    const daily = { windows: [{ orderDays: [0, 1, 2, 3, 4, 5, 6], cutoff: '08:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }] };
    const [d] = await sql<{ id: string }[]>`
      insert into suppliers (restaurant_id, name, active, order_schedule) values (${rid}, 'מאפייה', true, ${sql.json(daily)}) returning id`;
    dailySid = d!.id;
  });

  it("today's cut-off passed: today's A5 line stays, and tomorrow's draft is announced on top (never instead)", async () => {
    await guide(dailySid);
    await setOption({ preparedOrderDraft: true });
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const msgs = (await rows()).filter((o) => o.dedupe_key.includes(dailySid));
    const kinds = msgs.map((o) => o.dedupe_key.split(':')[1]).sort();
    expect(kinds).toEqual(['A16', 'A16', 'A16', 'A5', 'A5', 'A5']);
    expect(msgs.filter((o) => o.dedupe_key.startsWith('au:A16:')).every((o) => o.dedupe_key.endsWith(':2026-10-26'))).toBe(true);
    const drafts = await sql<{ source_ref: string }[]>`
      select source_ref from purchase_orders where restaurant_id = ${rid} and supplier_id = ${dailySid} and status = 'draft'`;
    expect(drafts.map((d) => d.source_ref)).toEqual([`au:A16:${dailySid}:2026-10-26`]);
  });

  it("today's prepared draft was already sent yesterday → today's order, no A5 nag and no new draft", async () => {
    await guide(dailySid);
    await setOption({ preparedOrderDraft: true });
    await sql`insert into purchase_orders (restaurant_id, supplier_id, status, source, source_ref, created_at, sent_at)
              values (${rid}, ${dailySid}, 'sent', 'recurring', ${`au:A16:${dailySid}:2026-10-25`}, '2026-10-24T07:00:00Z', '2026-10-24T12:00:00Z')`;
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    const msgs = (await rows()).filter((o) => o.dedupe_key.includes(dailySid));
    expect(msgs.some((o) => o.dedupe_key.startsWith('au:A5:'))).toBe(false);
  });

  it('an order already placed today after the cut-off (for tomorrow) → no duplicate tomorrow draft', async () => {
    await guide(dailySid);
    await setOption({ preparedOrderDraft: true });
    // 08:30 IL today = after today's 08:00 cut-off → it is tomorrow's order.
    await sql`insert into purchase_orders (restaurant_id, supplier_id, status, source, created_at, sent_at)
              values (${rid}, ${dailySid}, 'sent', 'manual', '2026-10-25T06:30:00Z', '2026-10-25T06:30:00Z')`;
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT }));
    expect(await sql`select id from purchase_orders where restaurant_id = ${rid} and supplier_id = ${dailySid} and status = 'draft'`).toHaveLength(0);
  });
});
