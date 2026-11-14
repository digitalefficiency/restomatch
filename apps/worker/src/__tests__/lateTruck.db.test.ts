import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import { processSupplierDelays } from '../jobs/supplierDelays';
import type { WorkerJob } from '../queue';

/**
 * AU-04 A6 · late trucks on chase days 1/3/7, through G-06 notify():
 *  - owner + manager get the late PO + a pre-addressed wa.me / mailto question
 *    to the supplier (or the "no contact" hint); NOTHING is sent to the supplier;
 *  - receivers hear it on day 1 only, with no ₪ and no supplier link;
 *  - the option turns it off; the old-format key on deploy day suppresses a repeat.
 */
process.env.DATABASE_URL ??= testDbUrl();
process.env.APP_BASE_URL = 'https://app.example.test';
const sql = queueSql(testDbUrl());
const job = <T>(data: T): WorkerJob<T> => ({ id: 't', name: 't', data, attemptsMade: 0, opts: { attempts: 1 } });
const TAG = `au04-a6-${process.pid}`;

// Expected Mon 2 Nov 2026 08:00 IST; the job runs at 10:00 IST (08:00Z).
const EXPECTED = '2026-11-02T06:00:00Z';
const dayRun = (d: number) => new Date(Date.UTC(2026, 10, 2 + d, 8, 0, 0)).toISOString();

let rid = '';
let sid = '';
let poId = '';
const uids: Record<string, string> = {};
const SUPPLIER_PHONE = '052-1234567';
const SUPPLIER_EMAIL = 'orders@tnuva.example';

async function rows() {
  return sql<{ target: string; body: string; html: string | null; automation: string | null }[]>`
    select target, body, payload->>'__html' as html, payload->>'automationId' as automation
    from notifications_outbox where restaurant_id = ${rid} order by target`;
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const [r] = await sql<{ id: string }[]>`insert into restaurants (name) values ('ציקטי בדיקה') returning id`;
  rid = r!.id;
  for (const role of ['owner', 'manager', 'receiver', 'chef']) {
    const [u] = await sql<{ id: string }[]>`insert into users (email, name) values (${`${TAG}-${role}@example.test`}, ${role}) returning id`;
    uids[role] = u!.id;
    await sql`insert into memberships (user_id, restaurant_id, role) values (${u!.id}, ${rid}, ${role})`;
  }
  const [s] = await sql<{ id: string }[]>`
    insert into suppliers (restaurant_id, name, contact_whatsapp, contact_email)
    values (${rid}, 'תנובה', ${SUPPLIER_PHONE}, ${SUPPLIER_EMAIL}) returning id`;
  sid = s!.id;
});

beforeEach(async () => {
  await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
  await sql`delete from purchase_orders where restaurant_id = ${rid}`;
  await sql`update restaurants set settings = '{}'::jsonb where id = ${rid}`;
  await sql`update suppliers set contact_whatsapp = ${SUPPLIER_PHONE}, contact_email = ${SUPPLIER_EMAIL} where id = ${sid}`;
  const [p] = await sql<{ id: string }[]>`
    insert into purchase_orders (restaurant_id, supplier_id, status, expected_delivery_at, customer_ref)
    values (${rid}, ${sid}, 'sent', ${EXPECTED}, '4471') returning id`;
  poId = p!.id;
});

afterAll(async () => {
  if (rid) {
    await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
    await sql`delete from purchase_orders where restaurant_id = ${rid}`;
    await sql`delete from suppliers where restaurant_id = ${rid}`;
    await sql`delete from memberships where restaurant_id = ${rid}`;
    await sql`delete from restaurants where id = ${rid}`;
  }
  for (const u of Object.values(uids)) await sql`delete from users where id = ${u}`;
});

describe('A6 late truck (DB)', () => {
  it('day 1: owner + manager get pre-addressed supplier drafts; the receiver gets the plain notice; chef nothing', async () => {
    await processSupplierDelays(job({ restaurantId: rid, forDate: dayRun(1) }));
    const out = await rows();
    expect(out.map((o) => o.target.split('-').pop())).toEqual([
      'manager@example.test',
      'owner@example.test',
      'receiver@example.test',
    ]);
    const q = 'שלום תנובה, ההזמנה 4471 שתוכננה ל-02.11 עדיין לא הגיעה. מתי צפוי המשלוח? תודה, ציקטי בדיקה';
    for (const o of out.filter((x) => !x.target.includes('receiver'))) {
      expect(o.body).toContain('שלחו לספק:');
      expect(o.body).toContain(`https://wa.me/972521234567?text=${encodeURIComponent(q)}`);
      expect(o.body).toContain('mailto:orders@tnuva.example?subject=');
      expect(o.automation).toBe('A6');
    }
    const recv = out.find((x) => x.target.includes('receiver'))!;
    expect(recv.body).toContain('ההנהלה מטפלת מול הספק.');
    expect(`${recv.body}${recv.html ?? ''}`).not.toMatch(/wa\.me|mailto:|₪/);
  });

  it('nothing is ever addressed to the supplier', async () => {
    for (const d of [1, 3, 7]) await processSupplierDelays(job({ restaurantId: rid, forDate: dayRun(d) }));
    const out = await rows();
    expect(out.length).toBeGreaterThan(0);
    for (const o of out) {
      expect(o.target).not.toBe(SUPPLIER_EMAIL);
      expect(o.target.replace(/\D/g, '')).not.toContain('521234567');
    }
  });

  it('day 3: managers only (no receiver notice)', async () => {
    await processSupplierDelays(job({ restaurantId: rid, forDate: dayRun(3) }));
    expect((await rows()).map((o) => o.target.split('-').pop())).toEqual(['manager@example.test', 'owner@example.test']);
  });

  it('missing supplier contact → the hint, no link', async () => {
    await sql`update suppliers set contact_whatsapp = null, contact_email = null where id = ${sid}`;
    await processSupplierDelays(job({ restaurantId: rid, forDate: dayRun(1) }));
    const mgr = (await rows()).find((o) => o.target.includes('manager'))!;
    expect(mgr.body).toContain('אין פרטי קשר לספק · הוסיפו בכרטיס הספק');
    expect(mgr.body).not.toMatch(/wa\.me|mailto:/);
  });

  it('option off → nothing', async () => {
    await sql`update restaurants set settings = ${sql.json({ automations: { supplierDelays: false } })} where id = ${rid}`;
    await processSupplierDelays(job({ restaurantId: rid, forDate: dayRun(1) }));
    expect(await rows()).toHaveLength(0);
  });

  it('deploy day: the step already sent under the old key → nothing new for that PO and step', async () => {
    await sql`insert into notifications_outbox (restaurant_id, channel, target, body, status, dedupe_key)
              values (${rid}, 'email', ${`${TAG}-manager@example.test`}, 'old', 'sent', ${`po:${poId}:late:d1:${TAG}-manager@example.test`})`;
    await processSupplierDelays(job({ restaurantId: rid, forDate: dayRun(1) }));
    expect(await rows()).toHaveLength(1);
  });
});
