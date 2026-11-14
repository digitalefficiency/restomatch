import { describe, expect, it } from 'vitest';
import { parsePushSubscription, pushMessageFromRow, vapidConfig } from '../webPush';

describe('Web Push seam (H-05)', () => {
  it('vapidConfig needs all three values and a mailto:/https: subject', () => {
    expect(vapidConfig({})).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b' })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'ops@x' })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: 'a+b', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'mailto:o@x' })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'mailto:o@x' })).toEqual({
      publicKey: 'a',
      privateKey: 'b',
      subject: 'mailto:o@x',
    });
  });

  it('parsePushSubscription accepts only https endpoints with base64url keys', () => {
    const ok = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'BN_a-1', auth: 'q_1' } };
    expect(parsePushSubscription(ok)).toEqual(ok);
    expect(parsePushSubscription({ ...ok, endpoint: 'http://insecure.example/x' })).toBeNull();
    expect(parsePushSubscription({ ...ok, endpoint: 'not a url' })).toBeNull();
    expect(parsePushSubscription({ ...ok, keys: { p256dh: 'a b', auth: 'c' } })).toBeNull();
    expect(parsePushSubscription(null)).toBeNull();
  });

  it('pushMessageFromRow keeps only relative deep links and shortens long bodies', () => {
    const m = pushMessageFromRow({ subject: null, body: 'x'.repeat(300), payload: { deepLink: 'https://evil.test' }, dedupeKey: 'k' });
    expect(m.title).toBe('RestoMatch');
    expect(m.body).toHaveLength(180);
    expect(m.url).toBeUndefined();
    expect(m.tag).toBe('k');
    expect(pushMessageFromRow({ subject: 'ש', body: 'b', payload: { deepLink: '/dashboard' } }).url).toBe('/dashboard');
  });
});
