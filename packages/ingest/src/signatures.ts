import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature schemes.
 *
 * WhatsApp Business Cloud API (Meta): `X-Hub-Signature-256: sha256=<hex>` where
 * hex = HMAC-SHA256(app secret, raw request body). Meta signs the exact bytes —
 * verify BEFORE parsing JSON.
 *
 * Inbound e-mail (Resend / Svix "Standard Webhooks"): headers
 * `webhook-id` / `webhook-timestamp` / `webhook-signature` (or the `svix-*`
 * spelling). signature = base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)),
 * sent as a space-separated list of `v1,<base64>` entries (key rotation).
 * The secret is `whsec_<base64>`; the key is the base64-decoded part.
 */

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function toBuffer(body: Uint8Array | string): Buffer {
  return typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
}

export function signMeta(body: Uint8Array | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(toBuffer(body)).digest('hex')}`;
}

export function verifyMetaSignature(
  body: Uint8Array | string,
  header: string | null | undefined,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac('sha256', appSecret).update(toBuffer(body)).digest();
  return safeEqual(Buffer.from(m[1]!.toLowerCase(), 'hex'), expected);
}

function standardKey(secret: string): Buffer {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return Buffer.from(raw, 'base64');
}

export function signStandardWebhook(args: {
  id: string;
  timestampSec: number;
  body: Uint8Array | string;
  secret: string;
}): string {
  const mac = createHmac('sha256', standardKey(args.secret))
    .update(`${args.id}.${args.timestampSec}.`)
    .update(toBuffer(args.body))
    .digest('base64');
  return `v1,${mac}`;
}

export type StandardWebhookResult =
  | { ok: true; id: string; timestampSec: number }
  | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'stale' | 'bad_signature' };

/** Default tolerance: the Standard-Webhooks reference value (5 minutes). */
export const STANDARD_WEBHOOK_TOLERANCE_SEC = 5 * 60;

export function verifyStandardWebhook(args: {
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  body: Uint8Array | string;
  secret: string;
  nowSec?: number;
  toleranceSec?: number;
}): StandardWebhookResult {
  const { id, timestamp, signature } = args;
  if (!id || !timestamp || !signature || !args.secret) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };
  const ts = Number(timestamp);
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (args.toleranceSec ?? STANDARD_WEBHOOK_TOLERANCE_SEC)) {
    return { ok: false, reason: 'stale' };
  }
  const expected = Buffer.from(
    signStandardWebhook({ id, timestampSec: ts, body: args.body, secret: args.secret }).slice(3),
    'base64',
  );
  for (const part of signature.split(' ')) {
    const [version, mac] = part.split(',', 2);
    if (version !== 'v1' || !mac) continue;
    if (safeEqual(Buffer.from(mac, 'base64'), expected)) return { ok: true, id, timestampSec: ts };
  }
  return { ok: false, reason: 'bad_signature' };
}
