/**
 * Meta-shaped WhatsApp Cloud API webhook builders for the WA-01 simulator.
 * Shapes follow `entry[].changes[].value.messages[]` (text, image, document,
 * interactive button_reply / list_reply, template `button`), `statuses[]` and
 * `system`. Today's parser (`parseWhatsAppWebhook`) reads text/image/document.
 * WA-05ʰ extends it to the rest; the builders exist now, so its tests can reuse them.
 *
 * Lab only: the app secret below is a fixed test string, NOT a credential, and
 * every number is a `+97250000xxxx` lab number.
 */
import { signMeta } from '@restomatch/ingest';

export const LAB_APP_SECRET = 'wa-01-lab-app-secret-not-a-credential';
export const LAB_PHONE_NUMBER_ID = '100000000000001';
export const LAB_DISPLAY_NUMBER = '972500000000';

/** Lab senders (E.164 without '+', as Meta sends `from`). */
export const LAB_NUMBERS = {
  owner: '972500000001',
  manager: '972500000002',
  chef: '972500000003',
  receiver: '972500000004',
  bookkeeper: '972500000005',
  'other-binding': '972500000099',
  'supplier-number': '972500000101',
  'unknown-number': '972500000999',
} as const;

export interface MsgBase {
  from: string;
  wamid: string;
  /** Unix seconds. */
  timestamp: number;
  /** The outbound wamid this message answers (taps), and forward flags. */
  context?: { id?: string; forwarded?: boolean; frequently_forwarded?: boolean };
}

type WaMsg = Record<string, unknown>;

function base(m: MsgBase, type: string): WaMsg {
  return {
    from: m.from,
    id: m.wamid,
    timestamp: String(m.timestamp),
    type,
    ...(m.context ? { context: { from: LAB_DISPLAY_NUMBER, ...m.context } } : {}),
  };
}

export const text = (m: MsgBase, body: string): WaMsg => ({ ...base(m, 'text'), text: { body } });

export const image = (m: MsgBase, mediaId: string, caption?: string): WaMsg => ({
  ...base(m, 'image'),
  image: { id: mediaId, mime_type: 'image/jpeg', ...(caption ? { caption } : {}) },
});

export const document = (m: MsgBase, mediaId: string, filename: string, caption?: string): WaMsg => ({
  ...base(m, 'document'),
  document: { id: mediaId, mime_type: 'application/pdf', filename, ...(caption ? { caption } : {}) },
});

export const buttonReply = (m: MsgBase, id: string, title: string): WaMsg => ({
  ...base(m, 'interactive'),
  interactive: { type: 'button_reply', button_reply: { id, title } },
});

export const listReply = (m: MsgBase, id: string, title: string): WaMsg => ({
  ...base(m, 'interactive'),
  interactive: { type: 'list_reply', list_reply: { id, title } },
});

/** A quick-reply button on a template message arrives as type `button`. */
export const templateButton = (m: MsgBase, payload: string, label: string): WaMsg => ({
  ...base(m, 'button'),
  button: { payload, text: label },
});

export const systemChange = (m: MsgBase, newWaId: string): WaMsg => ({
  ...base(m, 'system'),
  system: { body: 'User changed number', type: 'user_changed_number', new_wa_id: newWaId },
});

export function status(wamid: string, recipient: string, s: 'sent' | 'delivered' | 'read' | 'failed', ts: number) {
  return { id: wamid, status: s, timestamp: String(ts), recipient_id: recipient };
}

/** The webhook envelope around messages and/or statuses. */
export function envelope(value: { messages?: WaMsg[]; statuses?: unknown[] }): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_LAB',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: LAB_DISPLAY_NUMBER, phone_number_id: LAB_PHONE_NUMBER_ID },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

/** Raw bytes + `X-Hub-Signature-256`, exactly what the handler verifies. */
export function signed(json: unknown, secret = LAB_APP_SECRET): { raw: string; signature: string } {
  const raw = JSON.stringify(json);
  return { raw, signature: signMeta(raw, secret) };
}
