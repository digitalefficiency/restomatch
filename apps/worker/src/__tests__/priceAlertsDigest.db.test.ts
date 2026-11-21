import { afterAll, describe, expect, it } from 'vitest';
import {
  createDb,
  inArray,
  memberships,
  notificationsOutbox,
  priceHistory,
  products,
  restaurants,
  suppliers,
  testDbUrl,
  users,
  type RestaurantSettings,
} from '@restomatch/db';
import { processPriceAlerts } from '../jobs/priceAlerts';
import type { WorkerJob } from '../queue';

/**
 * AU-13 — the 07:00 price-alerts job queues ONE digest per owner/manager per
 * Israel day; a flag-off tenant gets nothing; one tenant that throws never
 * stops the others (the per-tenant isolation of jobs/priceAlerts.ts).
 *
 * (The Shabbat / quiet-hours `scheduled_at` case arrives with G-06's notify().)
 */
process.env.DATABASE_URL ??= testDbUrl();
const db = createDb(testDbUrl());
const RUN = `${process.pid}-${Date.now()}`;
const job = <T>(data: T): WorkerJob<T> => ({ id: 't', name: 't', data, attemptsMade: 0, opts: { attempts: 1 } });
const NOW = new Date('2026-10-18T04:00:00Z'); // Sun 07:00 IDT
const ids: string[] = [];

async function tenant(label: string, opts: { features?: Record<string, boolean>; timezone?: string; roles?: Array<'owner' | 'manager' | 'receiver' | 'bookkeeper'> }) {
  const [r] = await db
    .insert(restaurants)
    .values({ name: `au13 ${label} ${RUN}`, settings: { features: opts.features ?? { priceAlerts: true } } as RestaurantSettings, timezone: opts.timezone ?? 'Asia/Jerusalem' })
    .returning();
  ids.push(r!.id);
  for (const role of opts.roles ?? ['owner', 'manager', 'receiver', 'bookkeeper']) {
    const [u] = await db.insert(users).values({ email: `au13-${label}-${role}-${RUN}@test.local` }).returning();
    await db.insert(memberships).values({ userId: u!.id, restaurantId: r!.id, role });
  }
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: `ספק ${label}` }).returning();
  const [p] = await db.insert(products).values({ restaurantId: r!.id, canonicalName: `עגבניות ${label}`, defaultUnit: 'ק״ג' }).returning();
  const days = [20, 16, 8, 4, 1];
  const prices = [6.2, 6.2, 7.3, 7.32, 7.34];
  for (let i = 0; i < days.length; i++) {
    await db.insert(priceHistory).values({
      restaurantId: r!.id,
      productId: p!.id,
      supplierId: s!.id,
      observedAt: new Date(NOW.getTime() - days[i]! * 86_400_000),
      unitPrice: prices[i]!.toFixed(4),
    });
  }
  return r!.id;
}

afterAll(async () => {
  if (ids.length) await db.delete(restaurants).where(inArray(restaurants.id, ids));
});

describe('AU-13 price-alerts job → morning digest', () => {
  it('one mail per owner/manager; none for receiver/bookkeeper; flag off → 0 rows; a throwing tenant does not stop the others', async () => {
    const ok = await tenant('ok', {});
    const off = await tenant('off', { features: {} });
    const bad = await tenant('bad', { timezone: 'Not/AZone' });

    const res = await processPriceAlerts(job({ forDate: NOW.toISOString() }));
    expect(res.failed).toBeGreaterThanOrEqual(1);

    const rows = await db.select().from(notificationsOutbox).where(inArray(notificationsOutbox.restaurantId, [ok, off, bad]));
    const okRows = rows.filter((r) => r.restaurantId === ok);
    expect(okRows.map((r) => r.target).sort()).toEqual([`au13-ok-manager-${RUN}@test.local`, `au13-ok-owner-${RUN}@test.local`]);
    expect(okRows.every((r) => r.dedupeKey?.startsWith(`au:A18:${ok}:`) && r.dedupeKey.endsWith(':2026-10-18'))).toBe(true);
    expect(okRows[0]!.subject).toMatch(/^מחירים שעלו: /);
    expect(rows.filter((r) => r.restaurantId === off)).toHaveLength(0);
    expect(rows.filter((r) => r.restaurantId === bad)).toHaveLength(0);

    // Same slot again: nothing new.
    await processPriceAlerts(job({ restaurantId: ok, forDate: NOW.toISOString() }));
    expect(await db.select().from(notificationsOutbox).where(inArray(notificationsOutbox.restaurantId, [ok]))).toHaveLength(2);
  });
});
