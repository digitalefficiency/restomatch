import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  or,
  poLines,
  purchaseOrders,
  sql,
  supplierCatalogItems,
  type Database,
} from '@restomatch/db';
import { contractPricesForOrder, orderPriceKey } from '../contracts/orderPrices';
import { isFeatureOn } from '../lib/featureGate';

/**
 * ONE expected price for an order line (deep-fix class 1, owner decision 21):
 *
 *   contract in force on `at`, converted to the line's unit
 *   > the restaurant's own last explicitly priced PO line
 *   > the supplier's list price.
 *
 * Never the invoice. "Explicitly priced" has no column yet (H-04 proposal:
 * `po_lines.price_source`), so a last-PO price counts only when it comes from
 * a PO the restaurant itself authored and SENT (`source` manual|recurring,
 * status past draft and not cancelled), never an imported one and never a
 * walk-in (`source_ref LIKE 'walk_in:%'`). A last-PO price older than the
 * list price's last update is ignored, so "order again" never brings back a
 * stale price (W1-11.spec "today's prices").
 *
 * Every entry point (createDraft, captureOrderDraft, reorder, the order guide
 * and W2-05's walk-in) calls this, so "מחיר גבוה" means the same ₪ on every
 * path. Read-only; restaurant-scoped in every query.
 */
export type ExpectedPriceSource = 'contract' | 'last_po' | 'list';

export interface ExpectedPrice {
  unitPrice: number;
  source: ExpectedPriceSource;
  /** ISO timestamp the price is "as of" (contract day, PO sent time, list update). */
  asOf: string;
}

export interface ResolveExpectedPriceArgs {
  restaurantId: string;
  supplierId: string;
  at: Date;
  lines: ReadonlyArray<{ productId: string; unit: string }>;
}

/** PO statuses that mean "the restaurant sent this order". */
const SENT_STATUSES = ['sent', 'confirmed', 'partial', 'closed'] as const;
/** PO sources the restaurant authors itself (imports and captures excluded). */
const AUTHORED_SOURCES = ['manual', 'recurring'] as const;

export { orderPriceKey };

export async function resolveExpectedPrice(
  db: Database,
  args: ResolveExpectedPriceArgs,
): Promise<Map<string, ExpectedPrice>> {
  const out = new Map<string, ExpectedPrice>();
  const items = dedupe(args.lines.filter((l) => !!l.productId && !!l.unit));
  if (items.length === 0) return out;
  const productIds = [...new Set(items.map((i) => i.productId))];

  // 1. Contract (flag `contracts`, like every other contract consumer).
  if (await isFeatureOn(db, args.restaurantId, 'contracts')) {
    const contract = await contractPricesForOrder(db, args.restaurantId, args.supplierId, items, args.at);
    for (const [key, unitPrice] of contract) {
      out.set(key, { unitPrice, source: 'contract', asOf: args.at.toISOString() });
    }
  }
  const open = items.filter((i) => !out.has(orderPriceKey(i.productId, i.unit)));
  if (open.length === 0) return out;

  // The list price per (product, unit): an exact unit match wins, then any row.
  const catRows = await db
    .select({
      productId: supplierCatalogItems.productId,
      unit: supplierCatalogItems.unit,
      listPrice: supplierCatalogItems.listPrice,
      active: supplierCatalogItems.active,
      updatedAt: supplierCatalogItems.updatedAt,
    })
    .from(supplierCatalogItems)
    .where(
      and(
        eq(supplierCatalogItems.restaurantId, args.restaurantId),
        eq(supplierCatalogItems.supplierId, args.supplierId),
        inArray(supplierCatalogItems.productId, productIds),
        isNotNull(supplierCatalogItems.listPrice),
      ),
    )
    .orderBy(desc(supplierCatalogItems.active), desc(supplierCatalogItems.updatedAt));
  const listFor = (productId: string, unit: string) => {
    const rows = catRows.filter((r) => r.productId === productId && Number(r.listPrice) > 0);
    return rows.find((r) => r.unit === unit) ?? rows[0];
  };

  // 2. The last restaurant-authored, sent, priced PO line before `at`.
  const asOfExpr = sql<Date>`coalesce(${purchaseOrders.sentAt}, ${purchaseOrders.createdAt})`;
  const poRows = await db
    .selectDistinctOn([poLines.productId, poLines.unit], {
      productId: poLines.productId,
      unit: poLines.unit,
      unitPrice: poLines.unitPriceExpected,
      asOf: asOfExpr,
    })
    .from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(
      and(
        eq(purchaseOrders.restaurantId, args.restaurantId),
        eq(purchaseOrders.supplierId, args.supplierId),
        inArray(purchaseOrders.status, [...SENT_STATUSES]),
        inArray(purchaseOrders.source, [...AUTHORED_SOURCES]),
        or(sql`${purchaseOrders.sourceRef} is null`, sql`${purchaseOrders.sourceRef} not like 'walk_in:%'`),
        inArray(
          poLines.productId,
          open.map((o) => o.productId),
        ),
        isNotNull(poLines.unitPriceExpected),
        sql`${poLines.unitPriceExpected} > 0`,
        sql`${asOfExpr} <= ${args.at.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(poLines.productId, poLines.unit, desc(asOfExpr), desc(purchaseOrders.id));
  const lastPo = new Map<string, { unitPrice: number; asOf: Date }>();
  for (const r of poRows) {
    if (!r.productId || r.unitPrice == null) continue;
    lastPo.set(orderPriceKey(r.productId, r.unit), { unitPrice: Number(r.unitPrice), asOf: new Date(r.asOf) });
  }

  for (const it of open) {
    const key = orderPriceKey(it.productId, it.unit);
    const list = listFor(it.productId, it.unit);
    const po = lastPo.get(key);
    const listUpdated = list ? new Date(list.updatedAt) : null;
    if (po && !(listUpdated && listUpdated > po.asOf)) {
      out.set(key, { unitPrice: po.unitPrice, source: 'last_po', asOf: po.asOf.toISOString() });
    } else if (list) {
      out.set(key, { unitPrice: Number(list.listPrice), source: 'list', asOf: listUpdated!.toISOString() });
    }
  }
  return out;
}

function dedupe<T extends { productId: string; unit: string }>(lines: ReadonlyArray<T>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const l of lines) {
    const k = orderPriceKey(l.productId, l.unit);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

// Exported for the walk-in exclusion test and the H-04 proposal text.
export const EXPECTED_PRICE_RULES = { SENT_STATUSES, AUTHORED_SOURCES } as const;
