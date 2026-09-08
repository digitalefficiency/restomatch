import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accounts,
  createDb,
  dsrRequests,
  eq,
  leads,
  memberships,
  sessions,
  users,
  verificationTokens,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedTenant } from './fixtures';

const url = testDbUrl();
const db = createDb(url);

/** Authed caller for a given user — db doubles as the owner/admin connection. */
function userCaller(userId: string) {
  const ctx: AppContext = {
    db,
    adminDb: db,
    session: { userId, restaurantId: null, role: null },
  };
  return appRouter.createCaller(ctx);
}

async function cleanup() {
  await db.delete(dsrRequests);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verificationTokens);
  await db.delete(leads);
  await resetDb(db);
}

describe('dsr.exportMyData', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('returns the caller user, memberships, matching leads and activity, and audits the export', async () => {
    const t = await seedTenant(db, 'A');
    const [owner] = await db.select().from(users).where(eq(users.id, t.ownerUserId));
    // A marketing lead under the same email should surface in the export.
    await db.insert(leads).values({ name: 'בעל המסעדה', email: owner!.email, source: 'landing' });

    const res = await userCaller(t.ownerUserId).dsr.exportMyData();

    expect(res.subject).toBe('user');
    expect(res.user.id).toBe(t.ownerUserId);
    expect(res.memberships.map((m) => m.restaurantId)).toContain(t.restaurantId);
    expect(res.leads.length).toBe(1);
    // seedTenant writes one audit row authored by the owner.
    expect(res.activity.length).toBeGreaterThanOrEqual(1);

    const audit = await db
      .select()
      .from(dsrRequests)
      .where(eq(dsrRequests.subjectId, t.ownerUserId));
    expect(audit.some((r) => r.action === 'export')).toBe(true);
  });
});

describe('dsr.deleteMyAccount', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('anonymizes the identity row and drops mailbox/session rows, with an audit trail', async () => {
    const t = await seedTenant(db, 'A'); // solo owner — no other members
    // Seed a live session + verification token to prove they are erased.
    await db
      .insert(sessions)
      .values({ sessionToken: 'sess-A', userId: t.ownerUserId, expires: new Date(Date.now() + 1e6) });
    const [owner] = await db.select().from(users).where(eq(users.id, t.ownerUserId));
    await db
      .insert(verificationTokens)
      .values({ identifier: owner!.email, token: 'vt-A', expires: new Date(Date.now() + 1e6) });

    const res = await userCaller(t.ownerUserId).dsr.deleteMyAccount({ confirm: true });
    expect(res.ok).toBe(true);

    const [after] = await db.select().from(users).where(eq(users.id, t.ownerUserId));
    expect(after!.email).toMatch(/^deleted\+/);
    expect(after!.name).toBeNull();
    expect(after!.phone).toBeNull();

    expect(await db.select().from(sessions).where(eq(sessions.userId, t.ownerUserId))).toHaveLength(
      0,
    );
    const audit = await db
      .select()
      .from(dsrRequests)
      .where(eq(dsrRequests.subjectId, t.ownerUserId));
    expect(audit.some((r) => r.action === 'delete')).toBe(true);
  });

  it('refuses when the caller is the sole owner of a restaurant that has other members', async () => {
    const t = await seedTenant(db, 'A');
    // Add a second, non-owner member so the tenant would be orphaned.
    const [other] = await db
      .insert(users)
      .values({ email: 'member-A@dsr.test', emailVerified: new Date() })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: other!.id, restaurantId: t.restaurantId, role: 'receiver' });

    await expect(
      userCaller(t.ownerUserId).dsr.deleteMyAccount({ confirm: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // The identity row must remain untouched.
    const [still] = await db.select().from(users).where(eq(users.id, t.ownerUserId));
    expect(still!.email).not.toMatch(/^deleted\+/);
  });
});

describe('dsr.eraseLead (admin only)', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('lets a platform admin erase a lead and audits it', async () => {
    const [admin] = await db
      .insert(users)
      .values({ email: 'admin@dsr.test', emailVerified: new Date(), isPlatformAdmin: true })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ name: 'ליד למחיקה', email: 'lead@dsr.test', source: 'landing' })
      .returning();

    const res = await userCaller(admin!.id).dsr.eraseLead({ leadId: lead!.id });
    expect(res.ok).toBe(true);
    expect(await db.select().from(leads).where(eq(leads.id, lead!.id))).toHaveLength(0);

    const audit = await db.select().from(dsrRequests).where(eq(dsrRequests.subjectId, lead!.id));
    expect(audit.some((r) => r.action === 'erase')).toBe(true);
  });

  it('forbids a non-admin from erasing a lead', async () => {
    const [member] = await db
      .insert(users)
      .values({ email: 'plain@dsr.test', emailVerified: new Date() })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ name: 'ליד', email: 'x@dsr.test', source: 'landing' })
      .returning();

    await expect(
      userCaller(member!.id).dsr.eraseLead({ leadId: lead!.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Still present.
    expect(await db.select().from(leads).where(eq(leads.id, lead!.id))).toHaveLength(1);
  });
});
