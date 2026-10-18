import type { Database } from '@restomatch/db';
import { enqueueNotification, markSent } from './outbox';
import type { Notifier, NotificationPayload, NotificationSendResult } from './types';

/**
 * WhatsApp notifier — production uses WhatsApp Business Cloud API.
 *
 * The mock impl writes to notifications_outbox and immediately marks
 * the row as "sent" with a synthetic externalId. When WhatsApp
 * Business onboarding is complete (M9 polish), the send() method
 * will dispatch to the real API and only mark the row sent on success.
 */
export class MockWhatsAppNotifier implements Notifier {
  readonly channel = 'whatsapp' as const;

  async send(db: Database, payload: NotificationPayload): Promise<NotificationSendResult> {
    const enqueued = await enqueueNotification(db, payload);
    // Simulate dispatch — log + mark sent
    console.log(
      `[whatsapp:mock] restaurant=${payload.restaurantId} target=${payload.target} subject="${payload.subject ?? ''}"`,
    );
    await markSent(db, enqueued.id, `wa-mock-${Date.now()}`);
    return { ok: true, externalId: `wa-mock-${enqueued.id}` };
  }
}
