import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, notificationsOutbox, testDbUrl } from '@restomatch/db';
import { SKIPPED_NO_PROVIDER } from '../delivery';
import { enqueueNotification, markSent, markSkippedNoProvider } from '../outbox';
import { resetDb, seedTenant, type Tenant } from '../../__tests__/fixtures';

/**
 * H-05 (human-PR part of outbox.ts): attachments are persisted where the
 * dispatcher reads them, markSent no longer wipes the payload, and a row
 * without a provider is parked `failed + skipped_no_provider`, never `sent`.
 */
const db = createDb(testDbUrl());
let A: Tenant;

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(async () => {
  await resetDb(db);
});

async function rowOf(id: string) {
  const [r] = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.id, id));
  return r!;
}

describe('outbox.ts — honest storage and status (H-05)', () => {
  it('enqueueNotification persists attachments under payload.__attachments (were dropped)', async () => {
    const { id } = await enqueueNotification(db, {
      restaurantId: A.restaurantId,
      channel: 'email',
      target: 'supplier@example.test',
      body: 'text',
      html: '<p>x</p>',
      attachments: [{ filename: 'order.pdf', contentBase64: 'JVBERi0=', contentType: 'application/pdf' }],
      payload: { userId: 'u-1', event: 'po.placed' },
    });
    expect((await rowOf(id)).payload).toEqual({
      userId: 'u-1',
      event: 'po.placed',
      __html: '<p>x</p>',
      __attachments: [{ filename: 'order.pdf', contentBase64: 'JVBERi0=', contentType: 'application/pdf' }],
    });
  });

  it('a plain payload is stored unchanged, and no payload stays null', async () => {
    const a = await enqueueNotification(db, { restaurantId: A.restaurantId, channel: 'email', target: 't@x.test', body: 'b' });
    expect((await rowOf(a.id)).payload).toBeNull();
    const b = await enqueueNotification(db, {
      restaurantId: A.restaurantId,
      channel: 'email',
      target: 't@x.test',
      body: 'b',
      payload: { digest: true },
    });
    expect((await rowOf(b.id)).payload).toEqual({ digest: true });
  });

  it('markSent merges externalId into the payload instead of wiping it', async () => {
    const { id } = await enqueueNotification(db, {
      restaurantId: A.restaurantId,
      channel: 'email',
      target: 'o@x.test',
      body: 'b',
      html: '<b>h</b>',
      payload: { userId: 'u-1', event: 'invoice.flagged', digest: true },
    });
    await markSent(db, id, 'em_123');
    const r = await rowOf(id);
    expect(r.status).toBe('sent');
    expect(r.sentAt).not.toBeNull();
    expect(r.payload).toEqual({ userId: 'u-1', event: 'invoice.flagged', digest: true, __html: '<b>h</b>', externalId: 'em_123' });

    // Without an id the payload is left as it was.
    const other = await enqueueNotification(db, {
      restaurantId: A.restaurantId,
      channel: 'email',
      target: 'o@x.test',
      body: 'b',
      payload: { userId: 'u-2' },
    });
    await markSent(db, other.id);
    expect((await rowOf(other.id)).payload).toEqual({ userId: 'u-2' });
  });

  it('markSkippedNoProvider parks a queued row as failed + skipped_no_provider and never downgrades a sent row', async () => {
    const q = await enqueueNotification(db, { restaurantId: A.restaurantId, channel: 'push', target: 'sub-1', body: 'b' });
    await markSkippedNoProvider(db, q.id);
    const r = await rowOf(q.id);
    expect(r.status).toBe('failed');
    expect(r.lastError).toBe(SKIPPED_NO_PROVIDER);
    expect(r.sentAt).toBeNull();

    const s = await enqueueNotification(db, { restaurantId: A.restaurantId, channel: 'email', target: 'o@x.test', body: 'b' });
    await markSent(db, s.id, 'em_1');
    await markSkippedNoProvider(db, s.id);
    expect((await rowOf(s.id)).status).toBe('sent');
  });
});
