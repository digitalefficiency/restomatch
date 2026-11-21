import { sql, type Database } from '@restomatch/db';
import { aliasProvenance, type LinkProvenance } from '@restomatch/catalog';

/**
 * G-08 · fix #4 — a READ-ONLY report of product links that were probably
 * GUESSED before the link policy existed (catalog-01, pre-W1-10 imports).
 *
 * It lists, for ONE restaurant:
 *   1. price-list items from an import that were linked to a product which
 *      already existed before that import, with a name similarity < 0.9
 *      (a product made from the row itself post-dates the import, so it is
 *      never listed);
 *   2. the aliases learned with them (same supplier + raw name → product);
 *   3. draft / open POs priced from those items, and open price alerts on
 *      the same (supplier, product).
 *
 * It writes NOTHING. Decision 24: a person confirms each unlink after the
 * pilot; there is no unlink here. Money stays as NUMERIC strings / integer
 * agorot — it is formatted only at display (the CLI).
 */

/** Name similarity (pg_trgm) below which a pre-existing product link is suspect. */
export const REMEDIATION_SIMILARITY_MAX = 0.9;
/** PO states still being priced / delivered (not closed or cancelled). */
export const REMEDIATION_OPEN_PO_STATUSES = ['draft', 'sent', 'confirmed', 'partial'] as const;

export interface SuspectItem {
  itemId: string;
  supplierId: string;
  supplierNameRaw: string;
  supplierSku: string | null;
  productId: string;
  canonicalName: string;
  similarity: number;
  importId: string;
  importedAt: string;
  productCreatedAt: string;
  listPrice: string | null;
}

export interface SuspectAlias {
  aliasId: string;
  itemId: string;
  productId: string;
  supplierNameRaw: string;
  supplierSku: string | null;
  confidence: string | null;
  provenance: LinkProvenance;
}

export interface SuspectPoLine {
  poLineId: string;
  poId: string;
  poStatus: string;
  itemId: string;
  productId: string;
  qtyOrdered: string;
  unitPriceExpected: string | null;
  /** qty × expected price, integer agorot (half-up); null when unpriced. */
  lineTotalAgorot: number | null;
}

export interface SuspectPriceAlert {
  alertId: string;
  itemId: string;
  productId: string;
  supplierId: string;
  startPrice: string;
  endPrice: string;
  pctChange: string;
}

export interface AliasRemediationReport {
  restaurantId: string;
  items: SuspectItem[];
  aliases: SuspectAlias[];
  poLines: SuspectPoLine[];
  priceAlerts: SuspectPriceAlert[];
  /** Σ lineTotalAgorot over the listed PO lines (integer agorot). */
  poExposureAgorot: number;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/** NUMERIC(12,3) qty × NUMERIC(12,4) price → integer agorot, half-up, computed in Postgres NUMERIC (exact). */
const LINE_AGOROT = sql`round(pl.qty_ordered * pl.unit_price_expected * 100)::bigint`;

export async function aliasRemediationReport(
  db: Database,
  restaurantId: string,
): Promise<AliasRemediationReport> {
  const items = (await db.execute(sql`
    select sci.id as item_id, sci.supplier_id, sci.supplier_name_raw, sci.supplier_sku,
           p.id as product_id, p.canonical_name,
           similarity(lower(sci.supplier_name_raw), lower(p.canonical_name))::float8 as similarity,
           ci.id as import_id, ci.created_at as imported_at, p.created_at as product_created_at,
           sci.list_price::text as list_price
      from supplier_catalog_items sci
      join catalog_imports ci on ci.id = sci.source_import_id and ci.restaurant_id = ${restaurantId}
      join products p on p.id = sci.product_id and p.restaurant_id = ${restaurantId}
     where sci.restaurant_id = ${restaurantId}
       and p.created_at < ci.created_at
       and similarity(lower(sci.supplier_name_raw), lower(p.canonical_name)) < ${REMEDIATION_SIMILARITY_MAX}
     order by sci.supplier_id, sci.supplier_name_raw, sci.id
  `)) as unknown as Array<Record<string, unknown>>;

  const suspect: SuspectItem[] = items.map((r) => ({
    itemId: String(r.item_id),
    supplierId: String(r.supplier_id),
    supplierNameRaw: String(r.supplier_name_raw),
    supplierSku: (r.supplier_sku as string | null) ?? null,
    productId: String(r.product_id),
    canonicalName: String(r.canonical_name),
    similarity: Number(r.similarity),
    importId: String(r.import_id),
    importedAt: iso(r.imported_at),
    productCreatedAt: iso(r.product_created_at),
    listPrice: (r.list_price as string | null) ?? null,
  }));
  if (suspect.length === 0) {
    return { restaurantId, items: [], aliases: [], poLines: [], priceAlerts: [], poExposureAgorot: 0 };
  }
  const itemIds = suspect.map((i) => i.itemId);
  const itemIdList = sql.join(
    itemIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const openStatuses = sql.join(
    REMEDIATION_OPEN_PO_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );

  // product_aliases has no restaurant_id: tenant scope rides the products join.
  const aliases = (await db.execute(sql`
    select a.id as alias_id, sci.id as item_id, a.product_id, a.supplier_name_raw, a.supplier_sku,
           a.confidence::text as confidence
      from supplier_catalog_items sci
      join product_aliases a
        on a.product_id = sci.product_id
       and a.supplier_id = sci.supplier_id
       and (lower(a.supplier_name_raw) = lower(sci.supplier_name_raw)
            or (sci.supplier_sku is not null and a.supplier_sku = sci.supplier_sku))
      join products p on p.id = a.product_id and p.restaurant_id = ${restaurantId}
     where sci.restaurant_id = ${restaurantId} and sci.id in (${itemIdList})
     order by sci.id, a.id
  `)) as unknown as Array<Record<string, unknown>>;

  const poLines = (await db.execute(sql`
    select distinct on (pl.id) pl.id as po_line_id, po.id as po_id, po.status::text as po_status, sci.id as item_id,
           pl.product_id, pl.qty_ordered::text as qty_ordered,
           pl.unit_price_expected::text as unit_price_expected,
           case when pl.unit_price_expected is null then null else ${LINE_AGOROT} end as line_agorot
      from supplier_catalog_items sci
      join purchase_orders po
        on po.restaurant_id = ${restaurantId}
       and po.supplier_id = sci.supplier_id
       and po.status::text in (${openStatuses})
      join po_lines pl on pl.po_id = po.id and pl.product_id = sci.product_id
     where sci.restaurant_id = ${restaurantId} and sci.id in (${itemIdList})
     order by pl.id, sci.id
  `)) as unknown as Array<Record<string, unknown>>;

  const alerts = (await db.execute(sql`
    select distinct on (pa.id) pa.id as alert_id, sci.id as item_id, pa.product_id, pa.supplier_id,
           pa.start_price::text as start_price, pa.end_price::text as end_price,
           pa.pct_change::text as pct_change
      from supplier_catalog_items sci
      join price_alerts pa
        on pa.restaurant_id = ${restaurantId}
       and pa.product_id = sci.product_id
       and pa.supplier_id = sci.supplier_id
       and pa.status = 'open'
     where sci.restaurant_id = ${restaurantId} and sci.id in (${itemIdList})
     order by pa.id, sci.id
  `)) as unknown as Array<Record<string, unknown>>;

  const lines: SuspectPoLine[] = poLines.map((r) => ({
    poLineId: String(r.po_line_id),
    poId: String(r.po_id),
    poStatus: String(r.po_status),
    itemId: String(r.item_id),
    productId: String(r.product_id),
    qtyOrdered: String(r.qty_ordered),
    unitPriceExpected: (r.unit_price_expected as string | null) ?? null,
    lineTotalAgorot: r.line_agorot == null ? null : Number(r.line_agorot),
  }));

  return {
    restaurantId,
    items: suspect,
    aliases: aliases.map((r) => {
      const confidence = (r.confidence as string | null) ?? null;
      return {
        aliasId: String(r.alias_id),
        itemId: String(r.item_id),
        productId: String(r.product_id),
        supplierNameRaw: String(r.supplier_name_raw),
        supplierSku: (r.supplier_sku as string | null) ?? null,
        confidence,
        provenance: aliasProvenance({ confidence }),
      };
    }),
    poLines: lines,
    priceAlerts: alerts.map((r) => ({
      alertId: String(r.alert_id),
      itemId: String(r.item_id),
      productId: String(r.product_id),
      supplierId: String(r.supplier_id),
      startPrice: String(r.start_price),
      endPrice: String(r.end_price),
      pctChange: String(r.pct_change),
    })),
    poExposureAgorot: lines.reduce((s, l) => s + (l.lineTotalAgorot ?? 0), 0),
  };
}
