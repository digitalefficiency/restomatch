import { sql, type Database } from '@restomatch/db';
import { toPriceUnits } from '../lib/parseMoneyCell';
import type { CurrentCatalogRow } from './importDiff';

/** Days of billed quantity behind "₪/month" in "מה ישתנה". */
export const DIFF_QTY_DAYS = 30;

/** Unit key on both sides: lower case, no quotes / dots / spaces / geresh. */
const unitKey = (col: ReturnType<typeof sql>) =>
  sql`lower(regexp_replace(coalesce(${col}, ''), '[''".\\s׳״]', '', 'g'))`;

/**
 * W3-10 · the supplier's current price-list rows for the "מה ישתנה" preview,
 * each with its price in integer price units and the quantity billed in the
 * last 30 days IN THE SAME UNIT (invoice lines of this supplier linked to the
 * row's product, or carrying its SKU). A line in another unit adds nothing:
 * multiplying a price by another unit's quantity would invent ₪, so such a row
 * shows its change with ₪0/month instead. Restaurant-scoped on every table.
 */
export async function loadCurrentForDiff(db: Database, rid: string, supplierId: string): Promise<CurrentCatalogRow[]> {
  const rows = (await db.execute(sql`
    select sci.id, sci.supplier_sku, sci.supplier_name_raw, sci.list_price, sci.active,
           coalesce((
             select sum(il.qty_billed)
               from invoice_lines il
               join invoices i on i.id = il.invoice_id and i.restaurant_id = ${rid} and i.supplier_id = sci.supplier_id
              where coalesce(i.invoice_date, i.created_at) >= now() - make_interval(days => ${DIFF_QTY_DAYS})
                and ((sci.product_id is not null and il.product_id = sci.product_id)
                  or (sci.supplier_sku is not null and il.supplier_sku = sci.supplier_sku))
                and ${unitKey(sql`il.unit`)} = ${unitKey(sql`sci.unit`)}
           ), 0) as monthly_qty
      from supplier_catalog_items sci
     where sci.restaurant_id = ${rid} and sci.supplier_id = ${supplierId}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    supplierSku: r.supplier_sku == null ? null : String(r.supplier_sku),
    name: String(r.supplier_name_raw),
    priceUnits: r.list_price == null ? null : toPriceUnits(Number(r.list_price)),
    monthlyQty: Number(r.monthly_qty),
    active: r.active === true,
  }));
}
