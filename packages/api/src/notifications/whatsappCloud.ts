/**
 * WhatsApp Cloud API notifier — production scaffold.
 *
 * VERIFY: pending Meta Business verification. When credentials are set:
 *   WHATSAPP_PHONE_NUMBER_ID
 *   WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_BUSINESS_ACCOUNT_ID
 *
 * No additional SDK install needed — uses fetch directly.
 */

import type { Database } from '@restomatch/db';
import { enqueueNotification, markSent } from './outbox';
import type { Notifier, NotificationPayload, NotificationSendResult } from './types';

export interface WhatsAppCloudConfig {
  phoneNumberId: string;
  accessToken: string;
  apiBase?: string;
}

export class WhatsAppCloudNotifier implements Notifier {
  readonly channel = 'whatsapp' as const;
  private readonly apiBase: string;

  constructor(private readonly config: WhatsAppCloudConfig) {
    this.apiBase = config.apiBase ?? 'https://graph.facebook.com/v20.0';
  }

  async send(db: Database, payload: NotificationPayload): Promise<NotificationSendResult> {
    const enqueued = await enqueueNotification(db, payload);
    try {
      const response = await fetch(`${this.apiBase}/${this.config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: payload.target,
          type: 'text',
          text: { body: payload.body },
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        return { ok: false, error: `WhatsApp ${response.status}: ${errorBody.slice(0, 200)}` };
      }
      const data = (await response.json()) as { messages?: Array<{ id: string }> };
      const externalId = data.messages?.[0]?.id;
      await markSent(db, enqueued.id, externalId);
      return { ok: true, externalId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
