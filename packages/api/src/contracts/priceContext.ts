import {
  and,
  desc,
  eq,
  gt,
  inArray,
  priceHistory,
  products,
  restaurants,
  supplierContractPrices,
  type Database,
} from '@restomatch/db';
import { contractInForce, localDateKey } from './core';
import { IMPACT_WINDOW_DAYS, medianPrice } from '../priceAlerts/impact';

/**
 * W2-12 contract-entry context: "what you pay today" for one (supplier, product)
 * — the last invoiced price + its date and the 90-day median — and the
 * "lock current prices as contract" write. Restaurant-scoped; the caller asserts
 * supplier/product ownership.
 */

const DAY_MS = 86_400_000;
const DEFAULT_TZ = 'Asia/Jerusalem';

export async function restaurantToday(db: Database, restaurantId: string, now: Date = new Date()): Promise<string> {
  const [r] = await db
    .select({ timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return localDateKey(now, r?.timezone ?? DEFAULT_TZ);
}

export interface PriceContext {
  lastPrice: number | null;
  lastAt: Date | null;
  median90: number | null;
  observations: number;
}

export async function loadPriceContext(
  db: Database,
  restaurantId: string,
  supplierId: string,
  productId: string,
  opts: { now?: Date } = {},
): Promise<PriceContext> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - IMPACT_WINDOW_DAYS * DAY_MS);
  const rows = await db
    .select({ unitPrice: priceHistory.unitPrice, observedAt: priceHistory.observedAt })
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.restaurantId, restaurantId),
        eq(priceHistory.supplierId, supplierId),
        eq(priceHistory.productId, productId),
      ),
    )
    .orderBy(desc(priceHistory.observedAt))
    .limit(500);
  const past = rows.filter((r) => r.observedAt.getTime() <= now.getTime());
  const last = past[0];
  const window = past.filter((r) => r.observedAt.getTime() > since.getTime());
  return {
    lastPrice: last ? Number(last.unitPrice) : null,
    lastAt: last?.observedAt ?? null,
    median90: medianPrice(window.map((r) => r.unitPrice)),
    observations: window.length,
  };
}

export interface LockCandidate {
  productId: string;
  productName: string;
  productNameEn: string | null;
  unit: string | null;
  price: number;
  /** ≈ monthly spend at this price (90-day qty ÷ 3), integer agorot. */
  monthlyAgorot: number;
}

/**
 * Products of `supplierId` with an invoiced price in the last 90 days and NO
 * contract in force today: each one's last invoiced price. A product that
 * already has a contract is never overwritten — locking the billed price over
 * a contract would redefine an over-contract leak as "agreed".
 */
export async function lockCandidates(
  db: Database,
  restaurantId: string,
  supplierId: string,
  opts: { now?: Date } = {},
): Promise<{ today: string; candidates: LockCandidate[] }> {
  const now = opts.now ?? new Date();
  const today = await restaurantToday(db, restaurantId, now);
  const since = new Date(now.getTime() - IMPACT_WINDOW_DAYS * DAY_MS);
  const hist = await db
    .select({
      productId: priceHistory.productId,
      unitPrice: priceHistory.unitPrice,
      qty: priceHistory.qty,
      observedAt: priceHistory.observedAt,
      productName: products.canonicalName,
      productNameEn: products.nameEn,
      unit: products.defaultUnit,
    })
    .from(priceHistory)
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .where(
      and(
        eq(priceHistory.restaurantId, restaurantId),
        eq(priceHistory.supplierId, supplierId),
        gt(priceHistory.observedAt, since),
      ),
    )
    .orderBy(desc(priceHistory.observedAt));
  const byProduct = new Map<string, typeof hist>();
  for (const h of hist) {
    if (h.observedAt.getTime() > now.getTime()) continue;
    const list = byProduct.get(h.productId) ?? [];
    list.push(h);
    byProduct.set(h.productId, list);
  }
  if (byProduct.size === 0) return { today, candidates: [] };
  const contracts = await db
    .select({
      id: supplierContractPrices.id,
      supplierId: supplierContractPrices.supplierId,
      productId: supplierContractPrices.productId,
      unit: supplierContractPrices.unit,
      contractPrice: supplierContractPrices.contractPrice,
      validFrom: supplierContractPrices.validFrom,
      validTo: supplierContractPrices.validTo,
    })
    .from(supplierContractPrices)
    .where(
      and(
        eq(supplierContractPrices.restaurantId, restaurantId),
        eq(supplierContractPrices.supplierId, supplierId),
        inArray(supplierContractPrices.productId, [...byProduct.keys()]),
      ),
    );
  const candidates: LockCandidate[] = [];
  for (const [productId, list] of byProduct) {
    const own = contracts.filter((c) => c.productId === productId);
    // A row starting today counts too (idempotent per day: a re-lock writes nothing new).
    if (contractInForce(own, today) || own.some((c) => c.validFrom > today)) continue;
    const last = list[0]!;
    const price = Number(last.unitPrice);
    if (!(Math.round(price * 10_000) >= 1)) continue;
    const qtyMilli = list.reduce((s, h) => s + (h.qty == null ? 0 : Math.round(Number(h.qty) * 1000)), 0);
    // price units × qtyMilli / (100 × 1000 × 3) → agorot, one half-up rounding.
    const monthlyAgorot = Math.round((Math.round(price * 10_000) * qtyMilli) / 300_000);
    candidates.push({
      productId,
      productName: last.productName,
      productNameEn: last.productNameEn,
      unit: last.unit,
      price,
      monthlyAgorot,
    });
  }
  candidates.sort((a, b) => b.monthlyAgorot - a.monthlyAgorot);
  return { today, candidates };
}

/** Write the candidates as manual contract rows from TODAY (never backdated). */
export async function lockCurrentPrices(
  db: Database,
  args: { restaurantId: string; supplierId: string; userId: string | null; now?: Date },
): Promise<{ today: string; created: number; monthlyAgorot: number }> {
  const { today, candidates } = await lockCandidates(db, args.restaurantId, args.supplierId, { now: args.now });
  let created = 0;
  for (const c of candidates) {
    const rows = await db
      .insert(supplierContractPrices)
      .values({
        restaurantId: args.restaurantId,
        supplierId: args.supplierId,
        productId: c.productId,
        contractPrice: c.price.toFixed(4),
        unit: c.unit,
        validFrom: today,
        validTo: null,
        source: 'manual',
        note: 'נעילת מחיר נוכחי',
        createdBy: args.userId,
      })
      .onConflictDoNothing({
        target: [supplierContractPrices.supplierId, supplierContractPrices.productId, supplierContractPrices.validFrom],
      })
      .returning({ id: supplierContractPrices.id });
    created += rows.length;
  }
  return { today, created, monthlyAgorot: candidates.reduce((s, c) => s + c.monthlyAgorot, 0) };
}

/** Σ qty invoiced per product at `supplierId` over the last 90 days (the ₪/month estimates' basis). */
export async function qty90ByProduct(
  db: Database,
  restaurantId: string,
  supplierId: string,
  opts: { now?: Date } = {},
): Promise<Map<string, number>> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - IMPACT_WINDOW_DAYS * DAY_MS);
  const rows = await db
    .select({ productId: priceHistory.productId, qty: priceHistory.qty, observedAt: priceHistory.observedAt })
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.restaurantId, restaurantId),
        eq(priceHistory.supplierId, supplierId),
        gt(priceHistory.observedAt, since),
      ),
    );
  const milli = new Map<string, number>();
  for (const r of rows) {
    if (r.qty == null || r.observedAt.getTime() > now.getTime()) continue;
    milli.set(r.productId, (milli.get(r.productId) ?? 0) + Math.round(Number(r.qty) * 1000));
  }
  return new Map([...milli].map(([k, v]) => [k, v / 1000]));
}
