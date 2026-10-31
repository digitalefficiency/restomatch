import { and, desc, eq, inArray, poLines, products, purchaseOrders, sql, type Database } from '@restomatch/db';
import { orderPriceKey, resolveExpectedPrice, type ExpectedPriceSource } from './expectedPrice';

/**
 * The order guide (W2-06 §5.1, orders-01): what this restaurant usually orders
 * from this supplier, built from the supplier's last 8 POs. Drafts, cancelled
 * orders and walk-ins never count. An item makes the guide when it appears in
 * at least 2 of those 8; its usual quantity is the median of its last 4.
 *
 * No row ever carries an invented qty: the UI shows `usualQty` as a ghost
 * ("בד״כ 5") and starts every line empty until the user taps or types.
 */
export const GUIDE_PO_WINDOW = 8;
export const GUIDE_MIN_APPEARANCES = 2;
export const GUIDE_MEDIAN_OF = 4;

export interface GuideRow {
  /** productId, or `raw:<normalized description>` for an unmapped line. */
  key: string;
  productId: string | null;
  name: string;
  nameEn: string | null;
  unit: string;
  category: string | null;
  usualQty: number;
  lastQty: number;
  /** In how many of the last {@link GUIDE_PO_WINDOW} POs. */
  timesOrdered: number;
  lastOrderedAt: string;
  /** The expected price (contract > last sent > list). Stripped for the receiver. */
  unitPrice: number | null;
  priceSource: ExpectedPriceSource | null;
}

export interface OrderGuide {
  supplierId: string;
  poCount: number;
  rows: GuideRow[];
}

/** The median; for an even count, the mean of the middle two, rounded to 3 dp (qty scale). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return Math.round(m * 1000) / 1000;
}

const normKey = (raw: string) => `raw:${raw.trim().replace(/\s+/g, ' ').toLowerCase()}`;

/** Statuses of an order that was actually placed with the supplier. */
const PLACED = ['sent', 'confirmed', 'partial', 'closed'] as const;

export async function buildOrderGuide(
  db: Database,
  args: { restaurantId: string; supplierId: string; at?: Date },
): Promise<OrderGuide> {
  const pos = await db
    .select({ id: purchaseOrders.id, at: sql<Date>`coalesce(${purchaseOrders.sentAt}, ${purchaseOrders.createdAt})` })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.restaurantId, args.restaurantId),
        eq(purchaseOrders.supplierId, args.supplierId),
        inArray(purchaseOrders.status, [...PLACED]),
        sql`(${purchaseOrders.sourceRef} is null or ${purchaseOrders.sourceRef} not like 'walk_in:%')`,
      ),
    )
    .orderBy(desc(sql`coalesce(${purchaseOrders.sentAt}, ${purchaseOrders.createdAt})`), desc(purchaseOrders.id))
    .limit(GUIDE_PO_WINDOW);
  if (pos.length === 0) return { supplierId: args.supplierId, poCount: 0, rows: [] };

  const rank = new Map(pos.map((p, i) => [p.id, i] as const)); // 0 = newest
  const atOf = new Map(pos.map((p) => [p.id, new Date(p.at)] as const));
  const lines = await db
    .select({
      poId: poLines.poId,
      productId: poLines.productId,
      rawDescription: poLines.rawDescription,
      qty: poLines.qtyOrdered,
      unit: poLines.unit,
    })
    .from(poLines)
    .where(inArray(poLines.poId, pos.map((p) => p.id)));

  type Acc = { productId: string | null; raw: string; unit: string; byPo: Map<string, number> };
  const acc = new Map<string, Acc>();
  // Newest PO first, so the first line seen sets the unit and the wording.
  lines.sort((x, y) => (rank.get(x.poId) ?? 99) - (rank.get(y.poId) ?? 99));
  for (const l of lines) {
    const raw = l.rawDescription?.trim() ?? '';
    if (!l.productId && !raw) continue;
    const key = l.productId ?? normKey(raw);
    const a = acc.get(key) ?? { productId: l.productId, raw, unit: l.unit, byPo: new Map() };
    // Two lines of one item on one PO add up.
    a.byPo.set(l.poId, (a.byPo.get(l.poId) ?? 0) + Number(l.qty));
    acc.set(key, a);
  }

  const kept = [...acc.entries()].filter(([, a]) => a.byPo.size >= GUIDE_MIN_APPEARANCES);
  const productIds = kept.map(([, a]) => a.productId).filter((id): id is string => !!id);
  const meta = new Map<string, { name: string; nameEn: string | null; category: string | null }>();
  if (productIds.length > 0) {
    const rows = await db
      .select({ id: products.id, name: products.canonicalName, nameEn: products.nameEn, category: products.category })
      .from(products)
      .where(and(eq(products.restaurantId, args.restaurantId), inArray(products.id, productIds)));
    for (const r of rows) meta.set(r.id, { name: r.name, nameEn: r.nameEn, category: r.category });
  }

  const priceable = kept
    .filter(([, a]) => !!a.productId)
    .map(([, a]) => ({ productId: a.productId!, unit: a.unit }));
  const prices = await resolveExpectedPrice(db, {
    restaurantId: args.restaurantId,
    supplierId: args.supplierId,
    at: args.at ?? new Date(),
    lines: priceable,
  });

  const rows: GuideRow[] = kept.map(([key, a]) => {
    const ordered = [...a.byPo.entries()].sort((x, y) => (rank.get(x[0]) ?? 99) - (rank.get(y[0]) ?? 99));
    const m = a.productId ? meta.get(a.productId) : undefined;
    const price = a.productId ? prices.get(orderPriceKey(a.productId, a.unit)) : undefined;
    return {
      key,
      productId: a.productId,
      name: m?.name ?? a.raw,
      nameEn: m?.nameEn ?? null,
      unit: a.unit,
      category: m?.category ?? null,
      usualQty: median(ordered.slice(0, GUIDE_MEDIAN_OF).map(([, q]) => q)),
      lastQty: ordered[0]![1],
      timesOrdered: a.byPo.size,
      lastOrderedAt: atOf.get(ordered[0]![0])!.toISOString(),
      unitPrice: price?.unitPrice ?? null,
      priceSource: price?.source ?? null,
    };
  });
  // Grouped by category (uncategorised last), then most-ordered, then name.
  rows.sort(
    (x, y) =>
      (x.category === null ? 1 : 0) - (y.category === null ? 1 : 0) ||
      (x.category ?? '').localeCompare(y.category ?? '', 'he') ||
      y.timesOrdered - x.timesOrdered ||
      x.name.localeCompare(y.name, 'he'),
  );
  return { supplierId: args.supplierId, poCount: pos.length, rows };
}
