import { sql, type Database } from '@restomatch/db';
import { normNameSql } from '@restomatch/catalog';
import { chargeKeyCovers, IL_NOT_CHARGE, poLineIsQuestion } from './linkQuestions';
import type { LinkQueueCandidate, LinkSource } from './linkQueue';

/**
 * W3-10 · loads the "לקשר" queue candidates for ONE restaurant. The same rows
 * G-08's `mapping.unmapped` asks about (same exclusions: charge lines, learned
 * charge keys, the order-question switch), but each group also carries the ₪
 * still unmapped: Σ |line_total| of its unlinked INVOICE lines, as integer
 * agorot computed in SQL NUMERIC (exact, parsed at this boundary). Order lines
 * and price-list review rows count as lines with ₪0 — nothing billed yet.
 *
 * Grouping matches `linkKey`: (supplier, trimmed SKU) for SKU rows, (supplier,
 * normNameSql(raw)) — the SQL twin of normalizeLinkName — otherwise.
 * Every branch is restaurant-scoped on its own table AND via the supplier join.
 */
export async function loadLinkQueueCandidates(
  db: Database,
  rid: string,
  supplierFilter?: string,
): Promise<LinkQueueCandidate[]> {
  const sup = supplierFilter ? sql`and s.id = ${supplierFilter}` : sql``;
  const rows = (await db.execute(sql`
    with lines as (
      select i.supplier_id, nullif(btrim(il.supplier_sku), '') as sku, il.raw_description as raw,
             abs(il.line_total) as amt, coalesce(i.invoice_date, i.created_at) as seen, 'line' as kind
        from invoice_lines il
        join invoices i on i.id = il.invoice_id and i.restaurant_id = ${rid}
       where il.product_id is null and ${IL_NOT_CHARGE}
      union all
      select po.supplier_id, nullif(btrim(pl.supplier_sku), ''), pl.raw_description, 0::numeric, po.created_at, 'line'
        from po_lines pl
        join purchase_orders po on po.id = pl.po_id and po.restaurant_id = ${rid}
       where pl.product_id is null
         and (
           (pl.supplier_sku is not null
             and not ${chargeKeyCovers(rid, sql`po.supplier_id`, sql`pl.supplier_sku`, sql`pl.raw_description`)})
           or ${poLineIsQuestion(rid)}
         )
      union all
      select sci.supplier_id, nullif(btrim(sci.supplier_sku), ''), sci.supplier_name_raw, 0::numeric,
             coalesce(sci.observed_at, sci.created_at), 'import'
        from supplier_catalog_items sci
       where sci.restaurant_id = ${rid} and sci.product_id is null
         and not ${chargeKeyCovers(rid, sql`sci.supplier_id`, sql`sci.supplier_sku`, sql`sci.supplier_name_raw`)}
    )
    select l.kind, s.id as supplier_id, l.sku,
           case when l.sku is null then ${normNameSql(sql`l.raw`)} end as name_key,
           min(btrim(l.raw)) as sample,
           round(sum(l.amt) * 100)::bigint as agorot,
           count(*)::int as n,
           max(l.seen) as seen
      from lines l
      join suppliers s on s.id = l.supplier_id and s.restaurant_id = ${rid} ${sup}
     where l.sku is not null or coalesce(btrim(l.raw), '') <> ''
     group by l.kind, s.id, l.sku, name_key
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const sku = r.sku == null ? null : String(r.sku);
    const source: LinkSource = r.kind === 'import' ? 'import_suggestion' : sku ? 'sku_line' : 'no_sku_line';
    const seen = r.seen instanceof Date ? r.seen : new Date(String(r.seen));
    return {
      source,
      supplierId: String(r.supplier_id),
      supplierSku: sku,
      nameRaw: r.sample == null ? '' : String(r.sample),
      unmappedAgorot: Number(r.agorot),
      lineCount: Number(r.n),
      lastSeenAt: seen.toISOString(),
      suggestion: null,
    };
  });
}
