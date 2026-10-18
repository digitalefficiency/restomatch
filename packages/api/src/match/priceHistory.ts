import {
  and,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  isNotNull,
  matchRuns,
  priceHistory,
  products,
  type Database,
} from '@restomatch/db';
import { unitConversionFactor } from '@restomatch/matching';

/**
 * The `price_history` writer (M1). `computeBaselines` / `computeLeaks` / the
 * leak-detective heatmap all READ price_history, but nothing in production ever
 * WROTE it — so real tenants had no baselines and an empty leak detective.
 *
 * One row per invoice line that is mapped to a product, observed at the
 * invoice date, for the invoice's supplier. Idempotent per invoice: prior rows
 * sourced from this invoice are replaced (safe on re-match / worker retry).
 * Tenant-scoped: every read and write is filtered by restaurant_id.
 *
 * Unit prices are normalized to the product's default unit when the billed
 * unit converts to it (₪/g → ₪/kg), so one product's history is comparable.
 * Lines in a non-convertible unit are skipped rather than polluting the
 * baseline with prices per a different unit. A DUPLICATE invoice is never
 * written (it would double-weight its prices) — pass `skip: true` for that.
 *
 * Returns the number of rows written.
 */
export async function writePriceHistoryForInvoice(
  db: Database,
  restaurantId: string,
  invoiceId: string,
  opts: { skip?: boolean } = {},
): Promise<number> {
  await db
    .delete(priceHistory)
    .where(
      and(eq(priceHistory.restaurantId, restaurantId), eq(priceHistory.sourceInvoiceId, invoiceId)),
    );
  if (opts.skip) return 0;

  const [inv] = await db
    .select({
      supplierId: invoices.supplierId,
      invoiceDate: invoices.invoiceDate,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv?.supplierId) return 0;

  const lines = await db
    .select({
      productId: invoiceLines.productId,
      qtyBilled: invoiceLines.qtyBilled,
      unit: invoiceLines.unit,
      unitPriceBilled: invoiceLines.unitPriceBilled,
      defaultUnit: products.defaultUnit,
    })
    .from(invoiceLines)
    .innerJoin(
      products,
      and(eq(products.id, invoiceLines.productId), eq(products.restaurantId, restaurantId)),
    )
    .where(and(eq(invoiceLines.invoiceId, invoiceId), isNotNull(invoiceLines.productId)));

  const observedAt = inv.invoiceDate ?? inv.createdAt;
  const rows: Array<typeof priceHistory.$inferInsert> = [];
  for (const l of lines) {
    const price = Number(l.unitPriceBilled);
    const qty = Number(l.qtyBilled);
    if (!l.productId || !Number.isFinite(price) || price <= 0) continue;
    const factor = !l.defaultUnit || l.defaultUnit === l.unit ? 1 : unitConversionFactor(l.unit, l.defaultUnit);
    if (factor === null) continue;
    rows.push({
      restaurantId,
      productId: l.productId,
      supplierId: inv.supplierId,
      observedAt,
      unitPrice: (price / factor).toFixed(4),
      qty: Number.isFinite(qty) ? (qty * factor).toFixed(3) : null,
      sourceInvoiceId: invoiceId,
    });
  }
  if (rows.length > 0) await db.insert(priceHistory).values(rows);
  return rows.length;
}

/**
 * Backfill path: (re)write price_history for every already-matched invoice of a
 * restaurant (invoices that have a match run). Idempotent — safe to run again.
 * Invoices whose latest match flagged DUPLICATE_INVOICE are skipped.
 */
export async function backfillPriceHistory(
  db: Database,
  restaurantId: string,
): Promise<{ invoices: number; rows: number }> {
  const matched = await db
    .selectDistinct({ invoiceId: matchRuns.invoiceId })
    .from(matchRuns)
    .where(eq(matchRuns.restaurantId, restaurantId));
  const ids = matched.map((m) => m.invoiceId).filter((id): id is string => !!id);
  if (ids.length === 0) return { invoices: 0, rows: 0 };

  const dupRuns = await db
    .select({ invoiceId: matchRuns.invoiceId })
    .from(discrepancies)
    .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        eq(discrepancies.type, 'DUPLICATE_INVOICE'),
      ),
    );
  const dupInvoiceIds = new Set(dupRuns.map((r) => r.invoiceId).filter((id): id is string => !!id));

  let rows = 0;
  for (const id of ids) {
    rows += await writePriceHistoryForInvoice(db, restaurantId, id, { skip: dupInvoiceIds.has(id) });
  }
  return { invoices: ids.length, rows };
}
