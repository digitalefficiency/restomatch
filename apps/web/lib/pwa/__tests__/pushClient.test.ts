import { describe, expect, it, vi } from 'vitest';
import { pushSupport, subscribeThisDevice, toInput, unsubscribeThisDevice, vapidKeyBytes, type PushEnv, type SubscriptionLike } from '../pushClient';

const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

function fakeSub(endpoint = 'https://push.example/e1'): SubscriptionLike {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'BPk1aaaaaaaa', auth: 'authAAAA' } }),
    unsubscribe: vi.fn(async () => true),
  };
}
function env(over: Partial<{ permission: NotificationPermission; grant: NotificationPermission; existing: SubscriptionLike | null }> = {}) {
  const subscribe = vi.fn(async () => fakeSub());
  const requestPermission = vi.fn(async () => over.grant ?? 'granted');
  const e: PushEnv = {
    Notification: { permission: over.permission ?? 'default', requestPermission },
    serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => over.existing ?? null, subscribe } }) },
  };
  return { e, subscribe, requestPermission };
}

describe('push on this device (W3-03b)', () => {
  it('asks permission, then subscribes with the VAPID key bytes', async () => {
    const { e, subscribe, requestPermission } = env();
    const out = await subscribeThisDevice(e, KEY, 'UA');
    expect(requestPermission).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(KEY) });
    expect(out).toEqual({ ok: true, input: { endpoint: 'https://push.example/e1', keys: { p256dh: 'BPk1aaaaaaaa', auth: 'authAAAA' }, userAgent: 'UA' } });
    expect(vapidKeyBytes(KEY)).toHaveLength(65);
  });
  it('a refusal, a missing key or no support never subscribes', async () => {
    const refused = env({ grant: 'denied' });
    expect(await subscribeThisDevice(refused.e, KEY, null)).toEqual({ ok: false, reason: 'denied' });
    expect(refused.subscribe).not.toHaveBeenCalled();
    expect(await subscribeThisDevice(env().e, null, null)).toEqual({ ok: false, reason: 'no-key' });
    expect(await subscribeThisDevice({}, KEY, null)).toEqual({ ok: false, reason: 'unsupported' });
    expect(await subscribeThisDevice({ iosNotInstalled: true }, KEY, null)).toEqual({ ok: false, reason: 'needs-install' });
    expect(pushSupport(env({ permission: 'denied' }).e)).toBe('denied');
  });
  it('reuses an existing subscription; unsubscribe returns its endpoint', async () => {
    const existing = fakeSub('https://push.example/old');
    const { e, subscribe } = env({ permission: 'granted', existing });
    const out = await subscribeThisDevice(e, KEY, null);
    expect(subscribe).not.toHaveBeenCalled();
    expect(out.ok && out.input.endpoint).toBe('https://push.example/old');
    expect(await unsubscribeThisDevice(e)).toBe('https://push.example/old');
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(await unsubscribeThisDevice(env().e)).toBeNull();
  });
  it('drops a subscription without keys', () => {
    expect(toInput({ endpoint: 'https://x', toJSON: () => ({}), unsubscribe: async () => true }, null)).toBeNull();
  });
});
