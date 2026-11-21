import {
  and,
  asc,
  auditLog,
  catalogImports,
  eq,
  isNull,
  sql,
  products,
  suppliers,
  supplierCatalogItems,
  type Database,
} from '@restomatch/db';
import {
  MAX_SUGGESTIONS,
  REVIEW_FLOOR,
  decideLink,
  isExactKey,
  matchProductTopN,
  normNameSql,
  normalizeLinkName,
  rankSuggestions,
  recordConfirmedMatch,
  type EmbeddingProvider,
  type ReviewReason as LinkReviewReason,
} from '@restomatch/catalog';
import { areConvertible } from '@restomatch/matching';
import { sameUnit } from '../lib/unitPrice';
import type { CatalogRow } from './parse';
import { toPriceUnits } from '../lib/parseMoneyCell';

/*
 * G-08: the thresholds (auto ≥ 0.95 with a fitting unit/pack, review floor 0.6,
 * 1.000 reserved for a person) live in ONE place — `decideLink` in
 * `@restomatch/catalog` (linkPolicy.ts), shared with OCR and order capture.
 */

export interface CommitArgs {
  restaurantId: string;
  supplierId: string;
  sourceImportId?: string | null;
  /** Who committed (inline tRPC import); null for the background worker. Stamped on the audit row. */
  userId?: string | null;
}

/** W3-10 · the audit action AU-13's priceListDiff reads (one row per committed import). */
export const IMPORT_COMMITTED_AUDIT_ACTION = 'catalog.import_committed';

/** One list-price change in a committed import (NUMERIC strings, as stored). AU-13 reads these. */
export interface ImportPriceChange {
  /** The supplier_catalog_items row. */
  itemId?: string;
  productId: string | null;
  name: string;
  sku: string | null;
  oldListPrice: string;
  newListPrice: string;
  unit: string | null;
}

/** The revertable fields of a catalog row, as stored (NUMERIC strings / ISO times). */
export interface ItemSnapshot {
  listPrice: string | null;
  unit: string | null;
  packSize: string | null;
  productId: string | null;
  active: boolean;
}

/**
 * W3-10 · one pre-existing row this commit changed, merged per row (first
 * `before`, last `after`): what a revert restores, together.
 */
export interface ImportRowChange {
  itemId: string;
  name: string;
  sku: string | null;
  before: ItemSnapshot & { updatedAt: string; observedAt: string | null; sourceImportId: string | null };
  /** `updatedAt` is the exact stamp this commit's last write left on the row. */
  after: ItemSnapshot & { updatedAt: string };
}

/** The record shape a revert accepts (older records carry no per-row snapshot). */
export const IMPORT_RECORD_VERSION = 2;

/** Why a suggested link needs a person ("בדיקה"). */
export type ReviewReason = Exclude<LinkReviewReason, 'UNKNOWN_UNIT'>;
type FitReason = 'UNIT_MISMATCH' | 'PACK_MISMATCH';

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
  /** G-08: the top ≤3 candidates (best first) for the person to pick from; the first is `productId`. */
  suggestions: Array<{ productId: string; canonicalName: string; confidence: number; matchedBy: string }>;
}

/** Write progress to the import row every this many rows (background imports). */
const PROGRESS_EVERY = 25;

export interface CommitResult {
  created: number;
  updated: number;
  createdProducts: number;
  ambiguous: AmbiguousRow[];
  /** Existing rows whose list price changed (also written to the audit row). */
  priceChanges: ImportPriceChange[];
  /** Rows whose file cell had no price: their existing price was kept, not wiped. */
  keptPriceOnBlank: number;
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
  /**
   * Every write of this commit gets its own stamp (commitAt + 1 ms per write),
   * recorded per row: a revert restores a row only while it still carries that
   * exact stamp. Distinct stamps also keep the 0031 updated_at trigger (which
   * bumps an UPDATE that leaves updated_at unchanged to now()) out of the way
   * when one file hits the same row twice. Any other write moves the stamp.
   */
  const commitAt = new Date();
  let writeSeq = 0;
  const stamp = () => new Date(commitAt.getTime() + writeSeq++);
  /** Rows this commit inserted, with the stamp of their last write. */
  const createdStamps = new Map<string, string>();
  /** Pre-existing rows changed, merged per row (first before, last after). */
  const rowChanges = new Map<string, ImportRowChange>();
  /** Rows this commit inserted (a revert turns them off). */
  const createdItemIds: string[] = [];
  const createdSet = new Set<string>();
  let keptPriceOnBlank = 0;
  // Rows an earlier revert turned off: a re-import that matches one turns it back on.
  const revertedOff = new Set(
    (
      (await db.execute(sql`
        select jsonb_array_elements_text(coalesce(after -> 'deactivatedItemIds', '[]'::jsonb)) as id
          from audit_log
         where restaurant_id = ${restaurantId} and action = 'catalog.import_reverted'
           and after ->> 'supplierId' = ${supplierId}
      `)) as unknown as Array<{ id: string }>
    ).map((r) => String(r.id)),
  );

  for (const row of rows) {
    // 1. Existing catalog item for this supplier? By SKU when present, else by
    // G-08's one name key (normalizeLinkName / its SQL twin normNameSql) on a
    // no-SKU row — the same key W3-10's "מה ישתנה" preview matches on, so the
    // preview and the commit agree row for row (W3-10b). The oldest row wins.
    const existingFilter = row.supplierSku
      ? eq(supplierCatalogItems.supplierSku, row.supplierSku)
      : and(
          isNull(supplierCatalogItems.supplierSku),
          sql`${normNameSql(supplierCatalogItems.supplierNameRaw)} = ${normalizeLinkName(row.supplierNameRaw)}`,
        );
    const [existing] = await db
      .select({
        id: supplierCatalogItems.id,
        productId: supplierCatalogItems.productId,
        listPrice: supplierCatalogItems.listPrice,
        unit: supplierCatalogItems.unit,
        packSize: supplierCatalogItems.packSize,
        active: supplierCatalogItems.active,
        updatedAt: supplierCatalogItems.updatedAt,
        observedAt: supplierCatalogItems.observedAt,
        sourceImportId: supplierCatalogItems.sourceImportId,
      })
      .from(supplierCatalogItems)
      .where(
        and(
          eq(supplierCatalogItems.restaurantId, restaurantId),
          eq(supplierCatalogItems.supplierId, supplierId),
          existingFilter,
        ),
      )
      .orderBy(asc(supplierCatalogItems.createdAt))
      .limit(1);

    // 2. Resolve the canonical product.
    let productId: string | null = existing?.productId ?? null;
    let createdNewProduct = false;
    /** An automatic link proven by an exact key: the only machine link that learns an alias. */
    let exactKeyLink = false;
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
            MAX_SUGGESTIONS,
          )
        : [];
      // G-08: ONE link policy. Unit/pack is checked against the best candidate.
      const top = rankSuggestions(candidates)[0];
      let productUnit: string | null = null;
      let fitReasons: FitReason[] = [];
      if (top && top.confidence >= REVIEW_FLOOR) {
        const fit = await unitPackFit(db, restaurantId, supplierId, top.productId, row);
        productUnit = fit.productUnit;
        fitReasons = fit.reasons;
      }
      const decision = decideLink(candidates, {
        unitPack: fitReasons.length > 0 ? 'mismatch' : 'match',
        mismatch: fitReasons,
      });
      if (decision.decision === 'auto' && top) {
        productId = decision.productId;
        exactKeyLink = isExactKey(top);
      } else if (decision.decision === 'review' && top) {
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
          // Import always knows the row's unit fit, so UNKNOWN_UNIT never arises here.
          reasons: decision.reasons.filter((r): r is ReviewReason => r !== 'UNKNOWN_UNIT'),
          suggestions: decision.suggestions.map((c) => ({
            productId: c.productId,
            canonicalName: c.canonicalName,
            confidence: c.confidence,
            matchedBy: c.matchedBy,
          })),
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
      // A blank / unreadable price cell never wipes a price the row already has
      // (W3-10 review): the old price stays, and the commit counts it.
      listPrice:
        row.listPrice != null ? row.listPrice.toString() : existing?.listPrice != null ? existing.listPrice : null,
      barcodeEan: row.barcodeEan,
      sourceImportId: args.sourceImportId ?? null,
      observedAt: commitAt,
      updatedAt: stamp(),
      // A row an earlier revert turned off comes back when a file lists it again.
      ...(existing && !existing.active && revertedOff.has(existing.id) ? { active: true } : {}),
    };
    if (row.listPrice == null && existing?.listPrice != null) keptPriceOnBlank += 1;
    let itemId: string;
    if (existing) {
      await db
        .update(supplierCatalogItems)
        .set(itemValues)
        .where(eq(supplierCatalogItems.id, existing.id));
      itemId = existing.id;
      updated += 1;
      if (createdSet.has(existing.id)) createdStamps.set(existing.id, itemValues.updatedAt.toISOString());
      // W3-10 · record this row's revertable fields, merged per row: the first
      // time it is touched keeps `before`, every later hit moves `after`.
      if (!createdSet.has(existing.id)) {
        const after: ImportRowChange['after'] = {
          updatedAt: itemValues.updatedAt.toISOString(),
          listPrice: itemValues.listPrice,
          unit: itemValues.unit ?? null,
          packSize: itemValues.packSize,
          productId: itemValues.productId ?? null,
          active: itemValues.active ?? existing.active,
        };
        const prev = rowChanges.get(existing.id);
        if (prev) {
          prev.after = after;
          prev.name = row.supplierNameRaw;
        } else {
          rowChanges.set(existing.id, {
            itemId: existing.id,
            name: row.supplierNameRaw,
            sku: row.supplierSku,
            before: {
              listPrice: existing.listPrice,
              unit: existing.unit,
              packSize: existing.packSize,
              productId: existing.productId,
              active: existing.active,
              updatedAt: existing.updatedAt.toISOString(),
              observedAt: existing.observedAt ? existing.observedAt.toISOString() : null,
              sourceImportId: existing.sourceImportId,
            },
            after,
          });
        }
      }
    } else {
      const [ins] = await db
        .insert(supplierCatalogItems)
        .values(itemValues)
        .returning({ id: supplierCatalogItems.id });
      if (!ins) throw new Error('failed to insert catalog item');
      itemId = ins.id;
      created += 1;
      createdItemIds.push(ins.id);
      createdSet.add(ins.id);
      createdStamps.set(ins.id, itemValues.updatedAt.toISOString());
    }
    if (pendingReview) ambiguous.push({ itemId, ...pendingReview });

    // 4. Learn the supplier-name → product alias for future invoice OCR — only
    //    for a product made from this very row or an EXACT-KEY automatic link
    //    (machine provenance, 0.999 interim; 1.000 is reserved for a person).
    //    A name-similarity auto-link (embedding/fuzzy ≥ 0.95, unit fits) links
    //    this price-list row but learns NO confirmed alias (G-08): a guess must
    //    never auto-resolve every future invoice line. An existing link was
    //    already learned when it was made; a suggestion learns nothing until accepted.
    if (productId && (createdNewProduct || exactKeyLink)) {
      await recordConfirmedMatch(db, {
        productId,
        rawName: row.supplierNameRaw,
        supplierId,
        supplierSku: row.supplierSku,
        provenance: createdNewProduct ? 'newProduct' : 'exactKey',
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

  // W3-10 · keep only rows whose revertable fields really moved.
  const changes = [...rowChanges.values()].filter((c) => !sameSnapshot(c.before, c.after));
  // AU-13's list-price changes: both sides priced and different (integer price units).
  const priceChanges: ImportPriceChange[] = changes
    .filter((c) => c.before.listPrice != null && c.after.listPrice != null && !samePrice(c.before.listPrice, c.after.listPrice))
    .map((c) => ({
      itemId: c.itemId,
      productId: c.after.productId,
      name: c.name,
      sku: c.sku,
      oldListPrice: c.before.listPrice!,
      newListPrice: c.after.listPrice!,
      unit: c.after.unit ?? c.before.unit,
    }));

  // One audit row per committed import: the record AU-13's priceListDiff reads
  // ({ supplierId, priceChanges }) and everything a revert needs (rowChanges with
  // before/after snapshots, createdItemIds, commitAt). Append-only; written even
  // when nothing moved.
  await db.insert(auditLog).values({
    restaurantId,
    userId: args.userId ?? null,
    action: IMPORT_COMMITTED_AUDIT_ACTION,
    entityType: 'catalog_import',
    entityId: args.sourceImportId ?? null,
    after: {
      revertVersion: IMPORT_RECORD_VERSION,
      commitAt: commitAt.toISOString(),
      supplierId,
      created,
      updated,
      createdProducts,
      keptPriceOnBlank,
      priceChanges,
      rowChanges: changes,
      createdItemIds,
      createdItems: createdItemIds.map((id) => ({ itemId: id, updatedAt: createdStamps.get(id)! })),
    },
  });

  return { created, updated, createdProducts, ambiguous, priceChanges, keptPriceOnBlank };
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
): Promise<{ productUnit: string | null; reasons: FitReason[] }> {
  const [p] = await db
    .select({ defaultUnit: products.defaultUnit })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.restaurantId, restaurantId)))
    .limit(1);
  const productUnit = p?.defaultUnit ?? null;
  const reasons: FitReason[] = [];
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

/** Two NUMERIC price strings (or nulls) are the same price in integer price units. */
export function samePrice(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return toPriceUnits(Number(a)) === toPriceUnits(Number(b));
}

function sameSnapshot(a: ItemSnapshot, b: ItemSnapshot): boolean {
  const pack = (v: string | null) => (v == null ? null : Number(v));
  return (
    samePrice(a.listPrice, b.listPrice) &&
    (a.unit ?? null) === (b.unit ?? null) &&
    pack(a.packSize) === pack(b.packSize) &&
    (a.productId ?? null) === (b.productId ?? null) &&
    a.active === b.active
  );
}
