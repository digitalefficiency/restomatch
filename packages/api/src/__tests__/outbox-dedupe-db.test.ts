import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, notificationsOutbox, testDbUrl } from '@restomatch/db';
import { enqueueNotification } from '../notifications/outbox';
import { MockWhatsAppNotifier } from '../notifications/whatsapp';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * The dedupe contract against REAL Postgres (outbox-dedupe.test.ts mocks the
 * db). notifications_dedupe_key_unique is a partial index, so ON CONFLICT must
 * carry its predicate — without it every deduped enqueue threw 42P10.
 */
const db = createDb(testDbUrl());
let T: Tenant;

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'O');
});
afterAll(async () => {
  await resetDb(db);
});

describe('enqueueNotification dedupe (real DB)', () => {
  it('swallows a duplicate dedupeKey and returns the existing row', async () => {
    const payload = {
      restaurantId: T.restaurantId,
      channel: 'email' as const,
      target: 'owner@test.local',
      body: 'x',
      dedupeKey: `test:${T.restaurantId}`,
    };
    const first = await enqueueNotification(db, payload);
    const second = await enqueueNotification(db, payload);
    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });
    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.dedupeKey, payload.dedupeKey));
    expect(rows).toHaveLength(1);
  });

  it('rows without a dedupeKey are never deduped', async () => {
    const p = { restaurantId: T.restaurantId, channel: 'push' as const, target: 'role:manager', body: 'y' };
    const a = await enqueueNotification(db, p);
    const b = await enqueueNotification(db, p);
    expect(a.id).not.toBe(b.id);
  });

  it('the stub WhatsApp notifier works with a dedupeKey (marks the row sent)', async () => {
    const wa = new MockWhatsAppNotifier();
    const payload = { restaurantId: T.restaurantId, channel: 'whatsapp' as const, target: 'role:owner', body: 'z', dedupeKey: `wa:${T.restaurantId}` };
    expect((await wa.send(db, payload)).ok).toBe(true);
    expect((await wa.send(db, payload)).ok).toBe(true);
    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.dedupeKey, `wa:${T.restaurantId}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('sent');
  });
});
