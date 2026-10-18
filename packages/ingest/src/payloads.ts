import { z } from 'zod';
import { normalizeEmailAddress } from './senders';
import { parseIngestToken } from './tokens';

/* ──────────────────────────────────────────────────────────────────────────
 * Normalised inbound shapes — what the pipeline consumes, whatever the provider.
 * ────────────────────────────────────────────────────────────────────────── */

export interface InboundAttachment {
  filename: string | null;
  /** DECLARED type (untrusted — the pipeline sniffs the bytes). */
  declaredMime: string | null;
  declaredSize: number | null;
  /** Inline base64 content (Postmark / stub), when the provider sends it. */
  contentBase64?: string;
  /** Provider handle to fetch the bytes (WhatsApp media id / Resend attachment id). */
  providerRef?: string;
}

export interface InboundMessage {
  kind: 'whatsapp' | 'email';
  /** Provider-unique message id (wamid / e-mail id) — the replay key. */
  providerMessageId: string;
  /** Raw sender (phone digits / e-mail address), normalised later. */
  sender: string;
  subject: string | null;
  /** WhatsApp: provider timestamp (seconds); e-mail: null. */
  sentAtSec: number | null;
  /** WhatsApp: the receiving phone_number_id (checked against the channel). */
  phoneNumberId: string | null;
  attachments: InboundAttachment[];
  /**
   * Sender authentication (e-mail SPF/DKIM/DMARC as verified by OUR inbound
   * provider). 'none' = no trustworthy verdict — the default; WhatsApp senders are
   * authenticated by Meta and always carry 'pass'.
   */
  authVerdict: AuthVerdict;
}

export type AuthVerdict = 'pass' | 'fail' | 'none';

/** Remove RFC 5322 comments `( … )` (nested) and quoted strings — attacker-controlled free text. */
function stripCommentsAndQuotes(v: string): string {
  let out = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (c === '\\') {
      i++; // escaped char inside a comment/quote never counts
      continue;
    }
    if (!quoted && c === '(') depth++;
    else if (!quoted && c === ')' && depth > 0) depth--;
    else if (depth === 0 && c === '"') quoted = !quoted;
    else if (depth === 0 && !quoted) out += c;
  }
  return out;
}

/**
 * RFC 8601 Authentication-Results → verdict. ONLY a header stamped with our
 * provider's authserv-id counts (a sender can forge any other). The value is
 * parsed per `;`-separated resinfo with comments and quoted strings removed,
 * and only each resinfo's LEADING `method=result` is read — never a property
 * value like `smtp.mailfrom=dmarc=pass@evil.example`. Only `dmarc=pass` is
 * trusted: DMARC is, by definition, aligned with the From domain the allow-list
 * keys on (SPF/DKIM alone may pass for the attacker's own domain).
 */
export function authVerdictFromHeaders(
  headers: Array<{ name: string; value: string }>,
  trustedAuthServId: string | null | undefined,
): AuthVerdict {
  if (!trustedAuthServId) return 'none';
  const id = trustedAuthServId.trim().toLowerCase();
  const ours = headers
    .filter((h) => h.name.toLowerCase() === 'authentication-results')
    .map((h) => stripCommentsAndQuotes(h.value.toLowerCase()).split(';').map((p) => p.trim()))
    .filter((parts) => parts[0]!.split(/\s+/)[0] === id);
  if (ours.length !== 1) return 'none'; // missing or ambiguous → no trust
  const dmarc = ours[0]!
    .slice(1)
    .map((r) => /^([a-z0-9-]+)\s*=\s*([a-z]+)(?:\s|$)/.exec(r))
    .filter((m): m is RegExpExecArray => m !== null && m[1] === 'dmarc')
    .map((m) => m[2]!);
  if (dmarc.length !== 1) return 'none';
  if (dmarc[0] === 'pass') return 'pass';
  if (dmarc[0] === 'fail' || dmarc[0] === 'permerror') return 'fail';
  return 'none';
}

/* ── WhatsApp Business Cloud API webhook ─────────────────────────────────── */

const WaMedia = z.object({
  id: z.string().min(1).max(128),
  mime_type: z.string().max(255).optional(),
  filename: z.string().max(255).optional(),
  caption: z.string().max(4096).optional(),
});

const WaMessage = z.object({
  from: z.string().min(1).max(32),
  id: z.string().min(1).max(256),
  timestamp: z.string().regex(/^\d{1,12}$/),
  type: z.string().max(32),
  image: WaMedia.optional(),
  document: WaMedia.optional(),
  text: z.object({ body: z.string().max(8192) }).optional(),
});

const WaPayload = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z.object({
                metadata: z.object({ phone_number_id: z.string().max(64) }).partial().optional(),
                messages: z.array(WaMessage).max(50).optional(),
              }).passthrough(),
            }),
          )
          .max(50),
      }),
    )
    .max(50),
});

/**
 * WhatsApp webhook → normalised messages. Status callbacks (delivered/read) and
 * non-message fields yield no messages. Throws ZodError on a malformed body.
 */
export function parseWhatsAppWebhook(json: unknown): InboundMessage[] {
  const payload = WaPayload.parse(json);
  const out: InboundMessage[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      for (const m of change.value.messages ?? []) {
        const media = m.type === 'image' ? m.image : m.type === 'document' ? m.document : undefined;
        out.push({
          kind: 'whatsapp',
          providerMessageId: m.id,
          sender: m.from,
          subject: media?.caption ?? m.text?.body?.slice(0, 200) ?? null,
          sentAtSec: Number(m.timestamp),
          phoneNumberId: change.value.metadata?.phone_number_id ?? null,
          authVerdict: 'pass',
          attachments: media
            ? [
                {
                  filename: media.filename ?? null,
                  declaredMime: media.mime_type ?? null,
                  declaredSize: null,
                  providerRef: media.id,
                },
              ]
            : [],
        });
      }
    }
  }
  return out;
}

/* ── Inbound e-mail (Resend `email.received` or Postmark inbound JSON) ───── */

const ResendAttachment = z.object({
  id: z.string().max(256).optional(),
  filename: z.string().max(255).nullish(),
  content_type: z.string().max(255).nullish(),
  size: z.number().int().nonnegative().nullish(),
  content: z.string().optional(),
});

const ResendPayload = z.object({
  type: z.literal('email.received'),
  data: z.object({
    email_id: z.string().min(1).max(256),
    from: z.string().max(512),
    to: z.array(z.string().max(512)).max(50),
    cc: z.array(z.string().max(512)).max(50).optional(),
    subject: z.string().max(2000).nullish(),
    headers: z.array(z.object({ name: z.string().max(200), value: z.string().max(8192) })).max(200).optional(),
    attachments: z.array(ResendAttachment).max(100).optional(),
  }),
});

const PostmarkPayload = z.object({
  MessageID: z.string().min(1).max(256),
  From: z.string().max(512),
  FromFull: z.object({ Email: z.string().max(512) }).partial().optional(),
  ToFull: z.array(z.object({ Email: z.string().max(512) })).max(50).optional(),
  To: z.string().max(4096).optional(),
  OriginalRecipient: z.string().max(512).optional(),
  Subject: z.string().max(2000).optional(),
  Headers: z.array(z.object({ Name: z.string().max(200), Value: z.string().max(8192) })).max(200).optional(),
  Attachments: z
    .array(
      z.object({
        Name: z.string().max(255).optional(),
        Content: z.string(),
        ContentType: z.string().max(255).optional(),
        ContentLength: z.number().int().nonnegative().optional(),
      }),
    )
    .max(100)
    .optional(),
});

export interface InboundEmail extends InboundMessage {
  recipients: string[];
}

export function parseInboundEmail(json: unknown, opts: { trustedAuthServId?: string | null } = {}): InboundEmail {
  const resend = ResendPayload.safeParse(json);
  if (resend.success) {
    const d = resend.data.data;
    return {
      kind: 'email',
      providerMessageId: d.email_id,
      sender: d.from,
      subject: d.subject ?? null,
      sentAtSec: null,
      phoneNumberId: null,
      authVerdict: authVerdictFromHeaders(d.headers ?? [], opts.trustedAuthServId),
      recipients: [...d.to, ...(d.cc ?? [])],
      attachments: (d.attachments ?? []).map((a) => ({
        filename: a.filename ?? null,
        declaredMime: a.content_type ?? null,
        declaredSize: a.size ?? null,
        ...(a.content !== undefined ? { contentBase64: a.content } : {}),
        ...(a.id ? { providerRef: a.id } : {}),
      })),
    };
  }
  const pm = PostmarkPayload.parse(json);
  const recipients = [
    ...(pm.ToFull?.map((t) => t.Email) ?? (pm.To ? pm.To.split(',') : [])),
    ...(pm.OriginalRecipient ? [pm.OriginalRecipient] : []),
  ];
  return {
    kind: 'email',
    providerMessageId: pm.MessageID,
    sender: pm.FromFull?.Email ?? pm.From,
    subject: pm.Subject ?? null,
    sentAtSec: null,
    phoneNumberId: null,
    authVerdict: authVerdictFromHeaders(
      (pm.Headers ?? []).map((h) => ({ name: h.Name, value: h.Value })),
      opts.trustedAuthServId,
    ),
    recipients,
    attachments: (pm.Attachments ?? []).map((a) => ({
      filename: a.Name ?? null,
      declaredMime: a.ContentType ?? null,
      declaredSize: a.ContentLength ?? null,
      contentBase64: a.Content,
    })),
  };
}

/**
 * The ingest token from the recipient list: the local part of an address
 * (`inv_<hex>@in.example`, plus-addressing `invoices+inv_<hex>@…` too). When
 * `domain` is given, only recipients on that domain count. The token is a
 * secret capability looked up by hash — never a tenant id.
 */
export function tokenFromRecipients(recipients: string[], domain?: string | null): string | null {
  return tokensFromRecipients(recipients, domain)[0] ?? null;
}

/** Every distinct ingest token among the recipients (one e-mail CC'd to two restaurants reaches both). */
export function tokensFromRecipients(recipients: string[], domain?: string | null): string[] {
  const wantDomain = domain?.trim().toLowerCase() || null;
  const out: string[] = [];
  for (const r of recipients) {
    const addr = normalizeEmailAddress(r);
    if (!addr) continue;
    const at = addr.lastIndexOf('@');
    const local = addr.slice(0, at);
    const host = addr.slice(at + 1);
    if (wantDomain && host !== wantDomain) continue;
    const candidate = local.includes('+') ? local.slice(local.lastIndexOf('+') + 1) : local;
    const parsed = parseIngestToken(candidate);
    if (parsed?.kind === 'email' && !out.includes(parsed.token)) out.push(parsed.token);
  }
  return out;
}
