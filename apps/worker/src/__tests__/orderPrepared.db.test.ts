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
    expect(msgs.filter((o) => o.dedupe_key.startsWith('au:A16:')).every((o) => o.dedupe_key.startsWith('au:A16:2026-10-26:'))).toBe(true);
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

describe("tomorrow's notice is held, not dropped; a re-run never adds A5 (orchestrator review 28.11)", () => {
  let sunEarlySid = '';
  let friEarlySid = '';
  let tenAmSid = '';
  beforeAll(async () => {
    const mk = async (name: string, orderDays: number[], cutoff: string) => {
      const sched = { windows: [{ orderDays, cutoff, fulfillment: { kind: 'lead_days', leadDays: 1 } }] };
      const [s] = await sql<{ id: string }[]>`
        insert into suppliers (restaurant_id, name, active, order_schedule) values (${rid}, ${name}, true, ${sql.json(sched)}) returning id`;
      return s!.id;
    };
    sunEarlySid = await mk('ירקן ראשון', [0], '07:30');
    friEarlySid = await mk('דגים ראשון', [0], '07:30');
    tenAmSid = await mk('חלב עשר', [0], '10:00');
  });

  const queued = (supplierId: string) =>
    sql<{ dedupe_key: string; status: string; scheduled_at: Date | null }[]>`
      select dedupe_key, status, scheduled_at from notifications_outbox
      where restaurant_id = ${rid} and dedupe_key like ${'au:A16:%'} and dedupe_key like ${`%:${supplierId}:%`}`;

  it("Saturday 09:00, Sunday 07:30 cut-off: one notice per orderer, held to after Shabbat, before the cut-off", async () => {
    await guide(sunEarlySid);
    await setOption({ preparedOrderDraft: true });
    // Sat 24.10 09:00 IL (IDT, UTC+3) = 06:00Z; Sunday's cut-off 07:30 IL (IST, UTC+2) = Sun 05:30Z.
    await processOrderReminders(job({ restaurantId: rid, forDate: '2026-10-24T06:00:00Z' }));
    const rows = await queued(sunEarlySid);
    expect(rows).toHaveLength(3);
    const deadline = new Date('2026-10-25T05:30:00Z').getTime();
    for (const r of rows) {
      expect(r.dedupe_key.startsWith('au:A16:2026-10-25:')).toBe(true);
      expect(r.status).toBe('queued');
      // held to Shabbat's end, Sat 19:00 IL (IDT) = 16:00Z, still before the cut-off
      expect(new Date(r.scheduled_at!).toISOString()).toBe('2026-10-24T16:00:00.000Z');
      expect(new Date(r.scheduled_at!).getTime()).toBeLessThan(deadline);
    }
  });

  it('a person at the daily cap: moved to Sun 06:00, before a 07:30 cut-off → queued, not cancelled', async () => {
    await guide(friEarlySid);
    await setOption({ preparedOrderDraft: true });
    // Sat 31.10 19:30 IL (IST, UTC+2) = 17:30Z, after Shabbat. Six alerts already today for the chef.
    for (let i = 0; i < 6; i++) {
      await sql`insert into notifications_outbox (restaurant_id, channel, target, body, status, payload, dedupe_key)
                values (${rid}, 'email', ${`${TAG}-chef@example.test`}, 'x', 'sent', ${sql.json({ userId: uids.chef! })}, ${`cap-${i}-${process.pid}`})`;
    }
    await processOrderReminders(job({ restaurantId: rid, forDate: '2026-10-31T17:30:00Z' }));
    const rows = await queued(friEarlySid);
    expect(rows.length).toBe(3);
    const chef = rows.find((r) => r.dedupe_key.includes(uids.chef!));
    expect(chef).toBeDefined();
    expect(chef!.status).toBe('queued');
    // Sun 01.11 06:00 IL (IST) = 04:00Z, before the 07:30 cut-off (05:30Z)
    expect(new Date(chef!.scheduled_at!).toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });

  it('a re-run after the cut-off (10:00, re-run 10:30) sends no A5 on top of the "טיוטה מוכנה" notice', async () => {
    await guide(tenAmSid);
    await setOption({ preparedOrderDraft: true });
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT })); // Sun 09:00 IL
    expect((await queued(tenAmSid)).length).toBe(3);
    await processOrderReminders(job({ restaurantId: rid, forDate: '2026-10-25T08:30:00Z' })); // Sun 10:30 IL
    const a5 = (await rows()).filter((o) => o.dedupe_key.startsWith('au:A5:') && o.dedupe_key.includes(tenAmSid));
    expect(a5).toEqual([]);
  });
});

describe("yesterday's notice never hides today's A5; tomorrow's deadline is IL wall time (orchestrator review 28.11 #2)", () => {
  const made: Record<string, string> = {};
  beforeAll(async () => {
    const mk = async (key: string, name: string, orderDays: number[], cutoff: string) => {
      const sched = { windows: [{ orderDays, cutoff, fulfillment: { kind: 'lead_days', leadDays: 1 } }] };
      const [s] = await sql<{ id: string }[]>`
        insert into suppliers (restaurant_id, name, active, order_schedule) values (${rid}, ${name}, true, ${sql.json(sched)}) returning id`;
      made[key] = s!.id;
    };
    await mk('daily', 'ירקן יומי', [0, 1, 2, 3, 4, 5, 6], '08:00');
    await mk('p5', 'מאפייה חמש', [0], '05:00');
    await mk('dst', 'ביצים שש וחצי', [0], '06:30');
  });
  /** Only this supplier is active, so no other supplier's rows reach the daily cap. */
  const only = (id: string) => sql`update suppliers set active = (id = ${id}) where restaurant_id = ${rid}`;
  const a5For = async (supplierId: string, day: string) =>
    (await rows()).filter((o) => o.dedupe_key.startsWith(`au:A5:${day}:`) && o.dedupe_key.includes(`:${supplierId}:`));

  it('two days, daily 08:00 cut-off: Saturday prepares Sunday\'s draft, Sunday 09:00 still sends 3 A5 lines', async () => {
    await only(made.daily!);
    await guide(made.daily!);
    await setOption({ preparedOrderDraft: true });
    await processOrderReminders(job({ restaurantId: rid, forDate: '2026-10-24T06:00:00Z' })); // Sat 09:00 IL
    const [draft] = await sql<{ id: string }[]>`
      select id from purchase_orders where restaurant_id = ${rid} and status = 'draft' and source_ref = ${`au:A16:${made.daily}:2026-10-25`}`;
    expect(draft).toBeDefined();
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT })); // Sun 09:00 IL, past the 08:00 cut-off
    expect(await a5For(made.daily!, '2026-10-25')).toHaveLength(3);
  });

  it('Sunday 05:00 cut-off, chef at the cap on Saturday: the chef\'s A16 is cancelled and Sunday\'s A5 still reaches the chef', async () => {
    await only(made.p5!);
    await guide(made.p5!);
    await setOption({ preparedOrderDraft: true });
    for (let i = 0; i < 6; i++) {
      await sql`insert into notifications_outbox (restaurant_id, channel, target, body, status, payload, dedupe_key, created_at)
                values (${rid}, 'email', ${`${TAG}-chef@example.test`}, 'x', 'sent', ${sql.json({ userId: uids.chef! })}, ${`cap-p5-${i}-${process.pid}`}, '2026-10-24T10:00:00Z')`;
    }
    await processOrderReminders(job({ restaurantId: rid, forDate: '2026-10-24T06:00:00Z' })); // Sat 09:00 IL
    const a16 = await sql<{ dedupe_key: string; status: string }[]>`
      select dedupe_key, status from notifications_outbox where restaurant_id = ${rid} and dedupe_key like ${`au:A16:2026-10-25:%:${made.p5}:%`}`;
    expect(a16.find((r) => r.dedupe_key.includes(uids.chef!))?.status).toBe('cancelled'); // Sun 06:00 is after the 05:00 cut-off
    await processOrderReminders(job({ restaurantId: rid, forDate: SLOT })); // Sun 09:00 IL
    const a5 = await a5For(made.p5!, '2026-10-25');
    expect(a5).toHaveLength(3);
    expect(a5.some((r) => r.dedupe_key.includes(uids.chef!))).toBe(true);
  });

  it('DST weekend: Sat 23:30 IL, Sunday 06:30 cut-off (IST) → held to Sun 06:00, before the wall-clock cut-off, queued', async () => {
    await only(made.dst!);
    await guide(made.dst!);
    await setOption({ preparedOrderDraft: true });
    // Israel leaves DST on Sun 25.10 02:00. Sat 23:30 IDT = 20:30Z; Sun 06:00 IST = 04:00Z; the cut-off 06:30 IST = 04:30Z
    // (a fixed "IL midnight + 390 min" would say 03:30Z and drop the notice).
    await processOrderReminders(job({ restaurantId: rid, forDate: '2026-10-24T20:30:00Z' }));
    const r = await sql<{ status: string; scheduled_at: Date | null }[]>`
      select status, scheduled_at from notifications_outbox where restaurant_id = ${rid} and dedupe_key like ${`au:A16:2026-10-25:%:${made.dst}:%`}`;
    expect(r).toHaveLength(3);
    for (const x of r) {
      expect(x.status).toBe('queued');
      expect(new Date(x.scheduled_at!).toISOString()).toBe('2026-10-25T04:00:00.000Z');
    }
  });
});
