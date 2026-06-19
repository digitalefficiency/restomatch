import { eq, notificationsOutbox, type Database } from '@restomatch/db';
import type { NotificationPayload } from './types';

/**
 * Persist a notification request to notifications_outbox.
 * Real delivery happens later (worker reads queued rows + sends via real APIs).
 */
export async function enqueueNotification(
  db: Database,
  payload: NotificationPayload,
): Promise<{ id: string; deduped: boolean }> {
  // When a dedupeKey is supplied, rely on the partial unique index
  // (notifications_dedupe_key_unique) for idempotency: a duplicate enqueue is
  // swallowed by ON CONFLICT DO NOTHING and yields no RETURNING row. Callers
  // that need the existing row's id can re-read by dedupeKey, but most just
  // need to know the send is already in flight (deduped=true).
  const insert = db
    .insert(notificationsOutbox)
    .values({
      restaurantId: payload.restaurantId,
      channel: payload.channel,
      target: payload.target,
      subject: payload.subject ?? null,
      body: payload.body,
      payload: payload.payload ?? null,
      status: 'queued',
      relatedEntityType: payload.relatedEntityType ?? null,
      relatedEntityId: payload.relatedEntityId ?? null,
      dedupeKey: payload.dedupeKey ?? null,
    });

  const [row] = payload.dedupeKey
    ? await insert
        .onConflictDoNothing({ target: notificationsOutbox.dedupeKey })
        .returning({ id: notificationsOutbox.id })
    : await insert.returning({ id: notificationsOutbox.id });

  if (!row) {
    if (payload.dedupeKey) {
      const [existing] = await db
        .select({ id: notificationsOutbox.id })
        .from(notificationsOutbox)
        .where(eq(notificationsOutbox.dedupeKey, payload.dedupeKey))
        .limit(1);
      if (existing) return { id: existing.id, deduped: true };
    }
    throw new Error('failed to enqueue notification');
  }
  return { id: row.id, deduped: false };
}

/**
 * Mark an outbox row as sent.
 */
export async function markSent(db: Database, outboxId: string, externalId?: string): Promise<void> {
  await db
    .update(notificationsOutbox)
    .set({
      status: 'sent',
      sentAt: new Date(),
      payload: externalId ? { externalId } : null,
    })
    .where(eq(notificationsOutbox.id, outboxId));
}

/**
 * Mark an outbox row as failed (with error message).
 */
export async function markFailed(db: Database, outboxId: string, error: string): Promise<void> {
  await db
    .update(notificationsOutbox)
    .set({
      status: 'failed',
      lastError: error,
    })
    .where(eq(notificationsOutbox.id, outboxId));
}
