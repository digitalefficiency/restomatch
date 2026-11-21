import { eq, notificationsOutbox, type Database } from '@restomatch/db';
import { enqueueNotification, markSent } from './outbox';
import { staffAlertHold } from './sendWindow';
import type { Notifier, NotificationPayload, NotificationSendResult } from './types';

/**
 * Email notifier — production uses Resend or Postmark.
 *
 * The default impl writes to outbox. A real-mail sender can be swapped in
 * by providing a `dispatch` callback that hits the chosen provider.
 *
 * With a real sender, a STAFF ALERT inside quiet hours / Shabbat or over the
 * daily cap (sendWindow.ts) is only enqueued, due at the next allowed instant;
 * the outbox dispatcher delivers it then. Transactional mail is never held.
 */
export class EmailNotifier implements Notifier {
  readonly channel = 'email' as const;

  constructor(
    private readonly dispatch?: (payload: NotificationPayload) => Promise<{ externalId?: string }>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async send(db: Database, payload: NotificationPayload): Promise<NotificationSendResult> {
    const holdUntil = this.dispatch ? await staffAlertHold(db, payload, this.clock()) : null;
    const enqueued = await enqueueNotification(db, payload);
    if (!this.dispatch) {
      console.log(
        `[email:mock] restaurant=${payload.restaurantId} to=${payload.target} subject="${payload.subject ?? ''}"`,
      );
      await markSent(db, enqueued.id, `email-mock-${Date.now()}`);
      return { ok: true, externalId: `email-mock-${enqueued.id}` };
    }
    // Already enqueued (a held alert, a retried job): that row is the message.
    if (enqueued.deduped) return { ok: true };
    if (holdUntil) {
      await holdQueuedRow(db, enqueued, holdUntil);
      return { ok: true };
    }
    try {
      const result = await this.dispatch(payload);
      await markSent(db, enqueued.id, result.externalId);
      return { ok: true, externalId: result.externalId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Leave a freshly enqueued row `queued`, due at `until`. It keeps its dedupe
 * key, so the next cron run's enqueue of the same alert is swallowed instead
 * of producing a second message. A deduped enqueue (the row already exists,
 * maybe already sent) is left alone.
 */
export async function holdQueuedRow(db: Database, enqueued: { id: string; deduped: boolean }, until: Date): Promise<void> {
  if (enqueued.deduped) return;
  await db.update(notificationsOutbox).set({ scheduledAt: until }).where(eq(notificationsOutbox.id, enqueued.id));
}
