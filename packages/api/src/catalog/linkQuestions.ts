import { sql, type Database } from '@restomatch/db';
import { normNameSql } from '@restomatch/catalog';

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

/** A learned charge key of this restaurant covers the row (supplier + SKU, or supplier + normalized name). */
export function chargeKeyCovers(rid: string, supplierCol: SQL, skuCol: SQL, rawCol: SQL): SQL {
  return sql`exists (
    select 1 from restaurants ckr, jsonb_array_elements(coalesce(ckr.settings -> 'chargeKeys', '[]'::jsonb)) ck
     where ckr.id = ${rid} and ck ->> 'supplierId' = (${supplierCol})::text
       and case when ${skuCol} is not null then ck ->> 'sku' = ${skuCol}
                else (ck ->> 'sku') is null and ck ->> 'nameKey' = ${normNameSql(rawCol)} end
  )`;
}

/**
 * An order line that is an open question: no product, no SKU, a non-blank
 * description (a blank line never becomes a question — LOW), not a learned
 * charge key. Aliases: pl (po_lines) / po (purchase_orders).
 */
export function poLineIsQuestion(rid: string): SQL {
  return sql`(pl.product_id is null and pl.supplier_sku is null
    and coalesce(btrim(pl.raw_description), '') <> ''
    and not ${chargeKeyCovers(rid, sql`po.supplier_id`, sql`pl.supplier_sku`, sql`pl.raw_description`)})`;
}

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
           ocr_payload = (i.ocr_payload - 'heldPoId') || jsonb_build_object('linkReleasedAt', now()::text)
     where i.restaurant_id = ${rid}
       and i.id in (${sql.join([...new Set(invoiceIds)].map((id) => sql`${id}::uuid`), sql`, `)})
       and i.status = 'parsed'
       and jsonb_typeof(i.ocr_payload -> 'raw' -> 'reviewReasons') = 'array'
       and jsonb_array_length(i.ocr_payload -> 'raw' -> 'reviewReasons') > 0
       and not exists (
         select 1 from jsonb_array_elements_text(i.ocr_payload -> 'raw' -> 'reviewReasons') r(reason)
          where r.reason not in ('unlinked', 'unlinkedPo')
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
export async function pruneAnsweredReasons(db: Database, rid: string, invoiceIds: string[]): Promise<void> {
  if (invoiceIds.length === 0) return;
  const ids = sql.join([...new Set(invoiceIds)].map((id) => sql`${id}::uuid`), sql`, `);
  const drop = (reason: string) => sql`jsonb_set(i.ocr_payload, '{raw,reviewReasons}', coalesce(
      (select jsonb_agg(r) from jsonb_array_elements(i.ocr_payload -> 'raw' -> 'reviewReasons') r where r <> to_jsonb(${reason}::text)),
      '[]'::jsonb))`;
  await db.execute(sql`
    update invoices i set ocr_payload = ${drop('unlinked')}
     where i.restaurant_id = ${rid} and i.id in (${ids}) and i.status = 'parsed'
       and coalesce(i.ocr_payload -> 'raw' -> 'reviewReasons', '[]'::jsonb) ? 'unlinked'
       and not exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.product_id is null and ${IL_NOT_CHARGE})
  `);
  await db.execute(sql`
    update invoices i set ocr_payload = ${drop('unlinkedPo')} - 'heldPoId'
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
  `);
}

/** A learned charge key ("שורת חיוב — לא מוצר" for this supplier + key). */
export interface ChargeKey {
  supplierId: string;
  sku: string | null;
  nameKey: string | null;
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
        sku: typeof o.sku === 'string' ? o.sku : null,
        nameKey: typeof o.nameKey === 'string' ? o.nameKey : null,
        by: typeof o.by === 'string' ? o.by : null,
        at: o.at,
      },
    ];
  });
}

/**
 * The OCR job's pre-mark (round 3): after the lines are written, mark every
 * unlinked line whose (supplier, SKU / normalized name) is a learned charge key
 * as a charge line (jsonb merge, `auto: true`) and audit it. An invoice held
 * only for those lines is released (`released: true` — the caller then chains
 * into the match like any confident scan); held for another reason too, the
 * answered 'unlinked' reason is pruned.
 */
export async function applyLearnedCharges(
  db: Database,
  rid: string,
  invoiceId: string,
): Promise<{ charged: number; released: boolean }> {
  const lines = (await db.execute(sql`
    select il.id, il.line_total, i.supplier_id from invoice_lines il
      join invoices i on i.id = il.invoice_id and i.restaurant_id = ${rid}
     where il.invoice_id = ${invoiceId}::uuid and il.product_id is null and ${IL_NOT_CHARGE}
       and i.supplier_id is not null
       and ${chargeKeyCovers(rid, sql`i.supplier_id`, sql`il.supplier_sku`, sql`il.raw_description`)}
  `)) as unknown as Array<{ id: string; line_total: string; supplier_id: string }>;
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
    // Held only because of these lines → released ('matched') like an answer;
    // held for another reason too → the answered reason is pruned.
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
