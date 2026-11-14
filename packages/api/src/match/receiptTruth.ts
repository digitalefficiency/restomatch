import type { SQLWrapper } from 'drizzle-orm';
import { sql } from '@restomatch/db';

/**
 * Receipt truth (G-04): what the 3-way match, the consolidated cross-match and the
 * stock / ledger readers may treat as "received". ONE definition, used everywhere:
 *
 * - a goods receipt counts only once it is CLOSED (`completed` / `partial`) — a
 *   pending receipt is a receiver still at the door (W1-06 autosaves every tap);
 * - a gr_line counts only once someone COUNTED it — W1-06 creates every line
 *   eagerly at 0/0 and an undo writes 0/0 back, so "the row exists" is never a count;
 * - a PO is matchable / pinnable unless it is a `draft` (a walk-in's retro PO before
 *   the manager confirms it) or `cancelled`. A `closed` platform PO (MarketMan /
 *   Zester sync it closed before the invoice arrives) still matches.
 *
 * The SQL helpers take the table ALIAS so they work in Drizzle builders (default:
 * the table name, as Drizzle renders it) and in raw `db.execute(sql…)` queries
 * (`closedReceiptSql('gr')`, `countedLineSql('gl')`).
 */

type SqlFragment = ReturnType<typeof sql>;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A quoted SQL identifier for an alias / table name (validated: never user input). */
function ident(alias: string): SqlFragment {
  if (!IDENT.test(alias)) throw new Error(`receiptTruth: bad SQL alias ${JSON.stringify(alias)}`);
  return sql.raw(`"${alias}"`);
}

// ── Receipts ──────────────────────────────────────────────────────────────────

/** Goods-receipt statuses whose counts are final enough to match against. */
export const RECEIPT_CLOSED = ['completed', 'partial'] as const;
export type ClosedReceiptStatus = (typeof RECEIPT_CLOSED)[number];
export const isReceiptClosed = (status: string | null | undefined): status is ClosedReceiptStatus =>
  (RECEIPT_CLOSED as readonly string[]).includes(status ?? '');

/** `<gr>.status IN ('completed','partial')`. */
export const closedReceiptSql = (gr = 'goods_receipts'): SqlFragment =>
  sql`${ident(gr)}."status" IN ('completed', 'partial')`;

// ── Counted lines ─────────────────────────────────────────────────────────────

/**
 * Which marker says "counted". `interim` reads the W1-06 shape (quantities, a
 * reason, the `damaged` / `count:<method>` tokens in condition_notes); `counted_at`
 * reads G-03's durable `gr_lines.counted_at` column. Switch with this ONE constant
 * once G-03 is deployed — never a runtime probe per query.
 */
export const COUNTED_MARKER: 'interim' | 'counted_at' = 'interim';

/**
 * The count-method tokens W1-06 stores in condition_notes (`_count.ts` METHOD_RE).
 * `bulk_as_ordered` is decision 20's "all arrived" attestation: it IS a count.
 */
export const COUNT_METHODS = ['bulk_as_ordered', 'spot_check', 'per_line'] as const;

/**
 * Postgres twin of `_count.ts` METHOD_RE `/\bcount:(…)\b/`. JS `\b` is an ASCII
 * word boundary, so it is spelled out with ASCII classes (Postgres `\y` would treat
 * Hebrew letters as word characters and disagree).
 */
const METHOD_PG = `(^|[^A-Za-z0-9_])count:(${COUNT_METHODS.join('|')})([^A-Za-z0-9_]|$)`;

/**
 * `<gl>` was counted. Interim ≡ `fromGrLine` (apps/web/app/dashboard/receiving/
 * [poId]/_count.ts) exactly: received > 0, or rejected > 0, or any reject reason,
 * or a note starting `damaged`, or a `count:<method>` token. (The quantities are
 * NUMERIC(12,3), so `> 0` is the client's `> 0.0005`.) A free-text note alone on
 * an untouched row is NOT a count.
 */
export function countedLineSql(gl = 'gr_lines'): SqlFragment {
  const t = ident(gl);
  if (COUNTED_MARKER === 'counted_at') return sql`${t}."counted_at" IS NOT NULL`;
  return sql`(${t}."qty_received" > 0 OR ${t}."qty_rejected" > 0 OR ${t}."reject_reason" IS NOT NULL OR coalesce(${t}."condition_notes", '') ~ '^damaged' OR coalesce(${t}."condition_notes", '') ~ ${sql.raw(`'${METHOD_PG}'`)})`;
}

// ── POs ───────────────────────────────────────────────────────────────────────

/** PO statuses that never enter the match: a draft (unconfirmed) or a cancelled order. */
export const PO_UNMATCHABLE = ['draft', 'cancelled'] as const;
/** PO statuses discovery may match an invoice against (`closed` included: the Zester case). */
export const PO_MATCHABLE = ['sent', 'confirmed', 'partial', 'closed'] as const;
/** PO statuses a re-match may stay pinned to. Same set as PO_MATCHABLE, named for its use. */
export const PO_PINNABLE = PO_MATCHABLE;
export type MatchablePoStatus = (typeof PO_MATCHABLE)[number];
export const isPoMatchable = (status: string | null | undefined): status is MatchablePoStatus =>
  (PO_MATCHABLE as readonly string[]).includes(status ?? '');
export const isPoPinnable = isPoMatchable;

/** `<po>.status NOT IN ('draft','cancelled')`. */
export const poMatchableSql = (po = 'purchase_orders'): SqlFragment =>
  sql`${ident(po)}."status" NOT IN ('draft', 'cancelled')`;
export const poPinnableSql = poMatchableSql;

// ── Delivery-note numbers ─────────────────────────────────────────────────────

/**
 * ONE normalisation of a delivery-note number (like an invoice number): a `ת.מ.` /
 * `ת״מ` / `ת"מ` prefix dropped, letters and digits only, upper-case, leading zeros
 * dropped — `ת.מ. 007702` = `7702`. Null when nothing is left.
 */
export function normalizeDeliveryNoteNumber(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw)
    .toUpperCase()
    .replace(/^\s*ת\s*[.״"׳']?\s*מ\s*[.״"׳']?\s*/, '')
    .replace(/^\s*DN\s*#?\s*/, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/^0+/, '');
  return s.length > 0 ? s : null;
}

/** The note prefix in free text: `ת.מ.`, `ת.מ`, `ת"מ`, `ת״מ` (a mark between ת and מ is required: `תמר` is a date). */
const HE_PREFIX = String.raw`(?<![א-ת])ת\s*[.״"׳']\s*מ(?![א-ת])\s*[.״"׳']?`;
const DN_PREFIX = String.raw`\bDN\b`;
const NUM = String.raw`\s*#?\s*(\d[0-9A-Za-z]*)`;
const NOTE_RE = new RegExp(`(?:${HE_PREFIX}|${DN_PREFIX})${NUM}`, 'i');
/** A RANGE ("ת.מ. 61036-61043", "61036 עד 61043") — a month line: it bills the pool. */
const RANGE_RE = new RegExp(`(?:${HE_PREFIX}|${DN_PREFIX})\\s*#?\\s*\\d+\\s*(?:[-–—]|עד|to)\\s*\\d+`, 'i');
/** A LIST ("ת.מ. 61036, 61037", "61036/61037", "61036 ו-61037") — also the pool. */
const LIST_RE = new RegExp(`(?:${HE_PREFIX}|${DN_PREFIX})\\s*#?\\s*\\d+\\s*(?:[,،;/]|ו-?)\\s*\\d+`, 'i');

/**
 * The ONE delivery-note number named in free text (an invoice line, a receipt's
 * notes), normalised; null for none, a range or a list (those bill the month's pool).
 */
export function deliveryNoteNumberIn(text: string | null | undefined): string | null {
  if (!text) return null;
  if (RANGE_RE.test(text) || LIST_RE.test(text)) return null;
  const m = NOTE_RE.exec(text);
  return m ? normalizeDeliveryNoteNumber(m[1]!) : null;
}

/** Postgres twins of the patterns (ARE has the same look-around; `''` is a quote inside the literal). */
const NOTE_PG_HE = `(?<![א-ת])ת\\s*[.״"׳'']\\s*מ(?![א-ת])\\s*[.״"׳'']?\\s*#?\\s*([0-9][0-9A-Za-z]*)`;
const NOTE_PG_DN = `(?<![A-Za-z0-9_])[Dd][Nn](?![A-Za-z0-9_])\\s*#?\\s*([0-9][0-9A-Za-z]*)`;

/** The SQL twin of {@link normalizeDeliveryNoteNumber} over an already-extracted token. */
const normalizeSql = (token: SqlFragment): SqlFragment =>
  sql`nullif(regexp_replace(regexp_replace(upper(${token}), '[^[:alnum:]]', '', 'g'), '^0+', ''), '')`;

/**
 * The delivery-note number in a text column (a receipt's `notes`: `ת.מ. <n>`),
 * normalised exactly like {@link deliveryNoteNumberIn}. `col` is a column
 * reference (`goodsReceipts.notes`, or `sql\`gr.notes\`` in raw SQL).
 */
export function deliveryNoteNumberSql(col: SQLWrapper): SqlFragment {
  const he = sql`(regexp_match(${col}, ${sql.raw(`'${NOTE_PG_HE}'`)}))[1]`;
  const dn = sql`(regexp_match(${col}, ${sql.raw(`'${NOTE_PG_DN}'`)}))[1]`;
  return sql`${normalizeSql(sql`coalesce(${he}, ${dn})`)}`;
}
