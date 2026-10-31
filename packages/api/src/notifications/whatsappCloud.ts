/**
 * WhatsApp Cloud API notifier — production scaffold.
 *
 * VERIFY: pending Meta Business verification. When credentials are set:
 *   WHATSAPP_PHONE_NUMBER_ID
 *   WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_BUSINESS_ACCOUNT_ID
 *
 * No additional SDK install needed — uses fetch directly.
 *
 * A STAFF ALERT inside quiet hours / Shabbat or over the daily cap
 * (sendWindow.ts) is only enqueued, due at the next allowed instant; the
 * outbox dispatcher delivers it then.
 */

import type { Database } from '@restomatch/db';
import { holdQueuedRow } from './email';
import { enqueueNotification, markSent } from './outbox';
import { staffAlertHold } from './sendWindow';
import type { Notifier, NotificationPayload, NotificationSendResult } from './types';

export interface WhatsAppCloudConfig {
  phoneNumberId: string;
  accessToken: string;
  apiBase?: string;
}

export class WhatsAppCloudNotifier implements Notifier {
  readonly channel = 'whatsapp' as const;
  private readonly apiBase: string;

  constructor(
    private readonly config: WhatsAppCloudConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.apiBase = config.apiBase ?? 'https://graph.facebook.com/v20.0';
  }

  async send(db: Database, payload: NotificationPayload): Promise<NotificationSendResult> {
    const holdUntil = await staffAlertHold(db, payload, this.clock());
    const enqueued = await enqueueNotification(db, payload);
    // Already enqueued (a held alert, a retried job): that row is the message.
    if (enqueued.deduped) return { ok: true };
    if (holdUntil) {
      await holdQueuedRow(db, enqueued, holdUntil);
      return { ok: true };
    }
    try {
      const externalId = await this.dispatch(payload.target, payload.body);
      await markSent(db, enqueued.id, externalId);
      return { ok: true, externalId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Low-level send against the WhatsApp Cloud API. Posts a text message and
   * returns the provider message id. Does NOT touch the outbox — callers that
   * already have a persisted row (e.g. the worker outbox dispatcher) use this
   * to avoid double-enqueueing. Throws on non-2xx so the caller can retry.
   */
  async dispatch(to: string, body: string): Promise<string | undefined> {
    const response = await fetch(`${this.apiBase}/${this.config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp ${response.status}: ${errorBody.slice(0, 200)}`);
    }
    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    return data.messages?.[0]?.id;
  }
}
