import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * G-08 · the undo of a "זה אותו מוצר?" answer (mapping.answerLink) is an opaque,
 * server-SIGNED token, never a client-editable id list: a chef can only undo
 * exactly what that same chef's answer changed, in this restaurant, for that
 * (supplier, name key), within UNDO_TTL_MS. Anything else is refused.
 */
export const UNDO_TTL_MS = 2 * 60_000;
/** Above this many changed ids the answer offers no undo (token size bound). */
export const UNDO_MAX_IDS = 500;

export interface AnswerChange {
  productId: string;
  poLineIds: string[];
  invoiceLineIds: string[];
  catalogItemIds: string[];
  aliasId: string | null;
  aliasRestore: { id: string; confidence: string } | null;
}

interface Payload {
  v: 1;
  uid: string;
  rid: string;
  sid: string;
  key: string;
  exp: number;
  ch: AnswerChange;
}

// The app's auth secret when configured; otherwise a per-process secret (dev /
// tests): a token then only verifies on the instance that issued it, which
// fails safe (the undo is refused, nothing is unlinked).
const PROCESS_SECRET = randomBytes(32).toString('hex');
function secret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.AUTH_SECRET || env.NEXTAUTH_SECRET;
  return s && s.length >= 16 ? s : PROCESS_SECRET;
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = (body: string) => b64url(createHmac('sha256', secret()).update(`g08-undo.${body}`).digest());

export function signAnswerUndo(
  who: { userId: string; restaurantId: string },
  target: { supplierId: string; nameKey: string },
  change: AnswerChange,
  now = Date.now(),
): string | null {
  const ids = change.poLineIds.length + change.invoiceLineIds.length + change.catalogItemIds.length;
  if (ids > UNDO_MAX_IDS) return null;
  const payload: Payload = {
    v: 1,
    uid: who.userId,
    rid: who.restaurantId,
    sid: target.supplierId,
    key: target.nameKey,
    exp: now + UNDO_TTL_MS,
    ch: change,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** The change an undo token stands for — or null when forged, expired, or not this user's / restaurant's. */
export function verifyAnswerUndo(
  token: string,
  who: { userId: string; restaurantId: string },
  now = Date.now(),
): { supplierId: string; nameKey: string; change: AnswerChange } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p: Payload;
  try {
    p = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Payload;
  } catch {
    return null;
  }
  if (p.v !== 1 || p.uid !== who.userId || p.rid !== who.restaurantId || !(p.exp > now)) return null;
  return { supplierId: p.sid, nameKey: p.key, change: p.ch };
}
