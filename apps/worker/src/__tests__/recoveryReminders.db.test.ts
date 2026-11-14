import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, notificationsOutbox, restaurants, testDbUrl } from '@restomatch/db';
import { processRecoveryReminders } from '../jobs/recoveryReminders';
import type { WorkerJob } from '../queue';

/**
 * AU-03 · the 08:30 job on the real test DB. The digest rules (recipients,
 * dedupe, stamps, wording) are pinned in packages/api recovery-chase.test.ts;
 * here: the worker entry runs the API digest for one restaurant, never throws
 * on a quiet tenant, and its header names the 7-day rule (the stale "14+ days"
 * is gone).
 */
const db = createDb(testDbUrl());
const RUN = Date.now().toString(36);
let rid: string;
let prevUrl: string | undefined;

beforeAll(async () => {
  prevUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDbUrl();
  const [r] = await db
    .insert(restaurants)
    .values({ name: `au03 ${RUN}`, settings: { features: { recovery: true } } as never })
    .returning({ id: restaurants.id });
  rid = r!.id;
});
afterAll(async () => {
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, rid));
  await db.delete(restaurants).where(eq(restaurants.id, rid));
  process.env.DATABASE_URL = prevUrl;
});

describe('recovery-reminders job (AU-03)', () => {
  it('runs the digest for one restaurant: a quiet tenant → processed, 0 e-mails, nothing failed', async () => {
    const res = await processRecoveryReminders({
      data: { restaurantId: rid, forDate: '2026-10-25T06:30:00.000Z' },
    } as unknown as WorkerJob<{ restaurantId?: string; forDate?: string }>);
    expect(res).toMatchObject({ restaurants: 1, emails: 0, claims: 0, failed: [] });
    expect(await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, rid))).toHaveLength(0);
  });

  it('the header names the one 7-day rule, never the stale 14 days', () => {
    const src = readFileSync(new URL('../jobs/recoveryReminders.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/14\+? days/);
    expect(src).toContain('CLAIM_ANSWER_DAYS (7)');
  });
});
