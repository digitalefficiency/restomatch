import { restaurants, sql, eq, recoveryEvents, type Database, type RecoveryStatus } from '@restomatch/db';
import { featureEnabled } from '../lib/features';
import { canTransition, stampFor } from '../recovery/lifecycle';
import { signClaimToken, verifyClaimToken, type ClaimLinkClaims } from './token';

/**
 * H-06ʰ — the supplier's reply link for a "מכתב בקשת זיכוי".
 *
 * SECURITY MODEL (copies wave-1 supplierConfirm, minus the DB row)
 *  - The token is signed and stateless (token.ts). `resolveClaimLink` is the ONLY
 *    read that runs before a tenant is known; it reads one restaurants row (the
 *    flag) on the caller's auth connection. Everything else runs inside the
 *    link's withRestaurant() transaction under RLS, with explicit
 *    `restaurant_id` AND `supplier_id` filters on every statement.
 *  - One link = one supplier's letter of one restaurant: the claims in
 *    `letter_sent` whose `letter_sent_at ≤ issuedAt`. Claims sent later need a
 *    new link.
 *  - The supplier can move a line only `letter_sent → acknowledged` ("מאשרים")
 *    or `letter_sent → disputed` ("נבדוק יחד"). The first answer per line wins.
 *    No ₪ is ever written: no amount, no credit, no credit_notes row — a credit
 *    is recorded by the restaurant from the real חשבונית זיכוי.
 *  - The view is a supplier-safe projection: no internal note, no type code, no
 *    status word, nothing about another supplier.
 */

export type ClaimLinkError = 'NOT_FOUND' | 'EXPIRED';
export type ClaimLink = ClaimLinkClaims;

/** Lines one link may show (and one answer may touch). */
export const MAX_LETTER_LINES = 200;
export const MAX_NOTE_CHARS = 500;
export const MAX_CREDIT_NOTE_NUMBER_CHARS = 64;

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));

/**
 * Token → link. Malformed / forged / portal-off / unknown restaurant / `recovery`
 * flag off ⇒ NOT_FOUND (indistinguishable); a genuine link past 72 h ⇒ EXPIRED.
 */
export async function resolveClaimLink(
  adminDb: Database,
  token: string,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; link: ClaimLink } | { ok: false; error: ClaimLinkError }> {
  const v = verifyClaimToken(token, now, env);
  if (!v.ok) return v;
  const [r] = await adminDb
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, v.claims.restaurantId))
    .limit(1);
  if (!r || !featureEnabled(r.settings, 'recovery', env)) return { ok: false, error: 'NOT_FOUND' };
  return { ok: true, link: v.claims };
}

/** The reason a line is in the letter, in partner wording (GLOSSARY §1a/§2). Never a type code. */
export type ClaimLineReason = 'price' | 'quantity' | 'missing' | 'unit' | 'duplicate' | 'vat' | 'total' | 'other';

const REASON_BY_TYPE: Record<string, ClaimLineReason> = {
  PRICE_HIGHER: 'price',
  QTY_SHORT: 'quantity',
  QTY_OVER: 'quantity',
  MISSING_ON_INVOICE: 'missing',
  UNORDERED_ITEM: 'other',
  UNORDERED_ARRIVAL: 'other',
  UNIT_MISMATCH: 'unit',
  DUPLICATE_INVOICE: 'duplicate',
  VAT_MISMATCH: 'vat',
  TOTAL_MISMATCH: 'total',
};

export interface ClaimLetterLine {
  claimId: string;
  invoiceNumber: string | null;
  /** Invoice date, `YYYY-MM-DD` (the restaurant's calendar date). */
  invoiceDate: string | null;
  item: string | null;
  itemEn: string | null;
  reason: ClaimLineReason;
  /** What the letter still asks for on this line: amount − credited, integer agorot. */
  amountAgorot: number;
}

export interface ClaimLetterView {
  restaurantName: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  /** When the letter went out (the earliest `letter_sent_at` among its lines). */
  sentAt: string | null;
  expiresAt: string;
  lines: ClaimLetterLine[];
  totalAgorot: number;
}

function linesSql(link: ClaimLink, extra = sql``) {
  return sql`
    FROM recovery_claims c
    CROSS JOIN (SELECT COALESCE(timezone, 'Asia/Jerusalem') AS tz FROM restaurants WHERE id = ${link.restaurantId}) tz
    JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${link.restaurantId}
    LEFT JOIN invoices i ON i.id = c.invoice_id AND i.restaurant_id = ${link.restaurantId}
    LEFT JOIN products p ON p.id = d.product_id AND p.restaurant_id = ${link.restaurantId}
    LEFT JOIN invoice_lines il ON il.id = d.invoice_line_id AND il.invoice_id = c.invoice_id
    WHERE c.restaurant_id = ${link.restaurantId}
      AND c.supplier_id = ${link.supplierId}
      AND c.status = 'letter_sent'
      AND c.letter_sent_at IS NOT NULL
      AND c.letter_sent_at <= ${link.issuedAt.toISOString()}::timestamptz
      ${extra}
  `;
}

/**
 * The letter as the supplier sees it. `db` must be the link's tenant
 * transaction (withRestaurant). Returns null when the restaurant row is not
 * visible (should not happen after resolveClaimLink).
 */
export async function loadClaimLetter(db: Database, link: ClaimLink): Promise<ClaimLetterView | null> {
  const head = rowsOf(
    await db.execute(sql`
      SELECT r.name AS restaurant_name, s.name AS supplier_name, s.name_en AS supplier_name_en
      FROM restaurants r
      LEFT JOIN suppliers s ON s.id = ${link.supplierId} AND s.restaurant_id = r.id
      WHERE r.id = ${link.restaurantId}
    `),
  )[0];
  if (!head) return null;
  const rows = rowsOf(
    await db.execute(sql`
      SELECT c.id, c.amount_agorot, c.credited_agorot, c.letter_sent_at,
             d.type AS discrepancy_type,
             i.invoice_number, to_char(i.invoice_date AT TIME ZONE tz.tz, 'YYYY-MM-DD') AS invoice_date,
             COALESCE(p.canonical_name, il.raw_description) AS item,
             COALESCE(p.name_en, il.raw_description_en) AS item_en
      ${linesSql(link)}
      ORDER BY i.invoice_date ASC NULLS LAST, i.invoice_number ASC NULLS LAST, c.claimed_at ASC, c.id
      LIMIT ${MAX_LETTER_LINES}
    `),
  );
  let sentAt: Date | null = null;
  const lines: ClaimLetterLine[] = rows
    .map((r) => {
      const sent = r.letter_sent_at ? new Date(r.letter_sent_at as string) : null;
      if (sent && (!sentAt || sent < sentAt)) sentAt = sent;
      return {
        claimId: String(r.id),
        invoiceNumber: (r.invoice_number as string | null) ?? null,
        invoiceDate: (r.invoice_date as string | null) ?? null,
        item: (r.item as string | null) ?? null,
        itemEn: (r.item_en as string | null) ?? null,
        reason: REASON_BY_TYPE[String(r.discrepancy_type)] ?? 'other',
        amountAgorot: Math.max(0, Number(r.amount_agorot) - Number(r.credited_agorot)),
      };
    })
    .filter((l) => l.amountAgorot > 0);
  return {
    restaurantName: String(head.restaurant_name),
    supplierName: (head.supplier_name as string | null) ?? null,
    supplierNameEn: (head.supplier_name_en as string | null) ?? null,
    sentAt: sentAt ? (sentAt as Date).toISOString() : null,
    expiresAt: link.expiresAt.toISOString(),
    lines,
    totalAgorot: lines.reduce((s, l) => s + l.amountAgorot, 0),
  };
}

export type ClaimAnswer = 'agree' | 'check';

export interface ClaimAnswerInput {
  lines: { claimId: string; answer: ClaimAnswer; note?: string | null }[];
  /** The number of the חשבונית זיכוי the supplier says they will issue / issued. Recorded as text only. */
  creditNoteNumber?: string | null;
  note?: string | null;
}

export type ClaimAnswerResult =
  | { ok: true; acknowledged: number; checking: number }
  | { ok: false; error: 'INVALID_LINES' | 'ALREADY_ANSWERED' };

const TARGET: Record<ClaimAnswer, RecoveryStatus> = { agree: 'acknowledged', check: 'disputed' };
const ANSWER_HE: Record<ClaimAnswer, string> = { agree: 'מאשרים', check: 'נבדוק יחד' };

/** Strip control characters (keeps \n) and trim; caps length. */
function clean(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u0009\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '').trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Record the supplier's answer. `db` must be the link's tenant transaction:
 * every line is checked and moved in it, so the answer is all-or-nothing.
 *  - an empty list, a duplicate id, or an id that is not this letter's ⇒ INVALID_LINES;
 *  - a line of this letter that is no longer `letter_sent` ⇒ ALREADY_ANSWERED.
 * The claim's own (internal) `note` is never overwritten: the supplier's words
 * go into the recovery_events row only, with `actor_id` NULL.
 */
export async function submitClaimAnswer(
  db: Database,
  link: ClaimLink,
  input: ClaimAnswerInput,
  now: Date = new Date(),
): Promise<ClaimAnswerResult> {
  const ids = input.lines.map((l) => l.claimId);
  if (ids.length === 0 || ids.length > MAX_LETTER_LINES || new Set(ids).size !== ids.length) {
    return { ok: false, error: 'INVALID_LINES' };
  }
  // Every id must belong to this restaurant + supplier and to this letter
  // (sent ≤ issuedAt), whatever its status now. Locked for the transition.
  const held = rowsOf(
    await db.execute(sql`
      SELECT c.id, c.status
      FROM recovery_claims c
      WHERE c.restaurant_id = ${link.restaurantId}
        AND c.supplier_id = ${link.supplierId}
        AND c.letter_sent_at IS NOT NULL
        AND c.letter_sent_at <= ${link.issuedAt.toISOString()}::timestamptz
        AND c.id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      FOR UPDATE OF c
    `),
  );
  if (held.length !== ids.length) return { ok: false, error: 'INVALID_LINES' };
  if (held.some((h) => h.status !== 'letter_sent')) return { ok: false, error: 'ALREADY_ANSWERED' };

  const creditNo = clean(input.creditNoteNumber, MAX_CREDIT_NOTE_NUMBER_CHARS);
  const general = clean(input.note, MAX_NOTE_CHARS);
  let acknowledged = 0;
  let checking = 0;
  for (const line of input.lines) {
    const to = TARGET[line.answer];
    if (!canTransition('letter_sent', to)) return { ok: false, error: 'INVALID_LINES' };
    const stamp = stampFor(to);
    const parts = [`תשובת הספק בקישור: ${ANSWER_HE[line.answer]}`];
    const own = clean(line.note, MAX_NOTE_CHARS);
    if (own) parts.push(`הערה: ${own}`);
    if (creditNo) parts.push(`מס׳ חשבונית זיכוי: ${creditNo}`);
    if (general) parts.push(`הערה כללית: ${general}`);
    const stampSql =
      stamp === 'acknowledgedAt' ? sql`, acknowledged_at = ${now.toISOString()}::timestamptz` : sql``;
    const res = await db.execute(sql`
      UPDATE recovery_claims SET status = ${to}, updated_at = ${now.toISOString()}::timestamptz ${stampSql}
      WHERE id = ${line.claimId}::uuid
        AND restaurant_id = ${link.restaurantId}
        AND supplier_id = ${link.supplierId}
        AND status = 'letter_sent'
      RETURNING id
    `);
    if (rowsOf(res).length !== 1) throw new Error('claim portal: a locked line changed under the answer');
    await db.insert(recoveryEvents).values({
      restaurantId: link.restaurantId,
      claimId: line.claimId,
      fromStatus: 'letter_sent',
      toStatus: to,
      actorId: null,
      note: parts.join(' · '),
      createdAt: now,
    });
    if (to === 'acknowledged') acknowledged++;
    else checking++;
  }
  return { ok: true, acknowledged, checking };
}

/**
 * Mint the reply link for a supplier's sent letter. `db` must be scoped to
 * `restaurantId` (a member transaction). Returns null when the portal is off,
 * the supplier is not this restaurant's, or nothing of theirs is in
 * `letter_sent`. The raw token is returned once and never stored.
 *
 * NOTE: no tRPC procedure calls this yet — the mint button belongs to the
 * letters screen (W2-10 / W3-11's `routers/recovery.ts`) and the send path to
 * H-05ʰ. Those adopt it with a `coverage/<ID>.ts` entry and a role gate
 * (owner / manager / bookkeeper).
 */
export async function mintClaimLink(
  db: Database,
  restaurantId: string,
  supplierId: string,
  opts: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<{ token: string; expiresAt: Date } | null> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const [row] = rowsOf(
    await db.execute(sql`
      SELECT count(*)::int AS n
      FROM recovery_claims c
      JOIN suppliers s ON s.id = c.supplier_id AND s.restaurant_id = ${restaurantId}
      WHERE c.restaurant_id = ${restaurantId}
        AND c.supplier_id = ${supplierId}
        AND c.status = 'letter_sent'
        AND c.letter_sent_at IS NOT NULL
        AND c.letter_sent_at <= ${now.toISOString()}::timestamptz
    `),
  );
  if (!row || Number(row.n) === 0) return null;
  try {
    const { token, expiresAt } = signClaimToken({ restaurantId, supplierId, now }, env);
    return { token, expiresAt };
  } catch {
    return null;
  }
}

/** Absolute link for a raw token (`/s/c/<token>`). */
export function claimLinkUrl(baseUrl: string, token: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  return `${baseUrl.slice(0, end)}/s/c/${token}`;
}
