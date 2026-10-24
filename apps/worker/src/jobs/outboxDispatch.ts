/**
 * Picks up queued notifications from `notifications_outbox` and dispatches
 * via the real provider client.
 *
 * Concurrency safety (wave 3): each tick ATOMICALLY claims a batch with a
 * single `UPDATE ... SET status='sending', claimed_at=now() WHERE id IN
 * (SELECT id ... FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *`. Because the
 * claim and the status flip happen in one locked statement, two concurrent
 * workers/ticks can never grab the same row — so a PO is never sent twice.
 *
 * On success the row flips `status=sent` / `sent_at=now()`. On failure it goes
 * back to `queued` with backoff (claim released) until MAX_ATTEMPTS, then parks
 * as `status=failed` with `last_error`.
 *
 * Real provider integration (WhatsApp Cloud, Expo Push, Resend) is plug-in:
 * we look up the provider by channel and call its `dispatch` method.
 * A row whose channel has no provider configured is parked as `failed` with
 * last_error = SKIPPED_NO_PROVIDER — never `sent` — so the order page can say
 * "supplier sending isn't configured" instead of "sent by email".
 */
import {
  SKIPPED_NO_PROVIDER,
  isResendConfigured,
  isWhatsAppCloudConfigured,
  makeResendDispatcher,
  WhatsAppCloudNotifier,
  type EmailAttachment,
  type NotificationPayload,
} from '@restomatch/api';
import { eq, notificationsOutbox, sql } from '@restomatch/db';
import { makeWorker } from '../queue';
import { jobDb } from '../db';

export interface OutboxDispatchJob {
  /** Process up to this many queued rows per tick. */
  batchSize?: number;
}

const MAX_ATTEMPTS = 5;

/** Shape of a claimed outbox row (subset we dispatch with). */
interface ClaimedRow {
  id: string;
  restaurant_id: string;
  channel: 'whatsapp' | 'push' | 'email';
  target: string;
  subject: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  attempt_count: number;
}

/** Email attachments ride in `payload.__attachments` (e.g. the order PDF). */
export function readAttachments(payload: Record<string, unknown> | null): EmailAttachment[] | undefined {
  const raw = payload?.__attachments;
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter(
    (a): a is EmailAttachment =>
      !!a && typeof a === 'object' &&
      typeof (a as EmailAttachment).filename === 'string' &&
      typeof (a as EmailAttachment).contentBase64 === 'string',
  );
  return out.length ? out : undefined;
}

export function startOutboxDispatchWorker() {
  return makeWorker<OutboxDispatchJob>('outbox-dispatch', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = jobDb(url);

    const batchSize = job.data.batchSize ?? 50;

    // Atomically CLAIM a batch: flip queued -> sending and stamp claimed_at in a
    // single statement whose subquery locks the chosen rows FOR UPDATE SKIP
    // LOCKED. Concurrent workers/ticks therefore never select the same row, so
    // a notification (and thus a PO send) is dispatched by exactly one worker —
    // no double-send. The old SELECT-then-UPDATE had a race window between the
    // unlocked read and the write where two ticks could both grab a row.
    const claimed = (await db.execute(sql`
      UPDATE ${notificationsOutbox}
      SET status = 'sending', claimed_at = now()
      WHERE id IN (
        SELECT id FROM ${notificationsOutbox}
        WHERE status = 'queued' AND scheduled_at <= now()
        ORDER BY scheduled_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      RETURNING id, restaurant_id, channel, target, subject, body, payload,
                related_entity_type, related_entity_id, attempt_count
    `)) as unknown as ClaimedRow[];

    if (claimed.length === 0) {
      return { dispatched: 0, failed: 0 };
    }

    let dispatched = 0;
    let failed = 0;
    let skipped = 0;

    for (const claimedRow of claimed) {
      const row = {
        id: claimedRow.id,
        restaurantId: claimedRow.restaurant_id,
        channel: claimedRow.channel,
        target: claimedRow.target,
        subject: claimedRow.subject,
        body: claimedRow.body,
        html: typeof claimedRow.payload?.__html === 'string' ? claimedRow.payload.__html : undefined,
        attachments: readAttachments(claimedRow.payload),
        relatedEntityType: claimedRow.related_entity_type,
        relatedEntityId: claimedRow.related_entity_id,
        attemptCount: claimedRow.attempt_count,
      };
      try {
        const outcome = await dispatch(row);
        if (outcome === 'no_provider') {
          await db
            .update(notificationsOutbox)
            .set({ status: 'failed', lastError: SKIPPED_NO_PROVIDER, claimedAt: null })
            .where(eq(notificationsOutbox.id, row.id));
          skipped += 1;
          continue;
        }
        await db
          .update(notificationsOutbox)
          .set({ status: 'sent', sentAt: new Date() })
          .where(eq(notificationsOutbox.id, row.id));
        dispatched += 1;
      } catch (err) {
        const newAttempt = (row.attemptCount ?? 0) + 1;
        const errMessage = err instanceof Error ? err.message : String(err);
        if (newAttempt >= MAX_ATTEMPTS) {
          // Terminal failure: leave it parked as `failed` (claimedAt cleared).
          await db
            .update(notificationsOutbox)
            .set({
              status: 'failed',
              attemptCount: newAttempt,
              lastError: errMessage,
              claimedAt: null,
            })
            .where(eq(notificationsOutbox.id, row.id));
          failed += 1;
        } else {
          // Retry: release the claim by flipping back to `queued` and clearing
          // claimedAt, so the next tick re-claims it once the backoff elapses.
          // (Without this the row stays stuck in `sending` forever.)
          await db
            .update(notificationsOutbox)
            .set({
              status: 'queued',
              attemptCount: newAttempt,
              lastError: errMessage,
              scheduledAt: backoff(newAttempt),
              claimedAt: null,
            })
            .where(eq(notificationsOutbox.id, row.id));
        }
      }
    }

    console.log(
      `[outbox-dispatch] claimed=${claimed.length} dispatched=${dispatched} failed=${failed} skipped_no_provider=${skipped}`,
    );
    return { dispatched, failed, skipped };
  });
}

/**
 * Actual provider dispatch for a queued outbox row.
 *
 * Provider selection is env-gated so this stays a no-op (and tests stay
 * hermetic) until real credentials are provisioned:
 *   whatsapp -> WhatsAppCloudNotifier  when WHATSAPP_PHONE_NUMBER_ID +
 *               WHATSAPP_ACCESS_TOKEN are set
 *   email    -> Resend                 when RESEND_API_KEY is set
 *   push     -> no real provider wired yet (no-op)
 *
 * Rows enqueued by the mock notifiers are already `sent` at enqueue and never
 * reach here. Rows left `queued` (real-provider path, or a failed first send)
 * are delivered here without re-enqueueing. Throwing marks the row for retry;
 * 'no_provider' means nothing was sent and nothing can be until keys exist.
 */
export async function dispatch(row: {
  restaurantId: string;
  channel: 'whatsapp' | 'push' | 'email';
  target: string;
  subject: string | null;
  body: string;
  html?: string;
  attachments?: EmailAttachment[];
  relatedEntityType: string | null;
  relatedEntityId: string | null;
}): Promise<'sent' | 'no_provider'> {
  const env = process.env;

  if (row.channel === 'whatsapp') {
    if (!isWhatsAppCloudConfigured(env)) return 'no_provider';
    const notifier = new WhatsAppCloudNotifier({
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
      accessToken: env.WHATSAPP_ACCESS_TOKEN!,
      apiBase: env.WHATSAPP_API_BASE,
    });
    await notifier.dispatch(row.target, row.body);
    return 'sent';
  }

  if (row.channel === 'email') {
    if (!isResendConfigured(env)) return 'no_provider';
    const send = makeResendDispatcher({
      apiKey: env.RESEND_API_KEY!,
      from: env.RESEND_FROM ?? env.EMAIL_FROM,
    });
    const payload: NotificationPayload = {
      restaurantId: row.restaurantId,
      channel: 'email',
      target: row.target,
      subject: row.subject ?? undefined,
      body: row.body,
      html: row.html,
      attachments: row.attachments,
      relatedEntityType: row.relatedEntityType ?? undefined,
      relatedEntityId: row.relatedEntityId ?? undefined,
    };
    await send(payload);
    return 'sent';
  }

  // push: no real provider wired yet.
  return 'no_provider';
}

function backoff(attempt: number): Date {
  // Exponential backoff: 30s, 1m, 5m, 30m, 2h
  const minutes = [0.5, 1, 5, 30, 120][attempt - 1] ?? 240;
  return new Date(Date.now() + minutes * 60_000);
}
