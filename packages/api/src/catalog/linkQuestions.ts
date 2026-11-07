import { sql, type Database } from '@restomatch/db';
import { normNameSql, normalizeLinkName } from '@restomatch/catalog';
import { resolveTolerances } from '@restomatch/matching';
import { killed } from '../lib/features';

type SQL = ReturnType<typeof sql>;

/**
 * G-08 · the ONE set of "is this line an open question?" rules, shared by the
 * mapping router, the match-invoice job, match.runForInvoice and the OCR job.
 *
 * Charge lines (review M-2): an invoice line an owner / manager answered
 * "שורת חיוב — לא מוצר" (deposit, delivery, discount) is listed in its invoice's
 * `ocr_payload.chargeLineIds` (with `chargeLines: [{id, by, at}]` for the
 * audit trail). It is no longer a question, never holds the invoice and never
 * reaches the engine (buildMatchInput).
 *
 * Charge keys (round 3): the answer is learned per restaurant in
 * `restaurants.settings.chargeKeys: [{supplierId, sku, nameKey, by, at}]` —
 * the same key is a charge next week too (the OCR job pre-marks such lines),
 * and an order / price-list line of that key is no longer a question either.
 */

/** Not a charge line of its invoice. Aliases: il (invoice_lines) / i (invoices). */
export const IL_NOT_CHARGE = sql.raw(`not (coalesce(i.ocr_payload -> 'chargeLineIds', '[]'::jsonb) ? il.id::text)`);

/** The same rule on an `invoice_lines` row in a one-table UPDATE (no aliases). */
export const NOT_CHARGE_ROW = sql.raw(
  `not exists (select 1 from invoices ci where ci.id = "invoice_lines"."invoice_id" and coalesce(ci.ocr_payload -> 'chargeLineIds', '[]'::jsonb) ? "invoice_lines"."id"::text)`,
);

/**
 * A learned charge key of this restaurant covers the row: the same supplier,
 * and the same SKU AND normalized name (a SKU key never covers a line that reads
 * like something else — round 4), or for a name key the same normalized name.
 * Amounts are checked in JS by applyLearnedCharges (withinChargeRange).
 */
export function chargeKeyCovers(
  rid: string,
  supplierCol: SQL,
  skuCol: SQL,
  rawCol: SQL,
): SQL {
  return sql`exists (
    select 1 from restaurants ckr, jsonb_array_elements(coalesce(ckr.settings -> 'chargeKeys', '[]'::jsonb)) ck
     where ckr.id = ${rid} and ck ->> 'supplierId' = (${supplierCol})::text
       and case when ${skuCol} is not null
                then ck ->> 'sku' = ${skuCol} and (ck ->> 'nameKey') is not null and ck ->> 'nameKey' = ${normNameSql(rawCol)}
                else (ck ->> 'sku') is null and ck ->> 'nameKey' = ${normNameSql(rawCol)} end
  )`;
}

/**
 * An order line that is an open question: no product, no SKU, a non-blank
 * description (a blank line never becomes a question — LOW), not a learned
 * charge key. Aliases: pl (po_lines) / po (purchase_orders).
 */
export function poLineIsQuestion(rid: string): SQL {
  // The order-question kill switch (G-08 round 8, default ON): FEATURES_OFF=orderQuestions
  // for every tenant, or settings.features.orderQuestions = false for one (live, no deploy).
  if (killed('orderQuestions')) return sql`false`;
  return sql`(${ORDER_QUESTIONS_ON(rid)} and pl.product_id is null and pl.supplier_sku is null
    and coalesce(btrim(pl.raw_description), '') <> ''
    and not ${chargeKeyCovers(rid, sql`po.supplier_id`, sql`pl.supplier_sku`, sql`pl.raw_description`)})`;
}

/** settings.features.orderQuestions is not false for this restaurant. */
const ORDER_QUESTIONS_ON = (rid: string) =>
  sql`coalesce((select oqr.settings -> 'features' ->> 'orderQuestions' from restaurants oqr where oqr.id = ${rid}), 'true') <> 'false'`;

/** How many open questions an order still has (restaurant-scoped). M-4 hold + runForInvoice. */
export async function orderQuestionCount(db: Database, rid: string, poId: string): Promise<number> {
  const [r] = (await db.execute(sql`
    select count(*)::int as n from po_lines pl
      join purchase_orders po on po.id = pl.po_id and po.restaurant_id = ${rid}
     where pl.po_id = ${poId}::uuid and ${poLineIsQuestion(rid)}
  `)) as unknown as Array<{ n: number }>;
  return Number(r?.n ?? 0);
}

/** Unlinked, non-charge lines of an invoice (restaurant-scoped). M-3. */
export async function invoiceQuestionCount(db: Database, rid: string, invoiceId: string): Promise<number> {
  const [r] = (await db.execute(sql`
    select count(*)::int as n from invoice_lines il
      join invoices i on i.id = il.invoice_id and i.restaurant_id = ${rid}
     where il.invoice_id = ${invoiceId}::uuid and il.product_id is null and ${IL_NOT_CHARGE}
  `)) as unknown as Array<{ n: number }>;
  return Number(r?.n ?? 0);
}

/**
 * Round 10: a 'checks' hold (train A's OCR checks) whose only check reason is
 * 'deposit_or_fee_line' is a question too: it is answered once every non-item
 * line the read tagged (deposit / delivery fee) is a charge line — the learned
 * charge pre-mark then releases it like an 'unlinked' hold. Any other check
 * reason (arithmetic, ח״פ, document flags) still needs a person. Alias i.
 */
const DEPOSIT_ONLY_CHECKS = sql.raw(`(
  jsonb_typeof(i.ocr_payload -> 'raw' -> 'checks' -> 'reasons') = 'array'
  and jsonb_array_length(i.ocr_payload -> 'raw' -> 'checks' -> 'reasons') > 0
  and not exists (select 1 from jsonb_array_elements_text(i.ocr_payload -> 'raw' -> 'checks' -> 'reasons') c(reason)
                   where c.reason <> 'deposit_or_fee_line')
  and jsonb_array_length(coalesce(i.ocr_payload -> 'chargeLineIds', '[]'::jsonb)) >= (
        select count(*) from jsonb_array_elements(coalesce(i.ocr_payload -> 'raw' -> 'reconciled' -> 'lines', '[]'::jsonb)) l
         where coalesce(l ->> 'lineKind', 'item') <> 'item'))`);

/**
 * Release a question hold (G-08): an invoice held ONLY for questions (reasons ⊆
 * unlinked / unlinkedPo, not a duplicate, never matched) once none of its lines —
 * nor of the order it waited for — is a question. Sets 'matched' and
 * `linkReleasedAt`, drops `heldPoId`. Returns the released ids with the
 * receipt each was scanned on (raw.scanGrId).
 */
export async function releaseQuestionHolds(
  db: Database,
  rid: string,
  invoiceIds: string[],
): Promise<Array<{ id: string; scanGrId: string | null }>> {
  if (invoiceIds.length === 0) return [];
  const rows = (await db.execute(sql`
    update invoices i
       set status = 'matched',
           -- Round 9 HIGH: the order it waited for stays its pin (linkPinPoId), so the
           -- release's match is against THAT order even once it is closed.
           ocr_payload = (i.ocr_payload - 'heldPoId') || jsonb_build_object('linkReleasedAt', now()::text)
             || case when (i.ocr_payload ->> 'heldPoId') is not null
                     then jsonb_build_object('linkPinPoId', i.ocr_payload ->> 'heldPoId') else '{}'::jsonb end
     where i.restaurant_id = ${rid}
       and i.id in (${sql.join([...new Set(invoiceIds)].map((id) => sql`${id}::uuid`), sql`, `)})
       and i.status = 'parsed'
       and jsonb_typeof(i.ocr_payload -> 'raw' -> 'reviewReasons') = 'array'
       and jsonb_array_length(i.ocr_payload -> 'raw' -> 'reviewReasons') > 0
       and not exists (
         select 1 from jsonb_array_elements_text(i.ocr_payload -> 'raw' -> 'reviewReasons') r(reason)
          where r.reason not in ('unlinked', 'unlinkedPo')
            and not (r.reason = 'checks' and ${DEPOSIT_ONLY_CHECKS})
       )
       and (i.ocr_payload -> 'raw' -> 'duplicateOf') is null
       and not exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.product_id is null and ${IL_NOT_CHARGE})
       and not exists (select 1 from match_runs mr where mr.invoice_id = i.id and mr.restaurant_id = ${rid})
       and (
         (i.ocr_payload ->> 'heldPoId') is null
         or not exists (
           select 1 from po_lines pl
             join purchase_orders po on po.id = pl.po_id and po.restaurant_id = ${rid}
            where pl.po_id = (i.ocr_payload ->> 'heldPoId')::uuid and ${poLineIsQuestion(rid)}
         )
       )
    returning i.id, i.ocr_payload -> 'raw' ->> 'scanGrId' as scan_gr_id
  `)) as unknown as Array<{ id: string; scan_gr_id: string | null }>;
  return rows.map((r) => ({ id: String(r.id), scanGrId: r.scan_gr_id ?? null }));
}

/**
 * Round 3 (stale bucket): an invoice held for ANOTHER reason too (confidence,
 * lowLines, a duplicate) stays held after its questions are answered — prune
 * the answered question reasons so it reads "לבדיקה", not "מחכה לשאלה".
 * 'unlinked' goes once no non-charge line is unlinked; 'unlinkedPo' (and
 * heldPoId) once the order has no question left. Run AFTER releaseQuestionHolds.
 */
export async function pruneAnsweredReasons(db: Database, rid: string, invoiceIds: string[]): Promise<number> {
  if (invoiceIds.length === 0) return 0;
  const ids = sql.join([...new Set(invoiceIds)].map((id) => sql`${id}::uuid`), sql`, `);
  const drop = (reason: string) => sql`jsonb_set(i.ocr_payload, '{raw,reviewReasons}', coalesce(
      (select jsonb_agg(r) from jsonb_array_elements(i.ocr_payload -> 'raw' -> 'reviewReasons') r where r <> to_jsonb(${reason}::text)),
      '[]'::jsonb))`;
  const a = (await db.execute(sql`
    update invoices i set ocr_payload = ${drop('unlinked')}
     where i.restaurant_id = ${rid} and i.id in (${ids}) and i.status = 'parsed'
       and coalesce(i.ocr_payload -> 'raw' -> 'reviewReasons', '[]'::jsonb) ? 'unlinked'
       and not exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.product_id is null and ${IL_NOT_CHARGE})
    returning i.id
  `)) as unknown as Array<{ id: string }>;
  const b = (await db.execute(sql`
    update invoices i set ocr_payload = (${drop('unlinkedPo')} - 'heldPoId')
      || case when (i.ocr_payload ->> 'heldPoId') is not null
              then jsonb_build_object('linkPinPoId', i.ocr_payload ->> 'heldPoId') else '{}'::jsonb end
     where i.restaurant_id = ${rid} and i.id in (${ids}) and i.status = 'parsed'
       and coalesce(i.ocr_payload -> 'raw' -> 'reviewReasons', '[]'::jsonb) ? 'unlinkedPo'
       and (
         (i.ocr_payload ->> 'heldPoId') is null
         or not exists (
           select 1 from po_lines pl
             join purchase_orders po on po.id = pl.po_id and po.restaurant_id = ${rid}
            where pl.po_id = (i.ocr_payload ->> 'heldPoId')::uuid and ${poLineIsQuestion(rid)}
         )
       )
    returning i.id
  `)) as unknown as Array<{ id: string }>;
  // Round 10: how many invoices actually had an answered reason pruned.
  return new Set([...a, ...b].map((r) => String(r.id))).size;
}

/**
 * Round 9 HIGH: the order a question hold waited for (heldPoId while held,
 * linkPinPoId once released) — the match-invoice job pins to it after the
 * receipt's order, so a re-hold / release never loses its order (a closed order
 * is not discovered again).
 */
export function linkPinPoIdOf(ocrPayload: unknown): string | null {
  const p = ocrPayload as { linkPinPoId?: unknown; heldPoId?: unknown } | null | undefined;
  // heldPoId first: the order a hold waits for NOW beats an older pin (round 10).
  const v = typeof p?.heldPoId === 'string' ? p.heldPoId : typeof p?.linkPinPoId === 'string' ? p.linkPinPoId : null;
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/** A learned charge key ("שורת חיוב — לא מוצר" for this supplier + key). */
export interface ChargeKey {
  supplierId: string;
  sku: string | null;
  /** The normalized name — for a SKU key too (a SKU key covers only lines that read the same). */
  nameKey: string | null;
  /** The human label it was answered on (shown in the mapper's learned list). */
  rawName: string | null;
  /**
   * Signed range (agorot) of the line totals a person was SHOWN when answering
   * (round 5): auto-marking needs the same sign and an amount within
   * [min×(1−tol), max×(1+tol)] in magnitude. Null = never auto-marks.
   */
  minAgorot: number | null;
  maxAgorot: number | null;
  by: string | null;
  at: string;
}

/** The restaurant's learned charge keys. */
export async function readChargeKeys(db: Database, rid: string): Promise<ChargeKey[]> {
  const [r] = (await db.execute(sql`
    select coalesce(settings -> 'chargeKeys', '[]'::jsonb) as keys from restaurants where id = ${rid}
  `)) as unknown as Array<{ keys: unknown }>;
  const keys = Array.isArray(r?.keys) ? (r!.keys as unknown[]) : [];
  return keys.flatMap((k) => {
    const o = k as Record<string, unknown>;
    if (typeof o?.supplierId !== 'string' || typeof o.at !== 'string') return [];
    return [
      {
        supplierId: o.supplierId,
        sku: typeof o.sku === 'string' && o.sku.trim() ? o.sku : null, // round 7 LOW-11: '' is no SKU
        nameKey: typeof o.nameKey === 'string' ? o.nameKey : null,
        rawName: typeof o.rawName === 'string' ? o.rawName : null,
        minAgorot: typeof o.minAgorot === 'number' ? o.minAgorot : null,
        maxAgorot: typeof o.maxAgorot === 'number' ? o.maxAgorot : null,
        by: typeof o.by === 'string' ? o.by : null,
        at: o.at,
      },
    ];
  });
}

/** Is a signed amount (agorot) inside a key's learned range, with the same sign? (round 5) */
export function withinChargeRange(amountAg: number, k: Pick<ChargeKey, 'minAgorot' | 'maxAgorot'>, pricePercent: number): boolean {
  if (k.minAgorot == null || k.maxAgorot == null || amountAg === 0) return false;
  const sign = Math.sign(amountAg);
  if (Math.sign(k.minAgorot) !== sign || Math.sign(k.maxAgorot) !== sign) return false;
  const lo = Math.min(Math.abs(k.minAgorot), Math.abs(k.maxAgorot));
  const hi = Math.max(Math.abs(k.minAgorot), Math.abs(k.maxAgorot));
  const a = Math.abs(amountAg);
  return a >= Math.ceil(lo * (1 - pricePercent)) && a <= Math.floor(hi * (1 + pricePercent));
}

/**
 * The OCR job's pre-mark (rounds 3–5): after the lines are written, mark an
 * unlinked line as a charge line (jsonb merge, `auto: true`, audited) only when
 *   - its (supplier, SKU + normalized name, or normalized name) is a learned key;
 *   - its signed amount is within the range a person answered at (+/− the
 *     restaurant's price tolerance) — an inflated or sign-flipped "charge" is a
 *     question;
 *   - it is the FIRST such line of that key on the invoice (a second identical
 *     charge is a question, never hidden);
 *   - the invoice is not a duplicate copy.
 * An invoice held only for those lines is released (`released: true` — the
 * caller then chains into the match); held for another reason too, the
 * answered 'unlinked' reason is pruned.
 */
export async function applyLearnedCharges(
  db: Database,
  rid: string,
  invoiceId: string,
): Promise<{ charged: number; released: boolean }> {
  const [r] = (await db.execute(sql`
    select settings -> 'tolerances' as tol from restaurants where id = ${rid}
  `)) as unknown as Array<{ tol: unknown }>;
  const { pricePercent } = resolveTolerances((r?.tol ?? null) as Parameters<typeof resolveTolerances>[0]);
  const keys = await readChargeKeys(db, rid);
  if (keys.length === 0) return { charged: 0, released: false };
  const candidates = (await db.execute(sql`
    select il.id, il.line_total, il.supplier_sku, il.raw_description, i.supplier_id
      from invoice_lines il
      join invoices i on i.id = il.invoice_id and i.restaurant_id = ${rid}
     where il.invoice_id = ${invoiceId}::uuid and il.product_id is null and ${IL_NOT_CHARGE}
       and i.supplier_id is not null
       and (i.ocr_payload -> 'raw' -> 'duplicateOf') is null
     order by il.id
  `)) as unknown as Array<{ id: string; line_total: string; supplier_sku: string | null; raw_description: string; supplier_id: string }>;
  const used = new Set<number>();
  const lines: typeof candidates = [];
  for (const c of candidates) {
    const nameKey = normalizeLinkName(c.raw_description ?? '');
    const ki = keys.findIndex(
      (k) =>
        k.supplierId === String(c.supplier_id) &&
        (c.supplier_sku || null
          ? (k.sku || null) === c.supplier_sku && k.nameKey === nameKey
          : !(k.sku || null) && k.nameKey === nameKey),
    );
    if (ki < 0 || used.has(ki)) continue; // not a key, or a second line of the same key → a question
    if (!withinChargeRange(Math.round(Number(c.line_total) * 100), keys[ki]!, pricePercent)) continue;
    used.add(ki);
    lines.push(c);
  }
  if (lines.length > 0) {
    const ids = lines.map((l) => String(l.id));
    const meta = ids.map((id) => ({ id, by: null, at: new Date().toISOString(), auto: true }));
    await db.execute(sql`
      update invoices i
         set ocr_payload = coalesce(i.ocr_payload, '{}'::jsonb) || jsonb_build_object(
               'chargeLineIds', coalesce(i.ocr_payload -> 'chargeLineIds', '[]'::jsonb) || to_jsonb(${`{${ids.join(',')}}`}::text[]),
               'chargeLines', coalesce(i.ocr_payload -> 'chargeLines', '[]'::jsonb) || ${JSON.stringify(meta)}::jsonb)
       where i.id = ${invoiceId}::uuid and i.restaurant_id = ${rid}
    `);
    await db.execute(sql`
      insert into audit_log (restaurant_id, user_id, action, entity_type, entity_id, after)
      values (${rid}, null, 'ocr.autoCharge', 'invoice', ${invoiceId}::uuid, ${JSON.stringify({
        supplierId: lines[0]!.supplier_id,
        lineIds: ids,
        lineCount: ids.length,
        chargedIls: sumAbsIls(lines.map((l) => l.line_total)),
      })}::jsonb)
    `);
    const released = (await releaseQuestionHolds(db, rid, [invoiceId])).length > 0;
    if (!released) await pruneAnsweredReasons(db, rid, [invoiceId]);
    return { charged: lines.length, released };
  }
  return { charged: 0, released: false };
}

/** Σ |amount| of NUMERIC strings, exact in agorot. */
export function sumAbsIls(amounts: Array<string | number | null>): number {
  let ag = 0;
  for (const a of amounts) ag += Math.abs(Math.round(Number(a ?? 0) * 100));
  return ag / 100;
}

/**
 * Learn (or widen) a charge key under the restaurant row lock (round 4 LOW-7:
 * no lost update against another settings writer that also locks the row).
 * One entry per (supplier, sku, nameKey); min/maxAgorot keep the signed range of the amounts
 * a person answered "charge" at. Returns whether the key is new, and for a
 * re-answer the range before and after it (sealed into the undo — round 7).
 */
export async function learnChargeKey(
  db: Database,
  rid: string,
  key: { supplierId: string; sku: string | null; nameKey: string | null; rawName: string },
  /** Signed totals (agorot) of the lines the person was SHOWN and answered — never auto-marks (round 5). */
  shownAgorot: number[],
  by: string,
): Promise<{ created: boolean; prevRange: ChargeRange | null; newRange: ChargeRange }> {
  const [row] = (await db.execute(sql`
    select coalesce(settings -> 'chargeKeys', '[]'::jsonb) as keys from restaurants where id = ${rid} for no key update
  `)) as unknown as Array<{ keys: unknown }>;
  const keys = (Array.isArray(row?.keys) ? (row!.keys as Array<Record<string, unknown>>) : []).slice();
  let prevRange: ChargeRange | null = null;
  const i = keys.findIndex((k) => sameChargeKey(k, key));
  const at = new Date().toISOString();
  const shown = shownAgorot.filter((a) => Number.isFinite(a) && a !== 0);
  let newRange: ChargeRange;
  if (i >= 0) {
    // A re-answer widens the range only with the lines it showed.
    const prevMin = num(keys[i]!.minAgorot);
    const prevMax = num(keys[i]!.maxAgorot);
    prevRange = { minAgorot: prevMin, maxAgorot: prevMax };
    const all = [...shown, ...(prevMin != null ? [prevMin] : []), ...(prevMax != null ? [prevMax] : [])];
    newRange = { minAgorot: all.length ? Math.min(...all) : null, maxAgorot: all.length ? Math.max(...all) : null };
    keys[i] = { ...keys[i], ...newRange, rawName: keys[i]!.rawName ?? key.rawName };
  } else {
    newRange = { minAgorot: shown.length ? Math.min(...shown) : null, maxAgorot: shown.length ? Math.max(...shown) : null };
    keys.push({ ...key, ...newRange, by, at });
  }
  await db.execute(sql`
    update restaurants set settings = jsonb_set(settings, '{chargeKeys}', ${JSON.stringify(keys)}::jsonb, true)
     where id = ${rid}
  `);
  return { created: i < 0, prevRange, newRange };
}

/** A charge key's signed range (agorot). */
export interface ChargeRange {
  minAgorot: number | null;
  maxAgorot: number | null;
}
const num = (v: unknown) => (typeof v === 'number' ? v : null);
function sameChargeKey(k: Record<string, unknown>, key: { supplierId: string; sku: string | null; nameKey: string | null }) {
  return k.supplierId === key.supplierId && ((k.sku as string | null) || null) === (key.sku || null) && (k.nameKey ?? null) === key.nameKey;
}

/**
 * Rounds 6–7: the undo of a re-answer puts back ONLY the bounds that answer
 * moved (before → after, from the server-signed undo), and only while the bound
 * still reads what that answer set — a later answer's widening stays. It can
 * only narrow the current range. Returns true when the range changed.
 */
export async function restoreChargeKeyRange(
  db: Database,
  rid: string,
  key: { supplierId: string; sku: string | null; nameKey: string | null },
  before: ChargeRange,
  after: ChargeRange,
): Promise<boolean> {
  const [row] = (await db.execute(sql`
    select coalesce(settings -> 'chargeKeys', '[]'::jsonb) as keys from restaurants where id = ${rid} for no key update
  `)) as unknown as Array<{ keys: unknown }>;
  const keys = (Array.isArray(row?.keys) ? (row!.keys as Array<Record<string, unknown>>) : []).slice();
  const i = keys.findIndex((k) => sameChargeKey(k, key));
  if (i < 0) return false;
  const curMin = num(keys[i]!.minAgorot);
  const curMax = num(keys[i]!.maxAgorot);
  let min = curMin;
  let max = curMax;
  if (before.minAgorot !== after.minAgorot && curMin === after.minAgorot) min = before.minAgorot;
  if (before.maxAgorot !== after.maxAgorot && curMax === after.maxAgorot) max = before.maxAgorot;
  // A half-known range never auto-marks: keep it whole or null.
  if (min == null || max == null) min = max = null;
  if (min === curMin && max === curMax) return false;
  const narrows =
    (min == null && max == null) ||
    (min != null && max != null && curMin != null && curMax != null && min >= curMin && max <= curMax && min <= max);
  if (!narrows) return false;
  keys[i] = { ...keys[i], minAgorot: min, maxAgorot: max };
  await db.execute(sql`
    update restaurants set settings = jsonb_set(settings, '{chargeKeys}', ${JSON.stringify(keys)}::jsonb, true)
     where id = ${rid}
  `);
  return true;
}

/** Forget a learned charge key (under the restaurant row lock). Returns true when one was removed. */
export async function forgetChargeKey(
  db: Database,
  rid: string,
  key: { supplierId: string; sku: string | null; nameKey: string | null },
): Promise<boolean> {
  const [row] = (await db.execute(sql`
    select coalesce(settings -> 'chargeKeys', '[]'::jsonb) as keys from restaurants where id = ${rid} for no key update
  `)) as unknown as Array<{ keys: unknown }>;
  const keys = Array.isArray(row?.keys) ? (row!.keys as Array<Record<string, unknown>>) : [];
  const kept = keys.filter((k) => !sameChargeKey(k, key));
  if (kept.length === keys.length) return false;
  await db.execute(sql`
    update restaurants set settings = jsonb_set(settings, '{chargeKeys}', ${JSON.stringify(kept)}::jsonb, true)
     where id = ${rid}
  `);
  return true;
}

/**
 * Round 4 LOW-8: an undo (link or charge) that leaves a held invoice with an
 * unlinked, non-charge line again puts 'unlinked' back in its review reasons
 * (union), so it is in the "awaiting question" bucket again.
 */
export async function restoreQuestionReason(db: Database, rid: string, invoiceIds: string[]): Promise<void> {
  if (invoiceIds.length === 0) return;
  await db.execute(sql`
    update invoices i
       set ocr_payload = jsonb_set(coalesce(i.ocr_payload, '{}'::jsonb), '{raw}',
             coalesce(i.ocr_payload -> 'raw', '{}'::jsonb) || jsonb_build_object('reviewReasons',
               coalesce(i.ocr_payload -> 'raw' -> 'reviewReasons', '[]'::jsonb) || '["unlinked"]'::jsonb), true)
     where i.restaurant_id = ${rid}
       and i.id in (${sql.join([...new Set(invoiceIds)].map((id) => sql`${id}::uuid`), sql`, `)})
       and i.status = 'parsed'
       and not (coalesce(i.ocr_payload -> 'raw' -> 'reviewReasons', '[]'::jsonb) ? 'unlinked')
       and exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.product_id is null and ${IL_NOT_CHARGE})
  `);
}

/**
 * Round 6 HIGH: the invoices among `ids` the match-invoice job would NOT skip —
 * the same rule as its guard: an invoice held for questions (linkReleasedAt or a
 * question reason) that has an open question line (unlinked, non-charge) keeps
 * its run and decisions until the question is answered, so it is not re-queued.
 * A never-held invoice re-matches as before (catalog-03; it pairs by מק״ט when
 * its order line is SKU-keyed too) — unless its run's order has an open question
 * line (round 7: the job skips that too).
 */
export async function withoutOpenQuestions(db: Database, rid: string, ids: string[]): Promise<string[]> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return [];
  const rows = (await db.execute(sql`
    select i.id from invoices i
     where i.restaurant_id = ${rid} and i.id in (${sql.join(uniq.map((id) => sql`${id}::uuid`), sql`, `)})
       and not (
         (coalesce(i.ocr_payload ? 'linkReleasedAt', false)
           or coalesce(i.ocr_payload -> 'raw' -> 'reviewReasons', '[]'::jsonb) ?| array['unlinked', 'unlinkedPo'])
         and exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.product_id is null and ${IL_NOT_CHARGE})
       )
       -- Round 7 HIGH: nor an invoice whose run is on an order with an open
       -- question line again (the job keeps that run too).
       and not exists (
         select 1 from match_runs mr
           join po_lines pl on pl.po_id = mr.po_id
           join purchase_orders po on po.id = pl.po_id and po.restaurant_id = ${rid}
          where mr.invoice_id = i.id and mr.restaurant_id = ${rid} and ${poLineIsQuestion(rid)}
       )
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}
