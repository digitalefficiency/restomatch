import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  createDb,
  eq,
  inArray,
  invoices,
  memberships,
  notificationsOutbox,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
  users,
  type UserRole,
} from '@restomatch/db';
import { failAndHandOff, finalAttempt } from '../jobs/ocrInvoice';

/**
 * G-06: a terminal OCR failure reaches the uploader (no ₪) and the managers
 * (with supplier and file) through notify() — once — instead of sitting in
 * `parsed` until someone browses.
 */
const db = createDb(testDbUrl());
const TAG = 'ocr-handoff';
let restaurantId = '';
let otherId = '';
let supplierId = '';
const u: Record<string, string> = {};

async function cleanup() {
  for (const id of [restaurantId, otherId].filter(Boolean)) {
    await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, id));
    await db.delete(invoices).where(eq(invoices.restaurantId, id));
    await db.delete(suppliers).where(eq(suppliers.restaurantId, id));
    await db.delete(memberships).where(eq(memberships.restaurantId, id));
    await db.delete(restaurants).where(eq(restaurants.id, id));
  }
  await db.delete(users).where(sql`${users.email} like ${`%@${TAG}.test`}`);
}

async function member(rid: string, tag: string, role: UserRole) {
  const [x] = await db.insert(users).values({ email: `${tag}@${TAG}.test`, name: tag }).returning();
  await db.insert(memberships).values({ userId: x!.id, restaurantId: rid, role });
  u[tag] = x!.id;
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'OCR hand-off' }).returning();
  const [o] = await db.insert(restaurants).values({ name: 'Other tenant' }).returning();
  restaurantId = r!.id;
  otherId = o!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'ירקות הכרם' }).returning();
  supplierId = s!.id;
  await member(restaurantId, 'owner', 'owner');
  await member(restaurantId, 'manager', 'manager');
  await member(restaurantId, 'receiver', 'receiver');
  await member(otherId, 'foreign', 'manager');
});
afterAll(cleanup);

async function newInvoice(status: 'ocr_pending' | 'matched' = 'ocr_pending') {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId,
      supplierId,
      status,
      source: 'photo',
      createdBy: u.receiver,
      rawImageUrl: 'https://x.test/invoice-scans/gr-1.jpg',
      totalInclVat: '1180.00',
    })
    .returning();
  return inv!.id;
}

const outbox = () =>
  db
    .select()
    .from(notificationsOutbox)
    .where(inArray(notificationsOutbox.restaurantId, [restaurantId, otherId]));

describe('OCR failure hand-off (G-06)', () => {
  it('final-attempt failure → parsed + ocrFailed, uploader + managers enqueued once, uploader body without ₪', async () => {
    const id = await newInvoice();
    const res = await failAndHandOff(db, restaurantId, id, new Error('ZodError'), 3);
    expect(res).toEqual({ updated: true, reason: 'extraction_failed' });

    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
    expect(inv!.status).toBe('parsed');
    expect(inv!.ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'extraction_failed' });

    const rows = await outbox();
    const byUser = new Map(rows.map((r) => [(r.payload as Record<string, unknown>).userId as string, r]));
    expect(rows).toHaveLength(3); // uploader (receiver), owner, manager — e-mail only (no verified phones yet)
    expect([...byUser.keys()].sort()).toEqual([u.owner, u.manager, u.receiver].sort());
    for (const r of rows) {
      expect(r.channel).toBe('email');
      expect(r.target.startsWith('role:')).toBe(false);
      expect(r.status).toBe('queued');
      expect(r.relatedEntityId).toBe(id);
      expect((r.payload as Record<string, unknown>).event).toBe('invoice.ocr_failed');
      expect((r.payload as Record<string, unknown>).invoiceId).toBe(id);
    }
    const uploader = byUser.get(u.receiver!)!;
    expect(uploader.body).not.toMatch(/₪|1,?180/);
    expect(byUser.get(u.manager!)!.body).toContain('ירקות הכרם');
    expect(byUser.get(u.manager!)!.body).toContain('gr-1.jpg');
    // W2-13's branded template with an absolute link per audience (payload.__html is what the dispatcher sends).
    const html = (r: (typeof rows)[number]) => (r.payload as Record<string, unknown>).__html as string;
    for (const who of [u.owner!, u.manager!]) {
      expect(html(byUser.get(who)!)).toMatch(new RegExp(`https?://[^"]+/dashboard/invoices/${id}`));
    }
    expect(html(uploader)).toMatch(/https?:\/\/[^"]+\/dashboard\/receiving/);
    expect(html(uploader)).not.toContain(`/dashboard/invoices/${id}`);
    expect((uploader.payload as Record<string, unknown>).deepLink).toBe('/dashboard/receiving');
    expect(rows.some((r) => r.restaurantId === otherId)).toBe(false);
  });

  it('a replay (already failed) creates no second notice', async () => {
    const id = await newInvoice();
    await failAndHandOff(db, restaurantId, id, new Error('x'), 3);
    const again = await failAndHandOff(db, restaurantId, id, new Error('x'), 3);
    expect(again.updated).toBe(false);
    expect(await outbox()).toHaveLength(3);
  });

  it('an invoice that already left ocr_pending is neither changed nor announced', async () => {
    const id = await newInvoice('matched');
    expect((await failAndHandOff(db, restaurantId, id, new Error('late'), 3)).updated).toBe(false);
    const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, id)));
    expect(inv!.status).toBe('matched');
    expect(await outbox()).toHaveLength(0);
  });

  it('a foreign invoice id (another tenant) is neither changed nor announced', async () => {
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId: otherId, status: 'ocr_pending', source: 'photo', rawImageUrl: 'https://x.test/b.jpg' })
      .returning();
    const res = await failAndHandOff(db, restaurantId, inv!.id, new Error('x'), 3);
    expect(res.updated).toBe(false);
    const [row] = await db.select().from(invoices).where(eq(invoices.id, inv!.id));
    expect(row!.status).toBe('ocr_pending');
    expect(await outbox()).toHaveLength(0);
  });

  it('only the final attempt hands off; a non-final attempt does nothing', () => {
    expect(finalAttempt({ attemptsMade: 0, opts: { attempts: 3 } })).toBeNull();
    expect(finalAttempt({ attemptsMade: 1, opts: { attempts: 3 } })).toBeNull();
    expect(finalAttempt({ attemptsMade: 2, opts: { attempts: 3 } })).toBe(3);
    expect(finalAttempt({})).toBe(1);
    // A terminal error (classifyOcrError retryable=false) is final at once: no second paid call.
    expect(finalAttempt({ attemptsMade: 0, opts: { attempts: 3 } }, false)).toBe(1);
  });
});
