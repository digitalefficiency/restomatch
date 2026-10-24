import {
  and,
  discrepancies,
  eq,
  gte,
  inArray,
  invoiceLines,
  invoices,
  isNotNull,
  lt,
  ne,
  or,
  isNull,
  priceHistory,
  products,
  sql,
  type Database,
} from '@restomatch/db';
import { unitConversionFactor } from '@restomatch/matching';

/** Look-back window for "your usual price" (same as the leak baselines). */
export const DOCK_PRICE_WINDOW_DAYS = 90;
/** Fewer observations than this → no context at all (a wrong % is worse than none). */
export const DOCK_PRICE_MIN_SAMPLES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DockPriceContextLine {
  invoiceLineId: string;
  productId: string;
  /** The line's billed unit; `usualUnitPrice` is per this unit. */
  unit: string;
  billedUnitPrice: number;
  /** Median price paid this supplier for the product over the window, in the line's unit. */
  usualUnitPrice: number;
  /** (billed − usual) / usual — display only, never fed into leak math. */
  pctVsUsual: number;
  samples: number;
  /** The matcher flagged this line PRICE_HIGHER (false before matching runs). */
  priceHigher: boolean;
}

/**
 * "Your usual price" for each mapped line of an invoice: the p50 of what this
 * restaurant paid THIS supplier for the product over the 90 days before the
 * invoice (the invoice's own price_history rows excluded). Read-only.
 *
 * `price_history` is stored per the product's default unit (see
 * writePriceHistoryForInvoice); the median is converted back to the line's
 * unit with the same factor, and a non-convertible unit yields no context.
 *
 * Returns [] for an invoice that is not this restaurant's, has no supplier,
 * or has no line with ≥ DOCK_PRICE_MIN_SAMPLES observations.
 */
export async function dockPriceContext(
  db: Database,
  restaurantId: string,
  invoiceId: string,
  now: Date = new Date(),
): Promise<DockPriceContextLine[]> {
  const [inv] = await db
    .select({ supplierId: invoices.supplierId, invoiceDate: invoices.invoiceDate, createdAt: invoices.createdAt })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv?.supplierId) return [];

  const lines = await db
    .select({
      id: invoiceLines.id,
      productId: invoiceLines.productId,
      unit: invoiceLines.unit,
      unitPriceBilled: invoiceLines.unitPriceBilled,
      defaultUnit: products.defaultUnit,
    })
    .from(invoiceLines)
    .innerJoin(products, and(eq(products.id, invoiceLines.productId), eq(products.restaurantId, restaurantId)))
    .where(and(eq(invoiceLines.invoiceId, invoiceId), isNotNull(invoiceLines.productId)));
  if (lines.length === 0) return [];

  const anchor = inv.invoiceDate ?? inv.createdAt ?? now;
  const since = new Date(anchor.getTime() - DOCK_PRICE_WINDOW_DAYS * DAY_MS);
  const productIds = [...new Set(lines.map((l) => l.productId!))];

  const baselines = await db
    .select({
      productId: priceHistory.productId,
      p50: sql<string>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${priceHistory.unitPrice})`,
      samples: sql<string>`COUNT(*)`,
    })
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.restaurantId, restaurantId),
        eq(priceHistory.supplierId, inv.supplierId),
        inArray(priceHistory.productId, productIds),
        gte(priceHistory.observedAt, since),
        lt(priceHistory.observedAt, anchor),
        or(isNull(priceHistory.sourceInvoiceId), ne(priceHistory.sourceInvoiceId, invoiceId)),
      ),
    )
    .groupBy(priceHistory.productId)
    .having(sql`COUNT(*) >= ${DOCK_PRICE_MIN_SAMPLES}`);
  if (baselines.length === 0) return [];
  const byProduct = new Map(baselines.map((b) => [b.productId, { p50: Number(b.p50), samples: Number(b.samples) }]));

  const flagged = await db
    .select({ invoiceLineId: discrepancies.invoiceLineId })
    .from(discrepancies)
    .innerJoin(invoiceLines, eq(invoiceLines.id, discrepancies.invoiceLineId))
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        eq(invoiceLines.invoiceId, invoiceId),
        eq(discrepancies.type, 'PRICE_HIGHER'),
      ),
    );
  const priceHigher = new Set(flagged.map((f) => f.invoiceLineId));

  const out: DockPriceContextLine[] = [];
  for (const l of lines) {
    const b = byProduct.get(l.productId!);
    const billed = Number(l.unitPriceBilled);
    if (!b || !(b.p50 > 0) || !Number.isFinite(billed) || billed <= 0) continue;
    const factor = !l.defaultUnit || l.defaultUnit === l.unit ? 1 : unitConversionFactor(l.unit, l.defaultUnit);
    if (factor === null) continue;
    const usual = b.p50 * factor;
    out.push({
      invoiceLineId: l.id,
      productId: l.productId!,
      unit: l.unit,
      billedUnitPrice: billed,
      usualUnitPrice: Math.round(usual * 10_000) / 10_000,
      pctVsUsual: (billed - usual) / usual,
      samples: b.samples,
      priceHigher: priceHigher.has(l.id),
    });
  }
  return out;
}
