/**
 * W3-03b · this device's Web Push subscription. Permission is asked ONLY from a
 * user gesture (the button on /dashboard/settings/notifications), never on
 * load. Every function here is dependency-injected for tests and never throws.
 */

export type PushSupport = 'supported' | 'unsupported' | 'denied' | 'needs-install';

export interface PushEnv {
  Notification?: { permission: NotificationPermission; requestPermission(): Promise<NotificationPermission> };
  serviceWorker?: { ready: Promise<{ pushManager?: PushManagerLike }> };
  /** iOS only offers push to an installed (home-screen) app. */
  iosNotInstalled?: boolean;
}
export interface PushManagerLike {
  getSubscription(): Promise<SubscriptionLike | null>;
  subscribe(opts: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<SubscriptionLike>;
}
export interface SubscriptionLike {
  endpoint: string;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}
export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string | null;
}

export function pushSupport(env: PushEnv): PushSupport {
  if (env.iosNotInstalled) return 'needs-install';
  if (!env.Notification || !env.serviceWorker) return 'unsupported';
  if (env.Notification.permission === 'denied') return 'denied';
  return 'supported';
}

/** The VAPID key (base64url) as the bytes `pushManager.subscribe` wants. */
export function vapidKeyBytes(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function toInput(sub: SubscriptionLike, userAgent: string | null): SubscriptionInput | null {
  const j = sub.toJSON();
  const p256dh = j.keys?.p256dh;
  const auth = j.keys?.auth;
  if (!sub.endpoint || !p256dh || !auth) return null;
  return { endpoint: sub.endpoint, keys: { p256dh, auth }, userAgent: userAgent ? userAgent.slice(0, 300) : null };
}

async function manager(env: PushEnv): Promise<PushManagerLike | null> {
  try {
    const reg = await env.serviceWorker?.ready;
    return reg?.pushManager ?? null;
  } catch {
    return null;
  }
}

export async function currentSubscription(env: PushEnv): Promise<SubscriptionLike | null> {
  const pm = await manager(env);
  return pm ? await pm.getSubscription().catch(() => null) : null;
}

export type SubscribeOutcome =
  | { ok: true; input: SubscriptionInput }
  | { ok: false; reason: 'unsupported' | 'denied' | 'needs-install' | 'no-key' | 'failed' };

/** Call from a click handler only. Asks permission, then subscribes this browser. */
export async function subscribeThisDevice(env: PushEnv, vapidPublicKey: string | null, userAgent: string | null): Promise<SubscribeOutcome> {
  const support = pushSupport(env);
  if (support !== 'supported') return { ok: false, reason: support };
  if (!vapidPublicKey) return { ok: false, reason: 'no-key' };
  try {
    const perm = env.Notification!.permission === 'granted' ? 'granted' : await env.Notification!.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'denied' };
    const pm = await manager(env);
    if (!pm) return { ok: false, reason: 'unsupported' };
    const sub = (await pm.getSubscription()) ?? (await pm.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidPublicKey) }));
    const input = toInput(sub, userAgent);
    return input ? { ok: true, input } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Unsubscribe this browser; returns the endpoint to remove server-side (or null). */
export async function unsubscribeThisDevice(env: PushEnv): Promise<string | null> {
  const sub = await currentSubscription(env);
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  return endpoint;
}
