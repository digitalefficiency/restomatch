import { timingSafeEqual } from 'node:crypto';
import type { Database } from '@restomatch/db';
import {
  INGEST_LIMITS,
  hashIngestToken,
  ingestConfig,
  parseInboundEmail,
  parseIngestToken,
  parseWhatsAppWebhook,
  tokensFromRecipients,
  verifyMetaSignature,
  verifyStandardWebhook,
  type IngestChannelConfig,
  type IngestKind,
  type InboundMessage,
} from '@restomatch/ingest';
import type { RateLimitOptions, RateLimitResult } from '../rateLimit';
import { processInboundMessage, resolveIngestChannel, type InboundOutcome } from './pipeline';

/**
 * Public webhook handlers for /api/ingest/** (framework-free: Request in,
 * Response out, so the attack suite drives them without Next).
 *
 * Order matters — cheap rejections first, and NOTHING is read from the payload
 * before the signature is verified:
 *   1. channel configured (fail closed: no secret ⇒ 503)
 *   2. per-IP rate limit (before reading the body)
 *   3. size limit (Content-Length, then a hard cap while streaming) ⇒ 413
 *   4. HMAC signature over the raw bytes ⇒ 401
 *   5. JSON parse / schema ⇒ 400
 *   6. tenant = hashed token lookup (URL token for WhatsApp, recipient address
 *      for e-mail) ⇒ unknown 404; never a restaurant id from the payload
 *   7. per-channel rate limit ⇒ 429
 *   8. replay: signed timestamp window (e-mail) + unique provider message id
 */
export interface IngestHttpDeps {
  db: Database;
  rateLimit: (identifier: string, opts: RateLimitOptions) => Promise<RateLimitResult>;
  clientIp: string;
  config?: IngestChannelConfig;
  nowSec?: number;
}

export const INGEST_IP_LIMIT: RateLimitOptions = { limit: 120, windowSec: 60, prefix: 'ingest:ip' };
export const INGEST_CHANNEL_LIMIT: RateLimitOptions = { limit: 60, windowSec: 60, prefix: 'ingest:channel' };
/** Meta re-delivers for up to 7 days; older messages are ignored. */
export const WHATSAPP_MAX_AGE_SEC = 7 * 24 * 60 * 60;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

async function readBody(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function safeStrEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function preflight(
  kind: IngestKind,
  req: Request,
  deps: IngestHttpDeps,
): Promise<{ ok: true; cfg: IngestChannelConfig; body: Uint8Array } | { ok: false; res: Response }> {
  const cfg = deps.config ?? ingestConfig(kind);
  if (!cfg.secret) return { ok: false, res: json(503, { error: 'not_configured' }) };
  const ip = await deps.rateLimit(deps.clientIp || 'unknown', INGEST_IP_LIMIT);
  if (!ip.allowed) return { ok: false, res: json(429, { error: 'rate_limited' }) };
  const body = await readBody(req, kind === 'whatsapp' ? INGEST_LIMITS.whatsappBodyBytes : INGEST_LIMITS.emailBodyBytes);
  if (!body) return { ok: false, res: json(413, { error: 'payload_too_large' }) };
  return { ok: true, cfg, body };
}

async function runMessages(
  deps: IngestHttpDeps,
  cfg: IngestChannelConfig,
  tokenHash: string,
  kind: IngestKind,
  messages: InboundMessage[],
  phoneNumberIdCheck: boolean,
): Promise<Response> {
  const channel = await resolveIngestChannel(deps.db, tokenHash);
  if (!channel || channel.kind !== kind) return json(404, { error: 'unknown_channel' });
  const perChannel = await deps.rateLimit(channel.channelId, INGEST_CHANNEL_LIMIT);
  if (!perChannel.allowed) return json(429, { error: 'rate_limited' });

  const now = deps.nowSec ?? Math.floor(Date.now() / 1000);
  const results: Array<{ id: string; outcome: InboundOutcome['status'] }> = [];
  for (const m of messages) {
    // A channel bound to a WhatsApp number only accepts that number's events.
    // The Meta app secret is platform-wide, so the signature does not bind an
    // event to a tenant — the phone_number_id does (mandatory in production).
    const unbound = cfg.requirePhoneNumberId && !channel.phoneNumberId;
    if (phoneNumberIdCheck && (unbound || (channel.phoneNumberId && m.phoneNumberId !== channel.phoneNumberId))) {
      results.push({ id: m.providerMessageId, outcome: 'rejected' });
      continue;
    }
    if (m.kind === 'whatsapp' && (m.sentAtSec === null || now - m.sentAtSec > WHATSAPP_MAX_AGE_SEC)) {
      results.push({ id: m.providerMessageId, outcome: 'rejected' });
      continue;
    }
    const outcome = await processInboundMessage(deps.db, channel, m, cfg.provider);
    // A disabled feature is invisible: same answer as an unknown token.
    if (outcome.status === 'disabled') return json(404, { error: 'unknown_channel' });
    results.push({ id: m.providerMessageId, outcome: outcome.status });
  }
  return json(200, { ok: true, results });
}

/** GET /api/ingest/whatsapp/<token> — Meta's subscription handshake. */
export async function handleWhatsAppVerify(req: Request, token: string, deps: IngestHttpDeps): Promise<Response> {
  const cfg = deps.config ?? ingestConfig('whatsapp');
  if (!cfg.secret || !cfg.verifyToken) return json(503, { error: 'not_configured' });
  const ip = await deps.rateLimit(deps.clientIp || 'unknown', INGEST_IP_LIMIT);
  if (!ip.allowed) return json(429, { error: 'rate_limited' });
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const verify = url.searchParams.get('hub.verify_token') ?? '';
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  const parsed = parseIngestToken(token);
  if (mode !== 'subscribe' || !parsed || parsed.kind !== 'whatsapp' || !safeStrEqual(verify, cfg.verifyToken)) {
    return json(403, { error: 'forbidden' });
  }
  const channel = await resolveIngestChannel(deps.db, hashIngestToken(parsed.token));
  if (!channel || channel.kind !== 'whatsapp' || !/^[A-Za-z0-9_-]{1,128}$/.test(challenge)) {
    return json(403, { error: 'forbidden' });
  }
  return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}

/** POST /api/ingest/whatsapp/<token> — WhatsApp Business Cloud API events. */
export async function handleWhatsAppWebhook(req: Request, token: string, deps: IngestHttpDeps): Promise<Response> {
  const pre = await preflight('whatsapp', req, deps);
  if (!pre.ok) return pre.res;
  if (!verifyMetaSignature(pre.body, req.headers.get('x-hub-signature-256'), pre.cfg.secret!)) {
    return json(401, { error: 'bad_signature' });
  }
  let messages: InboundMessage[];
  try {
    messages = parseWhatsAppWebhook(JSON.parse(Buffer.from(pre.body).toString('utf8')));
  } catch {
    return json(400, { error: 'bad_payload' });
  }
  const parsed = parseIngestToken(token);
  if (!parsed || parsed.kind !== 'whatsapp') return json(404, { error: 'unknown_channel' });
  return runMessages(deps, pre.cfg, hashIngestToken(parsed.token), 'whatsapp', messages, true);
}

/** POST /api/ingest/email — inbound e-mail (Resend / Svix-signed; Postmark shape accepted). */
export async function handleEmailWebhook(req: Request, deps: IngestHttpDeps): Promise<Response> {
  const pre = await preflight('email', req, deps);
  if (!pre.ok) return pre.res;
  const h = (name: string) => req.headers.get(`webhook-${name}`) ?? req.headers.get(`svix-${name}`);
  const verified = verifyStandardWebhook({
    id: h('id'),
    timestamp: h('timestamp'),
    signature: h('signature'),
    body: pre.body,
    secret: pre.cfg.secret!,
    ...(deps.nowSec !== undefined ? { nowSec: deps.nowSec } : {}),
  });
  if (!verified.ok) return json(401, { error: verified.reason === 'stale' ? 'stale' : 'bad_signature' });
  let email: ReturnType<typeof parseInboundEmail>;
  try {
    email = parseInboundEmail(JSON.parse(Buffer.from(pre.body).toString('utf8')));
  } catch {
    return json(400, { error: 'bad_payload' });
  }
  // One e-mail CC'd to several restaurants is delivered to each of them.
  const tokens = tokensFromRecipients(email.recipients, pre.cfg.emailDomain).slice(0, 5);
  if (tokens.length === 0) return json(404, { error: 'unknown_channel' });
  let last: Response = json(404, { error: 'unknown_channel' });
  const results: unknown[] = [];
  for (const token of tokens) {
    const res = await runMessages(deps, pre.cfg, hashIngestToken(token), 'email', [email], false);
    if (res.status === 429) return res;
    if (res.status === 200) results.push(...((await res.json()) as { results: unknown[] }).results);
    last = res;
  }
  return results.length > 0 ? json(200, { ok: true, results }) : last;
}
