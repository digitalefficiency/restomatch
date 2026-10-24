import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatch } from '../jobs/outboxDispatch';

/**
 * Without provider keys nothing is sent, and dispatch says so: the job parks
 * the row as failed/skipped_no_provider instead of marking it 'sent' (which
 * made the order page claim "sent by email" for a message that never left).
 */
const KEYS = ['RESEND_API_KEY', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'] as const;
let saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const row = (channel: 'email' | 'whatsapp' | 'push') => ({
  restaurantId: '00000000-0000-0000-0000-000000000001',
  channel,
  target: channel === 'email' ? 'orders@supplier.test' : '+972500000000',
  subject: 'הזמנה חדשה',
  body: 'הזמנה לספק',
  relatedEntityType: 'purchase_order',
  relatedEntityId: '00000000-0000-0000-0000-000000000002',
});

describe('outbox dispatch without providers', () => {
  it('email, WhatsApp and push report no_provider (never "sent")', async () => {
    for (const ch of ['email', 'whatsapp', 'push'] as const) {
      await expect(dispatch(row(ch))).resolves.toBe('no_provider');
    }
  });
});
