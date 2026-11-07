/**
 * Web Push (VAPID) seam for H-05. No push library is added here: the real
 * `web-push` dependency rides W3-03's single package.json lane, and the
 * subscription table arrives with H-03/H-04. Until both exist there is no push
 * provider and push rows end `skipped_no_provider` (never `sent`).
 *
 * Credentials (Phase-6, human intake): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * VAPID_SUBJECT (`mailto:` or `https:`).
 */

export interface VapidEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** The VAPID config, or null when any part is missing or malformed. */
export function vapidConfig(env: VapidEnv = process.env as VapidEnv): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!B64URL.test(publicKey) || !B64URL.test(privateKey)) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** A browser PushSubscription as stored (toJSON() shape). */
export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Validate a stored subscription; null when it cannot be used. */
export function parsePushSubscription(raw: unknown): PushSubscriptionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof r.endpoint !== 'string') return null;
  let url: URL;
  try {
    url = new URL(r.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const p256dh = r.keys?.p256dh;
  const auth = r.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!B64URL.test(p256dh) || !B64URL.test(auth)) return null;
  return { endpoint: r.endpoint, keys: { p256dh, auth } };
}

/** What the service worker shows. Hebrew-first; no ₪ unless the producer allowed it. */
export interface PushMessage {
  title: string;
  body: string;
  /** Deep link opened on tap (relative to the app origin). */
  url?: string;
  /** Collapses repeats of the same alert on the device. */
  tag?: string;
}

/** Build the push message from an outbox row. */
export function pushMessageFromRow(row: {
  subject: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  dedupeKey?: string | null;
}): PushMessage {
  const deepLink = row.payload?.deepLink;
  return {
    title: row.subject?.trim() || 'RestoMatch',
    // Push bodies are short; the full text lives behind the link.
    body: row.body.length > 180 ? `${row.body.slice(0, 179)}…` : row.body,
    ...(typeof deepLink === 'string' && deepLink.startsWith('/') ? { url: deepLink } : {}),
    ...(row.dedupeKey ? { tag: row.dedupeKey } : {}),
  };
}

/**
 * The real provider (web-push `sendNotification` with the VAPID config) is
 * injected by the caller once the dependency exists. A 404/410 from the push
 * service means the subscription is gone: the provider throws `PushGoneError`
 * and the send path rejects the row without retry.
 */
export interface PushProvider {
  send(sub: PushSubscriptionRecord, message: PushMessage): Promise<{ externalId?: string }>;
}

export class PushGoneError extends Error {
  constructor(readonly status: number) {
    super(`push subscription gone (${status})`);
    this.name = 'PushGoneError';
  }
}
