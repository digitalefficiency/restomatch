/**
 * Fold due over-cap rows into one digest message each (H-05 slice b).
 *
 * G-06 notify() marks the 7th+ alert of a person's day `payload.digest = true`
 * and moves it to the next allowed slot (quiet hours / Shabbat already
 * applied). Run this right BEFORE the dispatcher claims rows: it locks the due
 * digest rows (SKIP LOCKED, so a concurrent dispatcher tick never sees the
 * same row), enqueues one digest message per (person, channel, Israel day),
 * and closes the source rows `cancelled` + `folded_into_digest`. One
 * transaction: either the digest exists and its sources are closed, or
 * nothing changed. The digest row carries no new ₪ (foldDigest lists items).
 */
import { notificationsOutbox, sql, type Database } from '@restomatch/db';
import { enqueueNotification } from '../outbox';
import { DEFAULT_TZ } from './calendar';
import { foldDigest, type DigestCandidate } from './digest';

export const FOLDED_INTO_DIGEST = 'folded_into_digest';

interface DueRow {
  id: string;
  restaurant_id: string;
  channel: 'email' | 'whatsapp' | 'push';
  target: string;
  subject: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  scheduled_at: Date | string;
}

export async function foldDueDigests(
  db: Database,
  opts: { now?: Date; tz?: string; limit?: number } = {},
): Promise<{ digests: number; folded: number }> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 500;
  return db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      SELECT id, restaurant_id, channel, target, subject, body, payload, scheduled_at
      FROM ${notificationsOutbox}
      WHERE status = 'queued'
        AND scheduled_at <= ${now.toISOString()}::timestamptz
        AND payload->>'digest' = 'true'
      ORDER BY scheduled_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `);
    const due = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as DueRow[];
    if (due.length === 0) return { digests: 0, folded: 0 };

    const candidates: DigestCandidate[] = due.map((r) => ({
      id: r.id,
      restaurantId: r.restaurant_id,
      channel: r.channel,
      target: r.target,
      subject: r.subject,
      body: r.body,
      payload: r.payload,
      scheduledAt: new Date(r.scheduled_at),
    }));

    let digests = 0;
    let folded = 0;
    for (const msg of foldDigest(candidates, opts.tz ?? DEFAULT_TZ)) {
      const first = candidates.find((c) => c.id === msg.rowIds[0]);
      await enqueueNotification(tx as unknown as Database, {
        restaurantId: msg.restaurantId,
        channel: msg.channel,
        target: msg.target,
        subject: msg.subject,
        body: msg.body,
        // Keep the person's identity so the digest counts as one alert for them.
        payload: {
          ...(typeof first?.payload?.userId === 'string' ? { userId: first.payload.userId } : {}),
          event: 'digest',
          digestOf: msg.rowIds,
        },
        relatedEntityType: 'notification_digest',
        dedupeKey: msg.dedupeKey,
      });
      const closed = await tx
        .update(notificationsOutbox)
        .set({ status: 'cancelled', lastError: FOLDED_INTO_DIGEST })
        .where(
          sql`${notificationsOutbox.id} in (${sql.join(
            msg.rowIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}) and ${notificationsOutbox.status} = 'queued'`,
        )
        .returning({ id: notificationsOutbox.id });
      digests += 1;
      folded += closed.length;
    }
    return { digests, folded };
  });
}
