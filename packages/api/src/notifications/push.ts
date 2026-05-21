import type { Database } from '@restomatch/db';
import { enqueueNotification, markSent } from './outbox';
import type { Notifier, NotificationPayload, NotificationSendResult } from './types';

/**
 * Push notifier — production uses Expo Push or Firebase Cloud Messaging.
 * Mock impl writes to outbox and marks sent.
 */
export class MockPushNotifier implements Notifier {
  readonly channel = 'push' as const;

  async send(db: Database, payload: NotificationPayload): Promise<NotificationSendResult> {
    const enqueued = await enqueueNotification(db, payload);
    console.log(
      `[push:mock] restaurant=${payload.restaurantId} target=${payload.target} subject="${payload.subject ?? ''}"`,
    );
    await markSent(db, enqueued.id, `push-mock-${Date.now()}`);
    return { ok: true, externalId: `push-mock-${enqueued.id}` };
  }
}
