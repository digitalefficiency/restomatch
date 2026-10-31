import {
  and,
  catalogImports,
  eq,
  products,
  suppliers,
  supplierCatalogItems,
  type Database,
} from '@restomatch/db';
import {
  matchProductTopN,
  recordConfirmedMatch,
  type EmbeddingProvider,
} from '@restomatch/catalog';
import { areConvertible } from '@restomatch/matching';
import { sameUnit } from '../lib/unitPrice';
import type { CatalogRow } from './parse';

/**
 * Confidence at/above which a row auto-links to an existing product — and only
 * when its unit and pack also fit. Anything less is a suggestion for a person.
 */
const AUTO_LINK = 0.95;
/**
 * Interim provenance: an alias at confidence 1.000 means a PERSON linked it
 * (mapping.confirm, the import review, a catalog edit). A machine link — an
 * automatic match, or a product made from this very row — is stored just below,
 * so a guess is never saved as certainty.
 */
const MACHINE_MAX_CONFIDENCE = 0.999;
/** Floor below which we create a new product instead of linking. */
const REVIEW_FLOOR = 0.6;

export interface CommitArgs {
  restaurantId: string;
  supplierId: string;
  sourceImportId?: string | null;
}

/** Why a suggested link needs a person ("בדיקה"). */
export type ReviewReason = 'MEDIUM_CONFIDENCE' | 'UNIT_MISMATCH' | 'PACK_MISMATCH';

/**
 * A price-list row saved WITHOUT a product link: the matcher found a candidate
 * but not one safe to link automatically. The person accepts it, picks another
 * product, or makes a new one (catalog.updateItem). Until then the row has no
 * productId and no alias, so it can never raise a leak (catalog-01).
 */
export interface AmbiguousRow {
  /** The supplier_catalog_items row, saved unlinked. */
  itemId: string;
  supplierNameRaw: string;
  supplierSku: string | null;
  unit: string | null;
  /** The suggested product (pre-filled in the review, never linked). */
  productId: string;
  canonicalName: string;
  productUnit: string | null;
  confidence: number;
  matchedBy: string;
  reasons: ReviewReason[];
}

/** Write progress to the import row every this many rows (background imports). */
const PROGRESS_EVERY = 25;

export interface CommitResult {
  created: number;
  updated: number;
  createdProducts: number;
  ambiguous: AmbiguousRow[];
}

/**
 * Upsert parsed catalog rows into supplier_catalog_items, resolving each to a
 * canonical product (dedupe precedence: existing catalog item → barcode →
 * alias/embedding/fuzzy via matchProductTopN → create new product), and learning
 * the supplier-name→product alias so future invoice OCR auto-matches.
 *
 * Shared by the inline tRPC commit (small files) and the import-catalog worker
 * (large files). Runs under the caller's connection (RLS tx or service).
 */
export async function commitCatalogRows(
  db: Database,
  args: CommitArgs,
  rows: CatalogRow[],
  embedder: EmbeddingProvider,
): Promise<CommitResult> {
  const { restaurantId, supplierId } = args;

  // Same-tenant assertion (Wave 4). products.supplier_id carries an ON DELETE
  // RESTRICT FK to suppliers(id), but a cross-DB FK does NOT enforce that the
  // supplier belongs to the SAME restaurant as the product we're about to write
  // — a stray supplierId from another tenant would otherwise stamp a wrong owner
  // (and leak that supplier into this restaurant's exclusivity scope). The tRPC
  // path calls assertSupplierOwned before us, but the worker path does not, so we
  // re-verify here (defence in depth; cheap single-row lookup once per commit).
  const [sup] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.restaurantId, restaurantId)))
    .limit(1);
  if (!sup) {
    throw new Error(
      `[catalog.commit] supplier ${supplierId} does not belong to restaurant ${restaurantId} — refusing to commit`,
    );
  }

  let created = 0;
  let updated = 0;
  let createdProducts = 0;
  const ambiguous: AmbiguousRow[] = [];

  for (const row of rows) {
    // 1. Existing catalog item for this supplier? (by SKU when present, else name)
    const existingFilter = row.supplierSku
      ? eq(supplierCatalogItems.supplierSku, row.supplierSku)
      : eq(supplierCatalogItems.supplierNameRaw, row.supplierNameRaw);
    const [existing] = await db
      .select({ id: supplierCatalogItems.id, productId: supplierCatalogItems.productId })
      .from(supplierCatalogItems)
      .where(
        and(
          eq(supplierCatalogItems.restaurantId, restaurantId),
          eq(supplierCatalogItems.supplierId, supplierId),
          existingFilter,
        ),
      )
      .limit(1);

    // 2. Resolve the canonical product.
    let productId: string | null = existing?.productId ?? null;
    let createdNewProduct = false;
    /** The matcher's confidence for an automatic link (learned as-is, never rounded up to 1). */
    let linkConfidence: number | null = null;
    let pendingReview: Omit<AmbiguousRow, 'itemId'> | null = null;
    let embedding: number[] | null = null;
    if (!productId) {
      embedding = await embedder.embed(row.supplierNameRaw);
      // matchProductTopN is supplier-scoped (the false-leak guard): every
      // candidate it returns is a product THIS supplier already sells (via a
      // product_aliases or linked supplier_catalog_items row). It returns []
      // when supplierId is null/unknown or when no same-supplier product
      // clears threshold — so we never auto-link to another supplier's product
      // (which would raise a phantom price-leak). No same-supplier candidate
      // ⇒ force CREATE-NEW below.
      const candidates = supplierId
        ? await matchProductTopN(
            db,
            {
              restaurantId,
              supplierId,
              rawDescription: row.supplierNameRaw,
              // SKU-first (strategy-0): a price-list row whose מק״ט already maps to a
              // product resolves exactly, before name embedding/fuzzy.
              ...(row.supplierSku ? { supplierSku: row.supplierSku } : {}),
              embedding,
              ...(row.barcodeEan ? { barcode: row.barcodeEan } : {}),
            },
            1,
          )
        : [];
      const top = candidates[0];
      const reasons: ReviewReason[] = [];
      let productUnit: string | null = null;
      if (top && top.confidence >= REVIEW_FLOOR) {
        if (top.confidence < AUTO_LINK) reasons.push('MEDIUM_CONFIDENCE');
        const fit = await unitPackFit(db, restaurantId, supplierId, top.productId, row);
        productUnit = fit.productUnit;
        reasons.push(...fit.reasons);
      }
      if (top && top.confidence >= REVIEW_FLOOR && reasons.length === 0) {
        productId = top.productId;
        linkConfidence = top.confidence;
      } else if (top && top.confidence >= REVIEW_FLOOR) {
        // Suggest, never link: the row is saved unlinked (productId null) and
        // no alias is learned until a person accepts (catalog-01).
        pendingReview = {
          supplierNameRaw: row.supplierNameRaw,
          supplierSku: row.supplierSku,
          unit: row.unit,
          productId: top.productId,
          canonicalName: top.canonicalName,
          productUnit,
          confidence: top.confidence,
          matchedBy: top.matchedBy,
          reasons,
        };
      } else {
        const [p] = await db
          .insert(products)
          .values({
            restaurantId,
            // Exclusivity FOUNDATION (Wave 4): a product first seen on THIS
            // supplier's price-list is owned by THIS supplier. Same-tenant was
            // asserted above, so this FK can never cross restaurants.
            supplierId,
            canonicalName: row.supplierNameRaw,
            defaultUnit: row.unit,
            barcodeEan: row.barcodeEan,
            embedding,
          })
          .returning({ id: products.id });
        if (!p) throw new Error('failed to insert product');
        productId = p.id;
        createdNewProduct = true;
        createdProducts += 1;
      }
    }

    // 3. Upsert the priced catalog item.
    const itemValues = {
      restaurantId,
      supplierId,
      productId,
      supplierSku: row.supplierSku,
      supplierNameRaw: row.supplierNameRaw,
      unit: row.unit,
      packSize: row.packSize == null ? null : row.packSize.toString(),
      listPrice: row.listPrice == null ? null : row.listPrice.toString(),
      barcodeEan: row.barcodeEan,
      sourceImportId: args.sourceImportId ?? null,
      observedAt: new Date(),
      updatedAt: new Date(),
    };
    let itemId: string;
    if (existing) {
      await db
        .update(supplierCatalogItems)
        .set(itemValues)
        .where(eq(supplierCatalogItems.id, existing.id));
      itemId = existing.id;
      updated += 1;
    } else {
      const [ins] = await db
        .insert(supplierCatalogItems)
        .values(itemValues)
        .returning({ id: supplierCatalogItems.id });
      if (!ins) throw new Error('failed to insert catalog item');
      itemId = ins.id;
      created += 1;
    }
    if (pendingReview) ambiguous.push({ itemId, ...pendingReview });

    // 4. Learn the supplier-name → product alias for future invoice OCR — only
    //    for a product made from this very row or an automatic link, at a
    //    machine confidence (< 1.000, which is reserved for a person). An
    //    existing link was already learned when it was made; a suggestion
    //    learns nothing until accepted.
    if (productId && (createdNewProduct || linkConfidence != null)) {
      await recordConfirmedMatch(db, {
        productId,
        rawName: row.supplierNameRaw,
        supplierId,
        supplierSku: row.supplierSku,
        confidence: createdNewProduct
          ? MACHINE_MAX_CONFIDENCE
          : Math.min(MACHINE_MAX_CONFIDENCE, Math.floor(linkConfidence! * 1000) / 1000),
      });
    }

    // Determinate progress for a background import (the worker's writes are
    // visible to the progress card; inline commits finish before anyone looks).
    const done = created + updated;
    if (args.sourceImportId && done % PROGRESS_EVERY === 0) {
      await db
        .update(catalogImports)
        .set({ createdItems: created, updatedItems: updated })
        .where(and(eq(catalogImports.id, args.sourceImportId), eq(catalogImports.restaurantId, restaurantId)));
    }
  }

  return { created, updated, createdProducts, ambiguous };
}

/**
 * Does the row's unit / pack fit the candidate product? A unit that neither
 * equals nor converts to the product's unit ("ארגז" vs "ק״ג"), or a pack size
 * other than the one this supplier already sells the product in, means a link
 * would compare different quantities — a phantom price leak. Those go to review.
 */
async function unitPackFit(
  db: Database,
  restaurantId: string,
  supplierId: string,
  productId: string,
  row: CatalogRow,
): Promise<{ productUnit: string | null; reasons: ReviewReason[] }> {
  const [p] = await db
    .select({ defaultUnit: products.defaultUnit })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.restaurantId, restaurantId)))
    .limit(1);
  const productUnit = p?.defaultUnit ?? null;
  const reasons: ReviewReason[] = [];
  if (
    row.unit &&
    productUnit &&
    !sameUnit(row.unit, productUnit) &&
    !areConvertible(row.unit, productUnit)
  ) {
    reasons.push('UNIT_MISMATCH');
  }
  const packs = await db
    .select({ packSize: supplierCatalogItems.packSize })
    .from(supplierCatalogItems)
    .where(
      and(
        eq(supplierCatalogItems.restaurantId, restaurantId),
        eq(supplierCatalogItems.supplierId, supplierId),
        eq(supplierCatalogItems.productId, productId),
      ),
    )
    .limit(20);
  // No pack size = sold per single unit (1), on both sides — an unpacked row counts.
  const rowPack = row.packSize ?? 1;
  if (packs.length > 0 && packs.every((x) => Number(x.packSize ?? 1) !== rowPack)) reasons.push('PACK_MISMATCH');
  return { productUnit, reasons };
}
