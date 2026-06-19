import {
  and,
  eq,
  poLines,
  purchaseOrders,
  sql,
  suppliers,
  type Database,
} from '@restomatch/db';
import { matchByAlias, matchBySku } from '@restomatch/catalog';
import { mulIls, quantizeIls, sumIls, toAgorot } from '@restomatch/matching';
import type { NormalizedPurchaseOrder } from '@restomatch/types';

/** ±₪ slack allowed between the PDF's printed totals and our agorot-exact recompute. */
const CHECKSUM_TOLERANCE_ILS = 1;

export interface ImportPoArgs {
  restaurantId: string;
  normalized: NormalizedPurchaseOrder;
  createdBy?: string | null;
}

export interface ImportPoChecksum {
  /** Σ(lineTotal | unitPrice×qty) reconciles with the printed ex-VAT total. */
  linesSumOk: boolean;
  /** ex-VAT × (1 + vatRate) reconciles with the printed incl-VAT total. */
  vatOk: boolean;
  computedExclVat: number;
  printedExclVat: number | null;
  printedInclVat: number | null;
  vatRate: number | null;
}

export interface ImportPoResult {
  poId: string;
  /** false → an existing PO with the same (platform, sourceRef) was updated. */
  created: boolean;
  supplierId: string;
  /** 'sent' when the checksum passed; 'draft' (needs review) when it failed. */
  status: 'sent' | 'draft';
  lineCount: number;
  mappedCount: number;
  unmappedCount: number;
  checksum: ImportPoChecksum;
}

function metaNum(meta: Record<string, unknown> | undefined, key: string): number | null {
  const v = meta?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function metaStr(meta: Record<string, unknown> | undefined, key: string): string | null {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Per-line ex-VAT contribution: trust the printed line total, else price×qty. */
function lineExclVat(l: NormalizedPurchaseOrder['lines'][number]): number {
  if (typeof l.lineTotal === 'number') return l.lineTotal;
  if (typeof l.unitPrice === 'number') return mulIls(l.unitPrice, l.qty);
  return 0;
}

/**
 * Import a normalized purchase order (e.g. parsed from a Zestt PDF) into the
 * order tables, end to end:
 *   1. Self-validating checksum — Σ lines vs printed ex-VAT, and ex-VAT×(1+VAT)
 *      vs printed incl-VAT, in agorot. A failed checksum lands the PO as a
 *      'draft' for review instead of feeding garbage into matching.
 *   2. Supplier lookup-or-create, scoped to the restaurant (resolve by name;
 *      a Zestt PDF carries no stable platform supplier id).
 *   3. Staged, EXACT-only SKU/alias resolution per line (matchBySku → alias).
 *      Unresolved lines keep supplier_sku + raw description with productId=null
 *      for the mapping UI — never auto-link by fuzzy/embedding, never block.
 *   4. Idempotent upsert on (source_platform, source_ref): re-importing the same
 *      order updates the header and replaces po_lines, never duplicates.
 *
 * Runs inside the manager RLS transaction; every write is restaurant-scoped.
 */
export async function importPurchaseOrder(
  db: Database,
  args: ImportPoArgs,
): Promise<ImportPoResult> {
  const { restaurantId, normalized: po } = args;
  const meta = po.metadata as Record<string, unknown> | undefined;

  // ── 1. Checksum (agorot-exact) ───────────────────────────────────────────
  const computedExclVat = sumIls(po.lines.map(lineExclVat));
  const printedExclVat = po.totalEstimated ?? null;
  const printedInclVat = metaNum(meta, 'totalInclVat');
  const vatRate = metaNum(meta, 'vatRate');
  const tolAgorot = toAgorot(CHECKSUM_TOLERANCE_ILS);

  const linesSumOk =
    printedExclVat == null
      ? true
      : Math.abs(toAgorot(computedExclVat) - toAgorot(printedExclVat)) <= tolAgorot;
  const vatOk =
    printedExclVat == null || printedInclVat == null || vatRate == null
      ? true
      : Math.abs(
          toAgorot(quantizeIls(printedExclVat * (1 + vatRate))) - toAgorot(printedInclVat),
        ) <= tolAgorot;
  const checksum: ImportPoChecksum = {
    linesSumOk,
    vatOk,
    computedExclVat,
    printedExclVat,
    printedInclVat,
    vatRate,
  };
  // A clean import is matchable ('sent'); a failed checksum waits for review.
  const status: 'sent' | 'draft' = linesSumOk && vatOk ? 'sent' : 'draft';

  // ── 2. Supplier lookup-or-create (restaurant-scoped) ──────────────────────
  const supplierName = po.supplierName.trim();
  const supplierId = await resolveSupplier(db, restaurantId, supplierName, vatRate);

  // ── 3. Resolve each line (exact-only, staged) ─────────────────────────────
  const resolved = await Promise.all(
    po.lines.map(async (l) => {
      const sku = l.sku ?? null;
      let productId: string | null = null;
      if (sku) {
        productId = (await matchBySku(db, restaurantId, supplierId, sku))?.productId ?? null;
      }
      if (!productId) {
        productId =
          (await matchByAlias(db, restaurantId, supplierId, l.rawDescription))?.productId ?? null;
      }
      return {
        productId,
        supplierSku: sku,
        rawDescription: l.rawDescription,
        qtyOrdered: l.qty.toString(),
        unit: l.unit,
        unitPriceExpected: typeof l.unitPrice === 'number' ? l.unitPrice.toString() : null,
      };
    }),
  );
  const mappedCount = resolved.filter((r) => r.productId != null).length;

  // ── 4. Idempotent upsert on (source_platform, source_ref) ─────────────────
  const expectedDeliveryAt = po.expectedDeliveryAt ? new Date(po.expectedDeliveryAt) : null;
  const totalEstimated = printedExclVat != null ? printedExclVat.toFixed(2) : null;
  const vatRateStr = vatRate != null ? vatRate.toString() : null;
  const customerRef = metaStr(meta, 'customerOrderRef');
  const buyerName = metaStr(meta, 'buyerName');

  // restaurantId in the lookup is load-bearing: source_ref is only unique per
  // platform account, so two restaurants importing the same Zestt order id must
  // not collide. (po_source_ref_unique is the DB backstop.)
  const [existing] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.restaurantId, restaurantId),
        eq(purchaseOrders.sourcePlatform, 'zestt'),
        eq(purchaseOrders.sourceRef, po.externalId),
      ),
    )
    .limit(1);

  let poId: string;
  let created: boolean;
  if (existing) {
    poId = existing.id;
    created = false;
    await db
      .update(purchaseOrders)
      .set({
        supplierId,
        expectedDeliveryAt,
        status,
        totalEstimated,
        vatRate: vatRateStr,
        customerRef,
        buyerName,
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.restaurantId, restaurantId)));
    await db.delete(poLines).where(eq(poLines.poId, poId));
  } else {
    const [inserted] = await db
      .insert(purchaseOrders)
      .values({
        restaurantId,
        supplierId,
        expectedDeliveryAt,
        status,
        source: 'platform',
        sourcePlatform: 'zestt',
        sourceRef: po.externalId,
        totalEstimated,
        vatRate: vatRateStr,
        customerRef,
        buyerName,
        createdBy: args.createdBy ?? null,
      })
      .returning({ id: purchaseOrders.id });
    if (!inserted) throw new Error('failed to insert purchase order');
    poId = inserted.id;
    created = true;
  }

  if (resolved.length > 0) {
    await db.insert(poLines).values(resolved.map((r) => ({ poId, ...r })));
  }

  return {
    poId,
    created,
    supplierId,
    status,
    lineCount: resolved.length,
    mappedCount,
    unmappedCount: resolved.length - mappedCount,
    checksum,
  };
}

/**
 * Resolve a supplier by restaurant-scoped name, or create one. A Zestt PDF has
 * no stable platform supplier id, so we key on the name within the tenant. New
 * suppliers get external_ref = `${restaurantId}::${name}` to stay unique under
 * the GLOBAL suppliers_external_ref_unique(source_platform, external_ref) index
 * without colliding across tenants.
 */
async function resolveSupplier(
  db: Database,
  restaurantId: string,
  name: string,
  vatRate: number | null,
): Promise<string> {
  const [match] = await db
    .select({ id: suppliers.id, sourcePlatform: suppliers.sourcePlatform, vatRate: suppliers.vatRate })
    .from(suppliers)
    .where(
      and(eq(suppliers.restaurantId, restaurantId), sql`lower(${suppliers.name}) = ${name.toLowerCase()}`),
    )
    .limit(1);

  if (match) {
    // Backfill platform + VAT on an existing manually-added supplier.
    const updates: { sourcePlatform?: 'zestt'; vatRate?: string } = {};
    if (!match.sourcePlatform) updates.sourcePlatform = 'zestt';
    if (match.vatRate == null && vatRate != null) updates.vatRate = vatRate.toString();
    if (Object.keys(updates).length > 0) {
      await db.update(suppliers).set(updates).where(eq(suppliers.id, match.id));
    }
    return match.id;
  }

  const [inserted] = await db
    .insert(suppliers)
    .values({
      restaurantId,
      name,
      sourcePlatform: 'zestt',
      externalRef: `${restaurantId}::${name.toLowerCase()}`,
      vatRate: vatRate != null ? vatRate.toString() : null,
    })
    .returning({ id: suppliers.id });
  if (!inserted) throw new Error('failed to create supplier');
  return inserted.id;
}
