import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, inArray, notificationsOutbox, sql, testDbUrl } from '@restomatch/db';
import { SKIPPED_NO_PROVIDER } from '../../delivery';
import { enqueueNotification, markSent } from '../../outbox';
import { applyDeliveryOutcome } from '../applyOutcome';
import { FOLDED_INTO_DIGEST, foldDueDigests } from '../digestRun';
import { minimiseOutboxPayloads } from '../outboxMinimise';
import { resetDb, seedTenant, type Tenant } from '../../../__tests__/fixtures';

/** H-05 slice b, the parts independent of AU-04 / G-06 / #173 (real Postgres). */
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
async function claimed(payload: Record<string, unknown> | null = null) {
  const { id } = await enqueueNotification(db, {
    restaurantId: A.restaurantId,
    channel: 'email',
    target: 'o@x.test',
    body: 'b',
    payload: payload ?? undefined,
  });
  await db.update(notificationsOutbox).set({ status: 'sending', claimedAt: new Date() }).where(eq(notificationsOutbox.id, id));
  return id;
}

describe('applyDeliveryOutcome', () => {
  it('sent: status sent, externalId merged, claim released', async () => {
    const id = await claimed({ userId: 'u-1' });
    expect(await applyDeliveryOutcome(db, id, { outcome: 'sent', externalId: 'em_9' })).toBe(true);
    const r = await rowOf(id);
    expect(r.status).toBe('sent');
    expect(r.sentAt).not.toBeNull();
    expect(r.claimedAt).toBeNull();
    expect(r.payload).toEqual({ userId: 'u-1', externalId: 'em_9' });
  });

  it('skipped and rejected park as failed with the reason, never sent', async () => {
    const a = await claimed();
    await applyDeliveryOutcome(db, a, { outcome: 'skipped', reason: SKIPPED_NO_PROVIDER });
    expect(await rowOf(a)).toMatchObject({ status: 'failed', lastError: SKIPPED_NO_PROVIDER, sentAt: null });
    const b = await claimed();
    await applyDeliveryOutcome(db, b, { outcome: 'rejected', reason: 'invalid_target_role' });
    expect(await rowOf(b)).toMatchObject({ status: 'failed', lastError: 'invalid_target_role' });
  });

  it('only acts on a row still claimed (never downgrades a sent row)', async () => {
    const id = await claimed();
    await applyDeliveryOutcome(db, id, { outcome: 'sent', externalId: null });
    expect(await applyDeliveryOutcome(db, id, { outcome: 'skipped', reason: SKIPPED_NO_PROVIDER })).toBe(false);
    expect((await rowOf(id)).status).toBe('sent');
  });
});

describe('foldDueDigests', () => {
  const now = new Date('2026-11-09T06:30:00Z'); // 08:30 IL, Monday
  async function digestRow(i: number, over: { userId?: string; scheduledAt?: Date; digest?: boolean } = {}) {
    const { id } = await enqueueNotification(db, {
      restaurantId: A.restaurantId,
      channel: 'email',
      target: `${over.userId ?? 'u-1'}@x.test`,
      subject: `התראה ${i}`,
      body: `גוף ${i}`,
      payload: { userId: over.userId ?? 'u-1', event: 'invoice.flagged', ...(over.digest === false ? {} : { digest: true }) },
    });
    await db
      .update(notificationsOutbox)
      .set({ scheduledAt: over.scheduledAt ?? new Date('2026-11-09T04:00:00Z') })
      .where(eq(notificationsOutbox.id, id));
    return id;
  }

  it('folds due digest rows into one message per person and closes the sources', async () => {
    const ids = [await digestRow(1), await digestRow(2), await digestRow(3)];
    const other = await digestRow(4, { userId: 'u-2' });
    const plain = await digestRow(5, { digest: false });
    const future = await digestRow(6, { scheduledAt: new Date('2026-11-09T09:00:00Z') });

    expect(await foldDueDigests(db, { now })).toEqual({ digests: 2, folded: 4 });

    const sources = await db.select().from(notificationsOutbox).where(inArray(notificationsOutbox.id, [...ids, other]));
    for (const s of sources) expect(s).toMatchObject({ status: 'cancelled', lastError: FOLDED_INTO_DIGEST });
    expect((await rowOf(plain)).status).toBe('queued');
    expect((await rowOf(future)).status).toBe('queued');

    const digests = await db
      .select()
      .from(notificationsOutbox)
      .where(eq(notificationsOutbox.relatedEntityType, 'notification_digest'));
    const mine = digests.find((d) => (d.payload as { userId?: string }).userId === 'u-1')!;
    expect(mine.status).toBe('queued');
    expect(mine.subject).toBe('סיכום עדכונים · 3');
    expect(mine.dedupeKey).toBe(`digest:${A.restaurantId}:u-1:email:2026-11-09`);
    expect((mine.payload as { digest?: boolean; digestOf: string[] }).digest).toBeUndefined();
    expect([...(mine.payload as { digestOf: string[] }).digestOf].sort()).toEqual([...ids].sort());
  });

  it('a second run folds nothing (idempotent)', async () => {
    await digestRow(1);
    await foldDueDigests(db, { now });
    expect(await foldDueDigests(db, { now })).toEqual({ digests: 0, folded: 0 });
  });
});

describe('minimiseOutboxPayloads (data minimisation after markSent retains the payload)', () => {
  const now = new Date('2026-12-20T00:00:00Z');
  async function finished(sentAt: Date, status: 'sent' | 'queued' = 'sent') {
    const { id } = await enqueueNotification(db, {
      restaurantId: A.restaurantId,
      channel: 'email',
      target: 's@x.test',
      body: 'b',
      html: '<p>letter</p>',
      attachments: [{ filename: 'a.pdf', contentBase64: 'JVBERi0=' }],
      payload: { userId: 'u-1', event: 'claim.letter' },
    });
    if (status === 'sent') await markSent(db, id, 'em_1');
    await db.update(notificationsOutbox).set({ sentAt, scheduledAt: sentAt }).where(eq(notificationsOutbox.id, id));
    return id;
  }

  it('dry-run by default: counts, changes nothing', async () => {
    const old = await finished(new Date('2026-11-01T00:00:00Z'));
    expect(await minimiseOutboxPayloads(db, { now })).toEqual({ dryRun: true, rows: 1 });
    expect((await rowOf(old)).payload).toHaveProperty('__html');
  });

  it('live: strips __html and __attachments from finished rows older than 30 days, keeps the small keys', async () => {
    const old = await finished(new Date('2026-11-01T00:00:00Z'));
    const recent = await finished(new Date('2026-12-10T00:00:00Z'));
    const queued = await finished(new Date('2026-11-01T00:00:00Z'), 'queued');
    expect(await minimiseOutboxPayloads(db, { now, dryRun: false })).toEqual({ dryRun: false, rows: 1 });
    expect((await rowOf(old)).payload).toEqual({ userId: 'u-1', event: 'claim.letter', externalId: 'em_1' });
    expect((await rowOf(recent)).payload).toHaveProperty('__attachments');
    expect((await rowOf(queued)).payload).toHaveProperty('__html');
    expect(await minimiseOutboxPayloads(db, { now, dryRun: false })).toEqual({ dryRun: false, rows: 0 });
  });
});

void sql;
