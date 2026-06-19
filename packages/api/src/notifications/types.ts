import type { Database } from '@restomatch/db';

export type NotificationChannel = 'whatsapp' | 'push' | 'email';

export interface NotificationPayload {
  restaurantId: string;
  channel: NotificationChannel;
  target: string;
  subject?: string;
  body: string;
  payload?: Record<string, unknown>;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /**
   * Optional idempotency key. When set, the partial unique index on
   * notifications_outbox.dedupe_key prevents enqueuing the same logical
   * notification twice (the duplicate insert is silently swallowed).
   */
  dedupeKey?: string;
}

export interface NotificationSendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

export interface Notifier {
  readonly channel: NotificationChannel;
  send(db: Database, payload: NotificationPayload): Promise<NotificationSendResult>;
}
