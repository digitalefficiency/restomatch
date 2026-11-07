import { eq, notificationsOutbox, sql, type Database } from '@restomatch/db';
import { SKIPPED_NO_PROVIDER } from './delivery';
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
      // Fold an optional HTML body (under `__html`) and attachments (under
      // `__attachments`, the key the dispatcher reads) into the jsonb payload
      // so rich email needs no schema change. Plain `body` stays the text
      // fallback. H-05: attachments used to be dropped here silently.
      payload: storedPayload(payload),
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

/** The jsonb payload as stored: the producer's keys plus `__html` / `__attachments`. */
export function storedPayload(payload: NotificationPayload): Record<string, unknown> | null {
  const extra: Record<string, unknown> = {};
  if (payload.html) extra.__html = payload.html;
  if (payload.attachments?.length) extra.__attachments = payload.attachments;
  if (Object.keys(extra).length === 0) return payload.payload ?? null;
  return { ...(payload.payload ?? {}), ...extra };
}

/**
 * Mark an outbox row as sent. `externalId` is MERGED into the stored payload:
 * it used to replace it, wiping `__html`, `userId`, `event` and `digest`
 * (G-06's keys), so a sent row could no longer be counted against the
 * per-person daily cap or reconciled to its report.
 */
export async function markSent(db: Database, outboxId: string, externalId?: string): Promise<void> {
  await db
    .update(notificationsOutbox)
    .set({
      status: 'sent',
      sentAt: new Date(),
      ...(externalId
        ? {
            payload: sql`coalesce(${notificationsOutbox.payload}, '{}'::jsonb) || jsonb_build_object('externalId', ${externalId}::text)`,
          }
        : {}),
    })
    .where(eq(notificationsOutbox.id, outboxId));
}

/**
 * Park a row that no provider can deliver yet (Phase-6 credentials missing):
 * `failed` + `skipped_no_provider` (or another skip reason), never `sent`.
 * Only from `queued`/`sending`, so it can never downgrade a sent row.
 */
export async function markSkippedNoProvider(
  db: Database,
  outboxId: string,
  reason: string = SKIPPED_NO_PROVIDER,
): Promise<void> {
  await db
    .update(notificationsOutbox)
    .set({ status: 'failed', lastError: reason, claimedAt: null })
    .where(sql`${notificationsOutbox.id} = ${outboxId} and ${notificationsOutbox.status} in ('queued', 'sending')`);
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
