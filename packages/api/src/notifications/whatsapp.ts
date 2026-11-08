import type { Database } from '@restomatch/db';
import { SKIPPED_NO_PROVIDER } from './delivery';
import { enqueueNotification, markFailed, markSent } from './outbox';
import type { Notifier, NotificationPayload, NotificationSendResult } from './types';

/**
 * WhatsApp notifier used when the WhatsApp Business Cloud keys are absent
 * (factory.ts picks WhatsAppCloudNotifier once they exist).
 *
 * Dev/test: writes to notifications_outbox and marks the row "sent" with a
 * synthetic externalId, so local flows and demos run end to end.
 *
 * Production: nothing can leave without a provider, so the row is parked as
 * `failed` with last_error = skipped_no_provider (the dispatcher's marker) and
 * the result says so — it never claims "sent".
 */
export class MockWhatsAppNotifier implements Notifier {
  readonly channel = 'whatsapp' as const;

  constructor(private readonly production: boolean = process.env.NODE_ENV === 'production') {}

  async send(db: Database, payload: NotificationPayload): Promise<NotificationSendResult> {
    const enqueued = await enqueueNotification(db, payload);
    if (this.production) {
      await markFailed(db, enqueued.id, SKIPPED_NO_PROVIDER);
      return { ok: false, error: SKIPPED_NO_PROVIDER };
    }
    // Simulate dispatch — log + mark sent
    console.log(
      `[whatsapp:mock] restaurant=${payload.restaurantId} target=${payload.target} subject="${payload.subject ?? ''}"`,
    );
    await markSent(db, enqueued.id, `wa-mock-${Date.now()}`);
    return { ok: true, externalId: `wa-mock-${enqueued.id}` };
  }
}
