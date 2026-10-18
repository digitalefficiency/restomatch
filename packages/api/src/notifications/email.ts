import type { Database } from '@restomatch/db';
import { enqueueNotification, markSent } from './outbox';
import type { Notifier, NotificationPayload, NotificationSendResult } from './types';

/**
 * Email notifier — production uses Resend or Postmark.
 *
 * The default impl writes to outbox. A real-mail sender can be swapped in
 * by providing a `dispatch` callback that hits the chosen provider.
 */
export class EmailNotifier implements Notifier {
  readonly channel = 'email' as const;

  constructor(
    private readonly dispatch?: (payload: NotificationPayload) => Promise<{ externalId?: string }>,
  ) {}

  async send(db: Database, payload: NotificationPayload): Promise<NotificationSendResult> {
    const enqueued = await enqueueNotification(db, payload);
    if (!this.dispatch) {
      console.log(
        `[email:mock] restaurant=${payload.restaurantId} to=${payload.target} subject="${payload.subject ?? ''}"`,
      );
      await markSent(db, enqueued.id, `email-mock-${Date.now()}`);
      return { ok: true, externalId: `email-mock-${enqueued.id}` };
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
