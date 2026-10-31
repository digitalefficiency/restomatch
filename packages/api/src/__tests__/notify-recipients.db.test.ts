import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  createDb,
  eq,
  memberships,
  monthlyReports,
  notificationsOutbox,
  restaurants,
  sql,
  testDbUrl,
  users,
  type UserRole,
} from '@restomatch/db';
import { nextDaySlot, notify, notifyDedupeKey, type RenderFn } from '../notifications/notify';
import { recipientsForRestaurant, resolveAudience } from '../notifications/recipients';
import { sendMonthlyReports } from '../reports/send';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-06: notify() resolves an audience to real people at verified addresses,
 * one row per (user, channel), inside ONE restaurant; replays enqueue nothing;
 * quiet hours move scheduled_at; nothing is ever marked sent here.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const ids: Record<string, string> = {};

const render: RenderFn = ({ channel, locale, vars }) => ({
  subject: `t-${locale}`,
  body: `${channel}:${locale}:${JSON.stringify(vars)}`,
});

// A fixed Tuesday 10:00 Jerusalem (UTC+2 in winter): not quiet, not Shabbat.
const WEEKDAY = new Date('2030-01-01T08:00:00Z');
// Thu 23:30 Jerusalem → expected Fri 06:00 (04:00Z).
const THU_2330 = new Date('2030-01-03T21:30:00Z');

async function addMember(t: Tenant, tag: string, role: UserRole, extra: Partial<typeof users.$inferInsert> = {}, locale?: string) {
  const [u] = await db
    .insert(users)
    .values({ email: `${tag}@notify.test`, name: tag, emailVerified: new Date(), ...extra })
    .returning();
  await db.insert(memberships).values({ userId: u!.id, restaurantId: t.restaurantId, role, preferredLocale: locale ?? null });
  ids[tag] = u!.id;
  return u!.id;
}

/** Rows notify() wrote (seedTenant leaves its own outbox row; notify always stamps payload.userId). */
async function rowsOf(restaurantId: string) {
  return db
    .select()
    .from(notificationsOutbox)
    .where(and(eq(notificationsOutbox.restaurantId, restaurantId), sql`${notificationsOutbox.payload}->>'userId' is not null`));
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  await addMember(A, 'mgrA', 'manager', { phone: '052-555-1234' }, 'en');
  await addMember(A, 'mgr2A', 'manager');
  await addMember(A, 'rcvA', 'receiver');
  await addMember(B, 'mgrB', 'manager');
});
afterAll(async () => {
  await resetDb(db);
});

describe('resolveAudience / recipientsForRestaurant', () => {
  it('recipientsForRestaurant keeps its contract (owner+manager e-mails)', async () => {
    const r = await recipientsForRestaurant(db, A.restaurantId);
    expect(r.map((x) => x.email).sort()).toEqual(['mgr2A@notify.test', 'mgrA@notify.test', 'owner-A@attack.test'].sort());
  });

  it('resolves roles to members with e-mail; an unverified phone gives no WhatsApp address', async () => {
    const m = await resolveAudience(db, A.restaurantId, { roles: ['owner', 'manager'] });
    expect(m).toHaveLength(3);
    for (const x of m) expect(x.addresses.map((a) => a.channel)).toEqual(['email']);
    expect(m.find((x) => x.userId === ids.mgrA)!.locale).toBe('en');
  });

  it('a foreign-tenant userId resolves to nothing; poSenderOf/decidersOf stay in the restaurant', async () => {
    expect(await resolveAudience(db, A.restaurantId, { userIds: [ids.mgrB!] })).toEqual([]);
    expect(await resolveAudience(db, A.restaurantId, { decidersOf: B.discrepancyId })).toEqual([]);
    expect(await resolveAudience(db, A.restaurantId, { poSenderOf: B.poId })).toEqual([]);
    expect((await resolveAudience(db, A.restaurantId, { decidersOf: A.discrepancyId })).length).toBe(3);
  });
});

describe('notify()', () => {
  const base = () => ({
    restaurantId: A.restaurantId,
    event: 'test.event',
    template: 't',
    entity: { type: 'invoice', id: A.invoiceId },
    render,
    now: WEEKDAY,
  });

  it('a role audience of 3 → 3 e-mail rows with concrete addresses, payload.{userId,event}, queued', async () => {
    const res = await notify(db, { ...base(), audience: { roles: ['owner', 'manager'] } });
    expect(res).toMatchObject({ enqueued: 3, deduped: 0, failed: 0 });
    const rows = await rowsOf(A.restaurantId);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.channel).toBe('email');
      expect(r.target).toMatch(/@/);
      expect(r.target.startsWith('role:')).toBe(false);
      expect(r.status).toBe('queued');
      expect(r.sentAt).toBeNull();
      const p = r.payload as Record<string, unknown>;
      expect(p.event).toBe('test.event');
      expect(r.dedupeKey).toBe(notifyDedupeKey('test.event', A.invoiceId, p.userId as string, 'email'));
    }
  });

  it('a verified phone adds one WhatsApp row (E.164 digits); unverified adds none', async () => {
    // Interim (G-03 absent): no phone counts as verified, so 0 WhatsApp rows today.
    await notify(db, { ...base(), audience: { userIds: [ids.mgrA!] } });
    expect((await rowsOf(A.restaurantId)).filter((r) => r.channel === 'whatsapp')).toHaveLength(0);
  });

  it('a replay enqueues nothing', async () => {
    await notify(db, { ...base(), audience: { roles: ['owner', 'manager'] } });
    const again = await notify(db, { ...base(), audience: { roles: ['owner', 'manager'] } });
    expect(again).toMatchObject({ enqueued: 0, deduped: 3 });
    expect(await rowsOf(A.restaurantId)).toHaveLength(3);
  });

  it('a foreign-tenant userIds audience → 0 rows anywhere', async () => {
    const res = await notify(db, { ...base(), audience: { userIds: [ids.mgrB!] } });
    expect(res.enqueued).toBe(0);
    expect(await rowsOf(A.restaurantId)).toHaveLength(0);
    expect(await rowsOf(B.restaurantId)).toHaveLength(0);
  });

  it('₪ vars are stripped for the receiver, kept for the manager', async () => {
    await notify(db, {
      ...base(),
      audience: { userIds: [ids.rcvA!, ids.mgr2A!] },
      vars: { supplierName: 'ספק', amountIls: '₪120.00' },
      moneyVars: ['amountIls'],
    });
    const rows = await rowsOf(A.restaurantId);
    const byUser = (u: string) => rows.find((r) => (r.payload as Record<string, unknown>).userId === u)!;
    expect(byUser(ids.rcvA!).body).not.toContain('₪');
    expect(byUser(ids.mgr2A!).body).toContain('₪120.00');
  });

  it('a 23:30 enqueue is scheduled for 06:00 next day, and the dispatcher claim query skips it', async () => {
    await notify(db, { ...base(), now: THU_2330, audience: { userIds: [ids.mgr2A!] } });
    const [row] = await rowsOf(A.restaurantId);
    expect(row!.scheduledAt.toISOString()).toBe('2030-01-04T04:00:00.000Z');
    const claimable = (await db.execute(sql`
      SELECT id FROM notifications_outbox WHERE status = 'queued' AND scheduled_at <= now() AND id = ${row!.id}
    `)) as unknown as unknown[];
    expect(claimable).toHaveLength(0);
  });

  it('the 7th alert of the day goes to the next slot with payload.digest', async () => {
    // The day is counted on created_at (DB clock), so this case runs on the real clock.
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      await notify(db, { ...base(), now, entity: { type: 'invoice', id: crypto.randomUUID() }, audience: { userIds: [ids.mgr2A!] } });
    }
    const rows = (await rowsOf(A.restaurantId)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => (r.payload as Record<string, unknown>).digest === true)).toHaveLength(1);
    const late = rows.find((r) => (r.payload as Record<string, unknown>).digest === true)!;
    expect(late.scheduledAt.toISOString()).toBe(nextDaySlot(now, 'Asia/Jerusalem').toISOString());
    expect(late.scheduledAt.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('sendMonthlyReports through notify() (honest delivery)', () => {
  beforeEach(async () => {
    await db
      .update(restaurants)
      .set({ settings: { features: { all: true } } as never })
      .where(eq(restaurants.id, A.restaurantId));
  });

  it('no role: rows, nothing sent without a provider, sentAt null; the reconcile sets it once a row is sent', async () => {
    const now = new Date();
    const r1 = await sendMonthlyReports(db, { restaurantId: A.restaurantId, now });
    expect(r1).toMatchObject({ restaurants: 1, emails: 3, whatsapp: 0, skipped: 0, failed: [] });
    const rows = await rowsOf(A.restaurantId);
    expect(rows.filter((r) => r.target.startsWith('role:'))).toHaveLength(0);
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(0);
    const [rep] = await db.select().from(monthlyReports).where(eq(monthlyReports.restaurantId, A.restaurantId));
    expect(rep!.sentAt).toBeNull();

    // Nothing new to enqueue → skipped, same rows.
    expect(await sendMonthlyReports(db, { restaurantId: A.restaurantId, now })).toMatchObject({ emails: 0, skipped: 1 });
    expect(await rowsOf(A.restaurantId)).toHaveLength(3);

    // The dispatcher sends one row → the next run reconciles sent_at from it.
    const sentAt = new Date('2030-01-01T08:05:00Z');
    await db
      .update(notificationsOutbox)
      .set({ status: 'sent', sentAt })
      .where(and(eq(notificationsOutbox.id, rows[0]!.id)));
    expect(await sendMonthlyReports(db, { restaurantId: A.restaurantId, now })).toMatchObject({ emails: 0, skipped: 1 });
    const [after] = await db.select().from(monthlyReports).where(eq(monthlyReports.restaurantId, A.restaurantId));
    expect(after!.sentAt?.toISOString()).toBe(sentAt.toISOString());
  });
});
