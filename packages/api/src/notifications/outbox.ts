import { eq, notificationsOutbox, type Database } from '@restomatch/db';
import type { NotificationPayload } from './types';

/**
 * Persist a notification request to notifications_outbox.
 * Real delivery happens later (worker reads queued rows + sends via real APIs).
 */
export async function enqueueNotification(
  db: Database,
  payload: NotificationPayload,
): Promise<{ id: string }> {
  const [row] = await db
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
    })
    .returning({ id: notificationsOutbox.id });
  if (!row) throw new Error('failed to enqueue notification');
  return { id: row.id };
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
