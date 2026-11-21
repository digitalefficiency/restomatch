import { describe, expect, it, vi } from 'vitest';
import { SKIPPED_NO_PROVIDER } from '../../delivery';
import { deliverOutboxRow, SKIPPED_NO_SUBSCRIPTION, type DeliverableRow } from '../deliver';
import { providersFromEnv, deliveryReadiness, type DeliveryProviders } from '../providers';
import { waTemplatePayload } from '../waTemplates';
import { PushGoneError } from '../webPush';

const base: DeliverableRow = {
  id: 'row-1',
  restaurantId: 'r-1',
  channel: 'email',
  target: 'owner@example.test',
  subject: 'נושא',
  body: 'גוף',
  payload: null,
  relatedEntityType: null,
  relatedEntityId: null,
};
const none: DeliveryProviders = { email: null, whatsapp: null, push: null };
const VAPID = { VAPID_PUBLIC_KEY: 'BPub_key-1', VAPID_PRIVATE_KEY: 'priv_key-1', VAPID_SUBJECT: 'mailto:ops@restomatch.test' };

describe('deliverOutboxRow (H-05 send path through mocks)', () => {
  it('with no credentials every channel is skipped_no_provider, never sent', async () => {
    const providers = providersFromEnv({});
    expect(deliveryReadiness(providers)).toEqual({ email: false, whatsapp: false, push: false });
    for (const channel of ['email', 'whatsapp', 'push'] as const) {
      const target = channel === 'whatsapp' ? '972501234567' : base.target;
      await expect(deliverOutboxRow({ ...base, channel, target }, providers)).resolves.toEqual({
        outcome: 'skipped',
        reason: SKIPPED_NO_PROVIDER,
      });
    }
  });

  it('push stays without a provider even with VAPID keys until the library and the subscription store exist', () => {
    expect(providersFromEnv(VAPID).push).toBeNull();
  });

  it('a role: target is rejected outright (G-06: a role is never an address)', async () => {
    await expect(deliverOutboxRow({ ...base, target: 'role:manager' }, none)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_target_role',
    });
  });

  it('email carries the stored html and attachments to the provider', async () => {
    const email = vi.fn(async () => ({ externalId: 'em_1' }));
    const out = await deliverOutboxRow(
      {
        ...base,
        payload: { __html: '<p>שלום</p>', __attachments: [{ filename: 'a.pdf', contentBase64: 'JVBERi0=' }], userId: 'u1' },
      },
      { ...none, email },
    );
    expect(out).toEqual({ outcome: 'sent', externalId: 'em_1' });
    expect(email).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<p>שלום</p>', attachments: [{ filename: 'a.pdf', contentBase64: 'JVBERi0=' }] }),
    );
  });

  it('a template row goes out as a template; a plain row as text', async () => {
    const whatsapp = { sendText: vi.fn(async () => 'wamid.t'), sendTemplate: vi.fn(async () => 'wamid.tpl') };
    const tpl = waTemplatePayload({
      name: 'rm_delivery_late',
      params: { supplier: 'תנובה', expected: '08:00', link: '/dashboard/orders/1' },
    });
    await expect(
      deliverOutboxRow({ ...base, channel: 'whatsapp', target: '972501234567', payload: tpl }, { ...none, whatsapp }),
    ).resolves.toEqual({ outcome: 'sent', externalId: 'wamid.tpl' });
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith('972501234567', tpl.__waTemplate);
    await deliverOutboxRow({ ...base, channel: 'whatsapp', target: '972501234567' }, { ...none, whatsapp });
    expect(whatsapp.sendText).toHaveBeenCalledWith('972501234567', 'גוף');
  });

  it('a broken template row is rejected (no retry), a provider error is thrown (retry)', async () => {
    const real = (await import('../whatsappClient')).makeWhatsAppClient({
      phoneNumberId: 'PN',
      accessToken: 'T',
      fetch: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    });
    const bad = { __waTemplate: { name: 'rm_claim_letter', params: { contact: 'x' } } };
    await expect(
      deliverOutboxRow({ ...base, channel: 'whatsapp', target: '972501234567', payload: bad }, { ...none, whatsapp: real }),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'wa_missing_param' });

    const failing = { sendText: vi.fn(async () => Promise.reject(new Error('WhatsApp 500'))), sendTemplate: vi.fn() };
    await expect(
      deliverOutboxRow({ ...base, channel: 'whatsapp', target: '972501234567' }, { ...none, whatsapp: failing }),
    ).rejects.toThrow('WhatsApp 500');
  });

  it('push: resolves the subscription inside the restaurant, sends, and treats a gone subscription as skipped', async () => {
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p256', auth: 'auth' } };
    const resolveSubscription = vi.fn(async (_r: string, t: string) => (t === 'sub-1' ? sub : null));
    const send = vi.fn(async () => ({ externalId: 'push-1' }));
    const providers = providersFromEnv(VAPID, { pushProvider: { send }, resolvePushSubscription: resolveSubscription });
    expect(providers.push).not.toBeNull();

    const row = { ...base, channel: 'push' as const, target: 'sub-1', payload: { deepLink: '/dashboard/approvals' } };
    await expect(deliverOutboxRow(row, providers)).resolves.toEqual({ outcome: 'sent', externalId: 'push-1' });
    expect(resolveSubscription).toHaveBeenCalledWith('r-1', 'sub-1');
    expect(send).toHaveBeenCalledWith(sub, { title: 'נושא', body: 'גוף', url: '/dashboard/approvals' });

    await expect(deliverOutboxRow({ ...row, target: 'sub-x' }, providers)).resolves.toEqual({
      outcome: 'skipped',
      reason: SKIPPED_NO_SUBSCRIPTION,
    });
    send.mockRejectedValueOnce(new PushGoneError(410));
    await expect(deliverOutboxRow(row, providers)).resolves.toEqual({ outcome: 'skipped', reason: SKIPPED_NO_SUBSCRIPTION });
  });
});
