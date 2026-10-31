import { createHash, randomBytes } from 'node:crypto';

/**
 * Per-restaurant ingest tokens.
 *
 * A token is a 128-bit random secret (32 lowercase hex chars) — never a
 * guessable id. It is shown to the owner ONCE (in the WhatsApp webhook URL or as
 * the local part of the inbound e-mail address) and stored only as a SHA-256
 * hash. Lowercase hex survives mail systems that fold the local part's case.
 *
 *   whatsapp → webhook URL  /api/ingest/whatsapp/wa_<hex>
 *   email    → address      inv_<hex>@<INGEST_EMAIL_DOMAIN>
 */
export type IngestKind = 'whatsapp' | 'email';

const PREFIX: Record<IngestKind, string> = { whatsapp: 'wa_', email: 'inv_' };
const TOKEN_RE = /^(wa|inv)_([0-9a-f]{32})$/;

export function generateIngestToken(kind: IngestKind): string {
  return `${PREFIX[kind]}${randomBytes(16).toString('hex')}`;
}

/** Parse a candidate token (case-folded); null when it is not well-formed. */
export function parseIngestToken(raw: string): { kind: IngestKind; token: string } | null {
  const token = raw.trim().toLowerCase();
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  return { kind: m[1] === 'wa' ? 'whatsapp' : 'email', token };
}

/** SHA-256 hex of the canonical token — the only form ever stored. */
export function hashIngestToken(token: string): string {
  return createHash('sha256').update(token.trim().toLowerCase()).digest('hex');
}

/** Last 4 chars, enough for the owner to recognise which token is live. */
export function tokenHint(token: string): string {
  return token.slice(-4);
}
