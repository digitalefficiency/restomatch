import { eq, notificationsOutbox, sql, type Database } from '@restomatch/db';
import type { NotificationPayload } from './types';

/**
 * notifications_dedupe_key_unique is a PARTIAL unique index (0016:
 * `WHERE dedupe_key IS NOT NULL`). Postgres only infers a partial index as the
 * ON CONFLICT arbiter when the statement repeats its predicate — without it
 * every keyed insert failed with "there is no unique or exclusion constraint
 * matching the ON CONFLICT specification" (end-of-day report, order reminders,
 * supplier delays, placeOrder email). Exported for the other keyed writers.
 */
export const DEDUPE_INDEX_PREDICATE = sql`${notificationsOutbox.dedupeKey} is not null`;

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
      // Fold an optional HTML body into the jsonb payload (under `__html`) so we
      // can deliver rich email without a schema change. Plain `body` stays the
      // text fallback.
      payload: payload.html
        ? { ...(payload.payload ?? {}), __html: payload.html }
        : (payload.payload ?? null),
      status: 'queued',
      relatedEntityType: payload.relatedEntityType ?? null,
      relatedEntityId: payload.relatedEntityId ?? null,
      dedupeKey: payload.dedupeKey ?? null,
    });

  const [row] = payload.dedupeKey
    ? await insert
        .onConflictDoNothing({ target: notificationsOutbox.dedupeKey, where: DEDUPE_INDEX_PREDICATE })
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
