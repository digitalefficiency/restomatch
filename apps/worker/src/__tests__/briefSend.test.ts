import { describe, expect, it, vi } from 'vitest';
import type { notify } from '@restomatch/api';

type NotifyInput = Parameters<typeof notify>[1];

/**
 * AU-04 · never a default-on WhatsApp send (WhatsApp is billed; AD3: e-mail now,
 * WhatsApp only after H-05). Every brief leaves through sendBrief → notify() with
 * channels ['email'] only, and its renderer refuses any other channel even if a
 * member has a verified WhatsApp address.
 */
const seen: NotifyInput[] = [];
vi.mock('@restomatch/api', async (orig) => {
  const real = await orig<typeof import('@restomatch/api')>();
  return {
    ...real,
    notify: vi.fn(async (_db: unknown, input: NotifyInput) => {
      seen.push(input);
      return { enqueued: 0, deduped: 0, failed: 0, rows: [] };
    }),
  };
});
const { sendBrief } = await import('../lib/briefSend');

describe('sendBrief channels', () => {
  it('asks notify() for e-mail only, and renders nothing for WhatsApp or push', async () => {
    const msg = { subject: 's', text: 't', html: '<p>t</p>', deepLink: 'https://x', dedupeSuffix: 'd', automationId: 'A4' as const };
    for (const perishable of [true, false]) {
      seen.length = 0;
      // Tue 3 Nov 2026 07:00 IST: an open send window.
      await sendBrief({} as never, {
        restaurantId: 'r',
        now: new Date('2026-11-03T05:00:00Z'),
        event: 'au:A4:2026-11-03',
        audience: { roles: ['receiver'] },
        entity: { type: 'restaurant', id: 'r' },
        perishable,
        payload: { automationId: 'A4' },
        build: () => msg,
      });
      expect(seen).toHaveLength(1);
      const input = seen[0]!;
      expect(input.channels).toEqual(['email']);
      const render = input.render!;
      const base = { template: 't', locale: 'he' as const, role: 'receiver' as const, vars: {}, canSeeMoney: false };
      expect(render({ ...base, channel: 'email' })).toMatchObject({ subject: 's' });
      expect(render({ ...base, channel: 'whatsapp' })).toBeNull();
      expect(render({ ...base, channel: 'push' as never })).toBeNull();
    }
  });
});
