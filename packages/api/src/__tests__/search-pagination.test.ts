import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityEvents, createDb } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const db = createDb(url);

let A: Tenant;

function callerFor(tenant: Tenant) {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role: 'owner' };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

describe('search.global', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('finds suppliers, products and invoices by fuzzy query', async () => {
    const caller = callerFor(A);
    const out = await caller.search.global({ q: 'ספק' });
    expect(out.suppliers.map((s) => s.name)).toContain(A.supplierName);

    const prod = await caller.search.global({ q: 'עגבני' }); // partial / typo-tolerant
    expect(prod.products.some((p) => p.canonicalName.includes('עגבניה'))).toBe(true);

    const inv = await caller.search.global({ q: 'INV-A' });
    expect(inv.invoices.map((i) => i.invoiceNumber)).toContain(A.invoiceNumber);
  });

  it('returns empty arrays for a non-matching query (still the object shape)', async () => {
    const out = await callerFor(A).search.global({ q: 'zzqqxx-nomatch' });
    expect(out).toMatchObject({ suppliers: [], products: [], invoices: [] });
  });

  it('rejects a sub-2-char query', async () => {
    await expect(callerFor(A).search.global({ q: 'a' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('pagination cursors (non-breaking: still arrays)', () => {
  let T: Tenant;

  beforeAll(async () => {
    await resetDb(db);
    T = await seedTenant(db, 'A');
    // Add extra activity events with controlled, strictly-decreasing timestamps.
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await db.insert(activityEvents).values({
        restaurantId: T.restaurantId,
        eventType: 'invoice_matched',
        title: `evt ${i}`,
        createdAt: new Date(base - i * 60_000),
      });
    }
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('activity.feed returns an array and honors limit', async () => {
    const feed = await callerFor(T).activity.feed({ limit: 2 });
    expect(Array.isArray(feed)).toBe(true);
    expect(feed).toHaveLength(2);
  });

  it('activity.feed cursor returns only rows older than the cursor (no overlap)', async () => {
    const caller = callerFor(T);
    const page1 = await caller.activity.feed({ limit: 3 });
    expect(page1).toHaveLength(3);
    const cursor = page1[page1.length - 1]!.createdAt.toISOString();
    const page2 = await caller.activity.feed({ limit: 3, cursor });
    const ids1 = new Set(page1.map((e) => e.id));
    // No row in page2 is in page1, and every page2 row is strictly older.
    for (const e of page2) {
      expect(ids1.has(e.id)).toBe(false);
      expect(e.createdAt.getTime()).toBeLessThan(page1[page1.length - 1]!.createdAt.getTime());
    }
  });

  it('activity.feed with no input still works (array)', async () => {
    const feed = await callerFor(T).activity.feed();
    expect(Array.isArray(feed)).toBe(true);
    expect(feed.length).toBeGreaterThan(0);
  });

  it('approvals.myQueue returns an array and honors a cursor', async () => {
    const caller = callerFor(T);
    const all = await caller.approvals.myQueue();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
    // Cursor at the newest row's createdAt excludes it (strictly older only).
    const newest = all[0]!.createdAt.toISOString();
    const older = await caller.approvals.myQueue({ cursor: newest });
    expect(older.some((d) => d.id === all[0]!.id)).toBe(false);
  });

  it('owner.suppliers returns an array and honors limit', async () => {
    // owner.suppliers is gated by advanced_analytics; trial fallback grants it.
    const cards = await callerFor(T).owner.suppliers({ limit: 1 });
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeLessThanOrEqual(1);
    // No-arg call still returns an array.
    const all = await callerFor(T).owner.suppliers();
    expect(Array.isArray(all)).toBe(true);
  });
});
