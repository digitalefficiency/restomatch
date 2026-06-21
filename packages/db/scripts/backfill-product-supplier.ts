/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  RestoMatch — Backfill products.supplier_id (Exclusivity FOUNDATION, Wave 4)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * products.supplier_id was added NULLABLE (migration 0017). This script assigns
 * an owning supplier to every legacy product, using the supplier→product
 * PROVENANCE that already exists in the data. It is the bridge between "scope is
 * inferred from links" (Wave 1) and "scope is the column" (the DEFERRED NOT-NULL
 * flip): once every product has an owner, the matcher's column disjunct becomes
 * authoritative.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SAFETY MODEL  —  DRY-RUN BY DEFAULT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   • With NO flags it WRITES NOTHING. It only reads, classifies every product,
 *     and prints a report (assign / split / needs_owner counts + a sample).
 *   • It mutates the database ONLY when invoked with the explicit `--apply` flag,
 *     and even then refuses to run against an obviously-production URL unless
 *     `--i-understand-this-writes` is ALSO passed (a deliberate second gate).
 *   • This file must NOT be run against prod from the build/CI environment — it
 *     is a human-operated migration tool, like pilot-setup.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  CLASSIFICATION  (per product, per restaurant)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * "Provenance" = a supplier_id observed on a row that points at this product:
 *     supplier_catalog_items, product_aliases (non-null supplier),
 *     price_history (supplier NOT NULL), price_baselines (non-null supplier),
 *     po_lines (via parent purchase_orders.supplier_id),
 *     invoice_lines (via parent invoices.supplier_id),
 *     gr_lines (via po_line → purchase_orders.supplier_id).
 *
 *   ZERO suppliers   → needs_owner. Report only; assign nothing (a human picks).
 *   ONE supplier     → ASSIGN products.supplier_id = that supplier.
 *   MULTIPLE         → SPLIT: keep the ORIGINAL product owned by the primary
 *                      supplier (the one with the most referencing rows; ties
 *                      break by supplier id for determinism), and for EACH OTHER
 *                      supplier CLONE a fresh product row and RE-POINT that
 *                      supplier's dependent rows to the clone — BY EACH ROW'S
 *                      OWN PARENT supplier_id, never by the product's primary.
 *
 * Re-pointed dependent tables on split:
 *     supplier_catalog_items, product_aliases, price_history, price_baselines,
 *     po_lines, invoice_lines, gr_lines.
 *
 *   NEVER re-point a discrepancy whose resolution_status <> 'open' — a resolved
 *   discrepancy is an immutable audit record; moving its product_id would rewrite
 *   history. (We do not re-point discrepancies at all here; this is stated so the
 *   invariant is explicit and any future edit preserves it.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  PHANTOM-BASELINE ASSERTION
 * ─────────────────────────────────────────────────────────────────────────────
 * There is NO "global (null-supplier) baseline cleanup" to perform: price_history
 * .supplier_id is already NOT NULL, so the baseline computation can never emit a
 * null-supplier row. We ASSERT that invariant (count of null-supplier
 * price_baselines == 0) and abort if it is ever violated, instead of carrying
 * dead cleanup code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOW TO RUN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Dry-run (default — writes nothing):
 *       DATABASE_URL=postgres://... pnpm tsx scripts/backfill-product-supplier.ts
 *
 *   Apply (writes; second gate required for prod-looking URLs):
 *       DATABASE_URL=postgres://... pnpm tsx scripts/backfill-product-supplier.ts \
 *         --apply --i-understand-this-writes
 *
 *   Scope to one restaurant:
 *       ... --restaurant=<uuid>
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { createDb, type Database } from '../src/client';
import {
  invoiceLines,
  invoices,
  grLines,
  poLines,
  priceBaselines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  restaurants,
  supplierCatalogItems,
} from '../src/schema';

/* ──────────────────────────────────────────────────────────────────────────
 * Flags
 * ────────────────────────────────────────────────────────────────────────── */

const APPLY = process.argv.includes('--apply');
const PROD_OVERRIDE = process.argv.includes('--i-understand-this-writes');
const restaurantArg = process.argv.find((a) => a.startsWith('--restaurant='));
const ONLY_RESTAURANT = restaurantArg ? restaurantArg.slice('--restaurant='.length) : null;

/** Heuristic: treat URLs that look like a managed/hosted DB as production. */
function looksLikeProd(url: string): boolean {
  return /supabase\.co|supabase\.com|amazonaws\.com|\.rds\.|neon\.tech|render\.com/i.test(url);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Provenance gathering
 * ────────────────────────────────────────────────────────────────────────── */

/** A supplier that has provenance for a product, with how many rows reference it. */
interface SupplierWeight {
  supplierId: string;
  weight: number;
}

/**
 * For every product in a restaurant, collect the set of suppliers that have
 * provenance pointing at it, weighted by the number of referencing rows.
 * Returns a Map<productId, Map<supplierId, weight>>.
 */
async function gatherProvenance(
  db: Database,
  restaurantId: string,
): Promise<Map<string, Map<string, number>>> {
  const acc = new Map<string, Map<string, number>>();
  const add = (productId: string | null, supplierId: string | null, weight: number) => {
    if (!productId || !supplierId) return;
    let inner = acc.get(productId);
    if (!inner) {
      inner = new Map();
      acc.set(productId, inner);
    }
    inner.set(supplierId, (inner.get(supplierId) ?? 0) + weight);
  };

  // supplier_catalog_items: direct (product_id, supplier_id).
  const sci = await db
    .select({
      productId: supplierCatalogItems.productId,
      supplierId: supplierCatalogItems.supplierId,
      n: sql<number>`count(*)::int`,
    })
    .from(supplierCatalogItems)
    .where(
      and(
        eq(supplierCatalogItems.restaurantId, restaurantId),
        isNotNull(supplierCatalogItems.productId),
      ),
    )
    .groupBy(supplierCatalogItems.productId, supplierCatalogItems.supplierId);
  for (const r of sci) add(r.productId, r.supplierId, r.n);

  // product_aliases: (product_id, supplier_id); scoped to this restaurant via the products join.
  const aliases = await db
    .select({
      productId: productAliases.productId,
      supplierId: productAliases.supplierId,
      n: sql<number>`count(*)::int`,
    })
    .from(productAliases)
    .innerJoin(
      products,
      and(eq(products.id, productAliases.productId), eq(products.restaurantId, restaurantId)),
    )
    .where(isNotNull(productAliases.supplierId))
    .groupBy(productAliases.productId, productAliases.supplierId);
  for (const r of aliases) add(r.productId, r.supplierId, r.n);

  // price_history: supplier_id is NOT NULL.
  const ph = await db
    .select({
      productId: priceHistory.productId,
      supplierId: priceHistory.supplierId,
      n: sql<number>`count(*)::int`,
    })
    .from(priceHistory)
    .where(eq(priceHistory.restaurantId, restaurantId))
    .groupBy(priceHistory.productId, priceHistory.supplierId);
  for (const r of ph) add(r.productId, r.supplierId, r.n);

  // price_baselines: supplier_id is nullable; only the supplier-specific ones carry provenance.
  const pb = await db
    .select({
      productId: priceBaselines.productId,
      supplierId: priceBaselines.supplierId,
      n: sql<number>`count(*)::int`,
    })
    .from(priceBaselines)
    .where(and(eq(priceBaselines.restaurantId, restaurantId), isNotNull(priceBaselines.supplierId)))
    .groupBy(priceBaselines.productId, priceBaselines.supplierId);
  for (const r of pb) add(r.productId, r.supplierId, r.n);

  // po_lines → purchase_orders.supplier_id.
  const pol = await db
    .select({
      productId: poLines.productId,
      supplierId: purchaseOrders.supplierId,
      n: sql<number>`count(*)::int`,
    })
    .from(poLines)
    .innerJoin(
      purchaseOrders,
      and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, restaurantId)),
    )
    .where(isNotNull(poLines.productId))
    .groupBy(poLines.productId, purchaseOrders.supplierId);
  for (const r of pol) add(r.productId, r.supplierId, r.n);

  // invoice_lines → invoices.supplier_id (nullable).
  const il = await db
    .select({
      productId: invoiceLines.productId,
      supplierId: invoices.supplierId,
      n: sql<number>`count(*)::int`,
    })
    .from(invoiceLines)
    .innerJoin(
      invoices,
      and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.restaurantId, restaurantId)),
    )
    .where(and(isNotNull(invoiceLines.productId), isNotNull(invoices.supplierId)))
    .groupBy(invoiceLines.productId, invoices.supplierId);
  for (const r of il) add(r.productId, r.supplierId, r.n);

  // gr_lines → po_lines → purchase_orders.supplier_id (a GR line has no direct supplier).
  const grl = await db
    .select({
      productId: grLines.productId,
      supplierId: purchaseOrders.supplierId,
      n: sql<number>`count(*)::int`,
    })
    .from(grLines)
    .innerJoin(poLines, eq(poLines.id, grLines.poLineId))
    .innerJoin(
      purchaseOrders,
      and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, restaurantId)),
    )
    .where(isNotNull(grLines.productId))
    .groupBy(grLines.productId, purchaseOrders.supplierId);
  for (const r of grl) add(r.productId, r.supplierId, r.n);

  return acc;
}

/** Rank suppliers by weight desc, then supplier id asc (deterministic). */
function rankSuppliers(weights: Map<string, number>): SupplierWeight[] {
  return [...weights.entries()]
    .map(([supplierId, weight]) => ({ supplierId, weight }))
    .sort((a, b) => b.weight - a.weight || (a.supplierId < b.supplierId ? -1 : 1));
}

/* ──────────────────────────────────────────────────────────────────────────
 * Apply: split a multi-supplier product (clone per non-primary supplier)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Re-point this supplier's dependent rows (for `productId`) onto `cloneId`.
 * Each table is filtered BY THAT SUPPLIER so a product shared by N suppliers
 * splits cleanly. Resolved discrepancies are intentionally NOT touched.
 */
async function repointSupplierRows(
  db: Database,
  restaurantId: string,
  productId: string,
  supplierId: string,
  cloneId: string,
): Promise<void> {
  await db
    .update(supplierCatalogItems)
    .set({ productId: cloneId })
    .where(
      and(
        eq(supplierCatalogItems.restaurantId, restaurantId),
        eq(supplierCatalogItems.productId, productId),
        eq(supplierCatalogItems.supplierId, supplierId),
      ),
    );

  await db
    .update(productAliases)
    .set({ productId: cloneId })
    .where(and(eq(productAliases.productId, productId), eq(productAliases.supplierId, supplierId)));

  await db
    .update(priceHistory)
    .set({ productId: cloneId })
    .where(
      and(
        eq(priceHistory.restaurantId, restaurantId),
        eq(priceHistory.productId, productId),
        eq(priceHistory.supplierId, supplierId),
      ),
    );

  await db
    .update(priceBaselines)
    .set({ productId: cloneId })
    .where(
      and(
        eq(priceBaselines.restaurantId, restaurantId),
        eq(priceBaselines.productId, productId),
        eq(priceBaselines.supplierId, supplierId),
      ),
    );

  // po_lines: re-point only lines whose parent PO is this supplier's.
  const poIds = (
    await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurantId),
          eq(purchaseOrders.supplierId, supplierId),
        ),
      )
  ).map((r) => r.id);
  if (poIds.length > 0) {
    await db
      .update(poLines)
      .set({ productId: cloneId })
      .where(and(eq(poLines.productId, productId), inArray(poLines.poId, poIds)));
  }

  // invoice_lines: re-point only lines whose parent invoice is this supplier's.
  const invIds = (
    await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.restaurantId, restaurantId), eq(invoices.supplierId, supplierId)))
  ).map((r) => r.id);
  if (invIds.length > 0) {
    await db
      .update(invoiceLines)
      .set({ productId: cloneId })
      .where(and(eq(invoiceLines.productId, productId), inArray(invoiceLines.invoiceId, invIds)));
  }

  // gr_lines: re-point only lines whose po_line's parent PO is this supplier's.
  const poLineIds = (
    poIds.length > 0
      ? await db.select({ id: poLines.id }).from(poLines).where(inArray(poLines.poId, poIds))
      : []
  ).map((r) => r.id);
  if (poLineIds.length > 0) {
    await db
      .update(grLines)
      .set({ productId: cloneId })
      .where(and(eq(grLines.productId, productId), inArray(grLines.poLineId, poLineIds)));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Phantom-baseline assertion
 * ────────────────────────────────────────────────────────────────────────── */

async function assertNoNullSupplierBaselines(db: Database): Promise<void> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(priceBaselines)
    .where(sql`${priceBaselines.supplierId} IS NULL`);
  const n = row?.n ?? 0;
  if (n !== 0) {
    throw new Error(
      `[backfill] INVARIANT VIOLATED: ${n} null-supplier price_baselines exist. ` +
        `price_history.supplier_id is NOT NULL so this should be impossible — ` +
        `investigate before backfilling exclusivity.`,
    );
  }
  console.log('[backfill] phantom-baseline assertion OK (0 null-supplier price_baselines)');
}

/* ──────────────────────────────────────────────────────────────────────────
 * Main
 * ────────────────────────────────────────────────────────────────────────── */

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  if (APPLY && looksLikeProd(url) && !PROD_OVERRIDE) {
    throw new Error(
      '[backfill] DATABASE_URL looks like production and --apply was passed. ' +
        'Re-run with --i-understand-this-writes to confirm, or omit --apply for a dry-run.',
    );
  }

  const db = createDb(url);
  console.log(
    `[backfill] mode=${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}` +
      `${ONLY_RESTAURANT ? ` restaurant=${ONLY_RESTAURANT}` : ' all-restaurants'}`,
  );

  await assertNoNullSupplierBaselines(db);

  const restaurantRows = ONLY_RESTAURANT
    ? await db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants).where(eq(restaurants.id, ONLY_RESTAURANT))
    : await db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants);

  let totalAssign = 0;
  let totalSplit = 0;
  let totalClones = 0;
  let totalNeedsOwner = 0;
  let totalAlreadyOwned = 0;
  const needsOwnerSample: Array<{ restaurant: string; productId: string; name: string }> = [];
  const splitSample: Array<{ productId: string; name: string; suppliers: number }> = [];

  for (const r of restaurantRows) {
    const prods = await db
      .select({
        id: products.id,
        name: products.canonicalName,
        supplierId: products.supplierId,
      })
      .from(products)
      .where(eq(products.restaurantId, r.id));
    if (prods.length === 0) continue;

    const provenance = await gatherProvenance(db, r.id);

    for (const p of prods) {
      if (p.supplierId) {
        // Already owned (e.g. created post-Wave-4 via commit.ts). Leave it.
        totalAlreadyOwned += 1;
        continue;
      }

      const weights = provenance.get(p.id);
      const ranked = weights ? rankSuppliers(weights) : [];

      if (ranked.length === 0) {
        totalNeedsOwner += 1;
        if (needsOwnerSample.length < 25) {
          needsOwnerSample.push({ restaurant: r.name, productId: p.id, name: p.name });
        }
        continue;
      }

      if (ranked.length === 1) {
        const owner = ranked[0]!.supplierId;
        totalAssign += 1;
        if (APPLY) {
          await db
            .update(products)
            .set({ supplierId: owner, updatedAt: new Date() })
            .where(eq(products.id, p.id));
        }
        continue;
      }

      // MULTIPLE suppliers → split. Primary keeps the original product row.
      const [primary, ...others] = ranked;
      totalSplit += 1;
      if (splitSample.length < 25) {
        splitSample.push({ productId: p.id, name: p.name, suppliers: ranked.length });
      }

      if (APPLY) {
        // Original product → owned by primary supplier.
        await db
          .update(products)
          .set({ supplierId: primary!.supplierId, updatedAt: new Date() })
          .where(eq(products.id, p.id));

        // Each other supplier → its own clone, with that supplier's rows re-pointed.
        for (const other of others) {
          const [clone] = await db
            .insert(products)
            .values({
              restaurantId: r.id,
              supplierId: other.supplierId,
              canonicalName: p.name,
              // category/unit/barcode/embedding intentionally NOT copied: a clone
              // is a per-supplier identity; its catalog/alias rows re-point and
              // re-establish those facts. Keeping them empty avoids stamping the
              // primary supplier's barcode onto a different supplier's product.
            })
            .returning({ id: products.id });
          if (!clone) throw new Error('[backfill] failed to insert product clone');
          totalClones += 1;
          await repointSupplierRows(db, r.id, p.id, other.supplierId, clone.id);
        }
      } else {
        totalClones += others.length;
      }
    }
  }

  console.log('');
  console.log('[backfill] ── report ──────────────────────────────────────────');
  console.log(`[backfill] restaurants scanned   : ${restaurantRows.length}`);
  console.log(`[backfill] already owned (skip)   : ${totalAlreadyOwned}`);
  console.log(`[backfill] assign (single owner)  : ${totalAssign}`);
  console.log(`[backfill] split (multi-supplier) : ${totalSplit}  (clones: ${totalClones})`);
  console.log(`[backfill] NEEDS OWNER (no prov.)  : ${totalNeedsOwner}`);
  if (splitSample.length > 0) {
    console.log('[backfill] split sample (≤25):');
    for (const s of splitSample) {
      console.log(`[backfill]   ${s.productId}  ${s.name}  (${s.suppliers} suppliers)`);
    }
  }
  if (needsOwnerSample.length > 0) {
    console.log('[backfill] needs-owner sample (≤25):');
    for (const s of needsOwnerSample) {
      console.log(`[backfill]   [${s.restaurant}] ${s.productId}  ${s.name}`);
    }
  }
  console.log('[backfill] ────────────────────────────────────────────────────');
  console.log(
    APPLY
      ? '[backfill] APPLIED. Review needs-owner products and assign owners by hand.'
      : '[backfill] DRY-RUN complete — nothing written. Re-run with --apply to write.',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] failed', err);
  process.exit(1);
});
