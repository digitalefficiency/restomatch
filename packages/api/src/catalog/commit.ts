import { and, eq, products, supplierCatalogItems, type Database } from '@restomatch/db';
import {
  matchProductTopN,
  recordConfirmedMatch,
  type EmbeddingProvider,
} from '@restomatch/catalog';
import type { CatalogRow } from './parse';

/** Confidence at/above which a row auto-links to an existing product. */
const AUTO_LINK = 0.9;
/** Floor below which we create a new product instead of linking. */
const REVIEW_FLOOR = 0.6;

export interface CommitArgs {
  restaurantId: string;
  supplierId: string;
  sourceImportId?: string | null;
}

export interface AmbiguousRow {
  supplierNameRaw: string;
  supplierSku: string | null;
  productId: string;
  canonicalName: string;
  confidence: number;
  matchedBy: string;
}

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
    let embedding: number[] | null = null;
    if (!productId) {
      embedding = await embedder.embed(row.supplierNameRaw);
      const candidates = await matchProductTopN(
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
      );
      const top = candidates[0];
      if (top && top.confidence >= AUTO_LINK) {
        productId = top.productId;
      } else if (top && top.confidence >= REVIEW_FLOOR) {
        productId = top.productId;
        ambiguous.push({
          supplierNameRaw: row.supplierNameRaw,
          supplierSku: row.supplierSku,
          productId: top.productId,
          canonicalName: top.canonicalName,
          confidence: top.confidence,
          matchedBy: top.matchedBy,
        });
      } else {
        const [p] = await db
          .insert(products)
          .values({
            restaurantId,
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
    if (existing) {
      await db
        .update(supplierCatalogItems)
        .set(itemValues)
        .where(eq(supplierCatalogItems.id, existing.id));
      updated += 1;
    } else {
      await db.insert(supplierCatalogItems).values(itemValues);
      created += 1;
    }

    // 4. Learn the supplier-name → product alias for future invoice OCR.
    if (productId) {
      await recordConfirmedMatch(db, {
        productId,
        rawName: row.supplierNameRaw,
        supplierId,
        supplierSku: row.supplierSku,
        ...(createdNewProduct ? { confidence: 1 } : {}),
      });
    }
  }

  return { created, updated, createdProducts, ambiguous };
}
