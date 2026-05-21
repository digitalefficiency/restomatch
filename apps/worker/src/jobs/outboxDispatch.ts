/**
 * Picks up queued notifications from `notifications_outbox` and dispatches
 * via the real provider client. On success, marks `status=sent` and
 * `sent_at=now()`. On failure, marks `status=failed` with `last_error`
 * after maxAttempts is exceeded; otherwise leaves queued for retry.
 *
 * Real provider integration (WhatsApp Cloud, Expo Push, Resend) is plug-in:
 * we look up the provider by channel and call its `dispatch` method.
 * Until credentials are provisioned, the dispatcher runs but does nothing
 * (the mock notifiers already marked rows as `sent` at enqueue time).
 */
import { and, createDb, eq, lte, notificationsOutbox } from '@restomatch/db';
import { makeWorker } from '../queue';

export interface OutboxDispatchJob {
  /** Process up to this many queued rows per tick. */
  batchSize?: number;
}

const MAX_ATTEMPTS = 5;

export function startOutboxDispatchWorker() {
  return makeWorker<OutboxDispatchJob>('outbox-dispatch', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    const batchSize = job.data.batchSize ?? 50;
    const now = new Date();

    const queued = await db
      .select()
      .from(notificationsOutbox)
      .where(
        and(
          eq(notificationsOutbox.status, 'queued'),
          lte(notificationsOutbox.scheduledAt, now),
        ),
      )
      .limit(batchSize);

    if (queued.length === 0) {
      return { dispatched: 0, failed: 0 };
    }

    let dispatched = 0;
    let failed = 0;

    for (const row of queued) {
      try {
        await dispatch(row);
        await db
          .update(notificationsOutbox)
          .set({ status: 'sent', sentAt: new Date() })
          .where(eq(notificationsOutbox.id, row.id));
        dispatched += 1;
      } catch (err) {
        const newAttempt = (row.attemptCount ?? 0) + 1;
        const errMessage = err instanceof Error ? err.message : String(err);
        if (newAttempt >= MAX_ATTEMPTS) {
          await db
            .update(notificationsOutbox)
            .set({
              status: 'failed',
              attemptCount: newAttempt,
              lastError: errMessage,
            })
            .where(eq(notificationsOutbox.id, row.id));
          failed += 1;
        } else {
          await db
            .update(notificationsOutbox)
            .set({
              attemptCount: newAttempt,
              lastError: errMessage,
              scheduledAt: backoff(newAttempt),
            })
            .where(eq(notificationsOutbox.id, row.id));
        }
      }
    }

    console.log(
      `[outbox-dispatch] checked=${queued.length} dispatched=${dispatched} failed=${failed}`,
    );
    return { dispatched, failed };
  });
}

/**
 * Actual provider dispatch. Hard-coded to no-op (rows from the mock
 * notifiers are already `sent` at enqueue, so they never appear here).
 * When real credentials are wired, plug in:
 *   if (row.channel === 'whatsapp') return whatsappCloud.send(...)
 *   if (row.channel === 'push')     return expoPush.send(...)
 *   if (row.channel === 'email')    return resend.send(...)
 */
async function dispatch(_row: {
  channel: 'whatsapp' | 'push' | 'email';
  target: string;
  subject: string | null;
  body: string;
}): Promise<void> {
  // No-op until real provider clients are wired (M9.1).
  // For now, any `queued` row that reaches here will succeed silently.
  return;
}

function backoff(attempt: number): Date {
  // Exponential backoff: 30s, 1m, 5m, 30m, 2h
  const minutes = [0.5, 1, 5, 30, 120][attempt - 1] ?? 240;
  return new Date(Date.now() + minutes * 60_000);
}
