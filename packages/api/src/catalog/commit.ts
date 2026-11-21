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
import { recordAudit } from '../audit';

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
  /**
   * A background import commits in chunks, each in its own transaction (W3-10
   * review round 2): this call is chunk `index` of `count`. Its record is a
   * `catalog.import_chunk_committed` row; the worker writes the one
   * `catalog.import_committed` summary (what AU-13 reads) after the last chunk.
   */
  chunk?: { index: number; count: number; size: number };
  /**
   * Which of the unit / pack columns the import maps (round 4: unit and pack
   * are one basis). Unmapped → the row keeps its existing unit AND pack. Default:
   * both mapped.
   */
  columns?: { unit: boolean; packSize: boolean };
}

/**
 * W3-10 round 4 · the unit and pack a row will store — one basis, decided
 * together:
 *  - a new row: the file's values;
 *  - a blank price cell: the existing price basis stays (unit and pack);
 *  - a priced row: a mapped unit column gives the unit (a blank cell keeps the
 *    existing unit); a mapped pack column gives the pack (a blank cell is a
 *    single unit — null); an unmapped pack column keeps the existing pack only
 *    while the unit stays the same (a new unit with an old pack would be a
 *    different quantity), else null. Unmapped unit and pack: both kept.
 * Shared by the commit (what it writes and what the unit / pack fit checks) and
 * the preview (what it shows as kept / changed).
 */
export function storedBasis(
  existing: { unit: string | null; packSize: string | null } | null,
  row: { unit: string | null; packSize: number | null; listPrice: number | null },
  columns: { unit: boolean; packSize: boolean } = { unit: true, packSize: true },
): { unit: string | null; packSize: string | null } {
  if (!existing) return { unit: row.unit, packSize: packString(row.packSize) };
  if (row.listPrice == null) return { unit: existing.unit, packSize: existing.packSize };
  const unit = columns.unit && row.unit != null ? row.unit : existing.unit;
  const unitChanged = (unit ?? null) !== (existing.unit ?? null);
  const packSize = columns.packSize ? packString(row.packSize) : unitChanged ? null : existing.packSize;
  return { unit, packSize };
}

/**
 * W3-10 round 3 · the one lock that orders a supplier's catalog writes: every
 * commit (inline, and each worker chunk), the summary, and every revert take
 * it, always after their own catalog_imports row (no lock cycle). Returns the
 * commit-order stamp (`clock_timestamp()` read under the lock, µs, as text):
 * "later than" between imports compares these, never transaction-start times.
 */
export async function lockSupplierCatalog(db: Database, restaurantId: string, supplierId: string): Promise<string> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`catalog-revert:${restaurantId}:${supplierId}`}))`);
  const [r] = (await db.execute(sql`select clock_timestamp()::text as t`)) as unknown as Array<{ t: string }>;
  return r!.t;
}

/** W3-10 · the audit action AU-13's priceListDiff reads (one row per committed import). */
export const IMPORT_COMMITTED_AUDIT_ACTION = 'catalog.import_committed';
/** W3-10 · one chunk of a background import (its revert data; AU-13 never reads it). */
export const IMPORT_CHUNK_AUDIT_ACTION = 'catalog.import_chunk_committed';

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

/** The fields an import writes on a catalog row, as stored (NUMERIC strings): what a revert restores. */
export interface ItemSnapshot {
  listPrice: string | null;
  unit: string | null;
  packSize: string | null;
  productId: string | null;
  active: boolean;
  supplierNameRaw: string;
  barcodeEan: string | null;
}

/**
 * W3-10 · one pre-existing row this commit wrote, merged per row (first
 * `before`, last `after`): what a revert restores, together. A row whose
 * values would not change is never written, so it is never here (round 2).
 */
export interface ImportRowChange {
  itemId: string;
  name: string;
  sku: string | null;
  before: ItemSnapshot & { updatedAt: string; observedAt: string | null; sourceImportId: string | null };
  /** As stored by this commit's last write (RETURNING), including its `updatedAt` stamp. */
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

export interface CommitResult {
  created: number;
  /** Existing rows this commit wrote (a value changed). */
  updated: number;
  /** Existing rows the file lists with nothing new: not written, not restamped, not owned. */
  unchanged: number;
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
  // Serialize with reverts (and other commits) of this supplier (round 3).
  const lockedAt = await lockSupplierCatalog(db, restaurantId, supplierId);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let createdProducts = 0;
  const ambiguous: AmbiguousRow[] = [];
  /**
   * Every write of this commit asks for its own stamp (commitAt + 1 ms per
   * write) and records the one actually stored (RETURNING — the 0031 trigger
   * replaces a stamp equal to the old updated_at with now()). A revert restores
   * a row only while it still carries that exact stamp; any other write moves it.
   */
  const commitAt = new Date();
  let writeSeq = 0;
  const stamp = () => new Date(commitAt.getTime() + writeSeq++);
  /** Rows this commit inserted, with the stored stamp of their last write. */
  const createdStamps = new Map<string, string>();
  /** Pre-existing rows written, merged per row (first before, last after). */
  const rowChanges = new Map<string, ImportRowChange>();
  /** Rows this commit inserted (a revert turns them off). */
  const createdItemIds: string[] = [];
  let keptPriceOnBlank = 0;
  /**
   * Rows a revert turned off, with the stamp that revert left (round 2): a
   * re-import turns one back on only while it is still exactly as the revert
   * left it — a row a person turned off since stays off.
   */
  const revertedOff = new Set(
    (
      (await db.execute(sql`
        select d ->> 'itemId' as id, d ->> 'updatedAt' as at
          from audit_log, jsonb_array_elements(coalesce(after -> 'deactivatedItems', '[]'::jsonb)) d
         where restaurant_id = ${restaurantId} and action = 'catalog.import_reverted'
           and after ->> 'supplierId' = ${supplierId}
      `)) as unknown as Array<{ id: string; at: string }>
    ).map((r) => `${r.id}|${r.at}`),
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
        supplierNameRaw: supplierCatalogItems.supplierNameRaw,
        barcodeEan: supplierCatalogItems.barcodeEan,
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
      .orderBy(asc(supplierCatalogItems.createdAt), asc(supplierCatalogItems.id))
      .limit(1);

    // The unit and pack this row will store: the unit / pack fit judges these,
    // not the raw file cells (round 4: an unlinked case/12 row with no unit /
    // pack columns is a case/12, never a per-unit match).
    const basis = storedBasis(existing ?? null, row, args.columns);
    const fitRow: CatalogRow = { ...row, unit: basis.unit, packSize: basis.packSize == null ? null : Number(basis.packSize) };

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
        const fit = await unitPackFit(db, restaurantId, supplierId, top.productId, fitRow);
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
          unit: basis.unit,
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
    const blankPrice = row.listPrice == null;
    if (blankPrice && existing?.listPrice != null) keptPriceOnBlank += 1;
    let itemId: string;
    if (existing) {
      // What this row would store. A blank / unreadable price cell keeps
      // everything that defines the existing price (round 2); unit and pack are
      // one basis (storedBasis, round 4).
      const next: ItemSnapshot = {
        listPrice: blankPrice ? existing.listPrice : String(row.listPrice),
        unit: basis.unit,
        packSize: basis.packSize,
        productId,
        // A row an earlier revert turned off comes back when a file lists it
        // again, but only while it is exactly as that revert left it.
        active:
          existing.active || revertedOff.has(`${existing.id}|${existing.updatedAt.toISOString()}`),
        supplierNameRaw: row.supplierNameRaw,
        // A blank barcode cell never wipes a barcode the row has.
        barcodeEan: row.barcodeEan ?? existing.barcodeEan,
      };
      if (sameSnapshot(existing, next)) {
        // Nothing new: no write, no restamp, no ownership (round 2). The row
        // keeps its owner and its times, so expected-price logic is unmoved.
        unchanged += 1;
        itemId = existing.id;
      } else {
        const [stored] = await db
          .update(supplierCatalogItems)
          .set({
            ...next,
            sourceImportId: args.sourceImportId ?? null,
            observedAt: commitAt,
            updatedAt: stamp(),
          })
          .where(and(eq(supplierCatalogItems.id, existing.id), eq(supplierCatalogItems.restaurantId, restaurantId)))
          .returning(STORED);
        if (!stored) throw new Error('failed to update catalog item');
        itemId = existing.id;
        updated += 1;
        const after = toAfter(stored);
        if (createdStamps.has(existing.id)) {
          // Inserted earlier in this same commit: the revert turns it off by its last stamp.
          createdStamps.set(existing.id, after.updatedAt);
        } else {
          // Record this row's written fields, merged per row: the first write
          // keeps `before`, every later write moves `after`.
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
                supplierNameRaw: existing.supplierNameRaw,
                barcodeEan: existing.barcodeEan,
                updatedAt: existing.updatedAt.toISOString(),
                observedAt: existing.observedAt ? existing.observedAt.toISOString() : null,
                sourceImportId: existing.sourceImportId,
              },
              after,
            });
          }
        }
      }
    } else {
      const [ins] = await db
        .insert(supplierCatalogItems)
        .values({
          restaurantId,
          supplierId,
          productId,
          supplierSku: row.supplierSku,
          supplierNameRaw: row.supplierNameRaw,
          unit: row.unit,
          packSize: packString(row.packSize),
          listPrice: row.listPrice == null ? null : String(row.listPrice),
          barcodeEan: row.barcodeEan,
          sourceImportId: args.sourceImportId ?? null,
          observedAt: commitAt,
          updatedAt: stamp(),
        })
        .returning({ id: supplierCatalogItems.id, updatedAt: supplierCatalogItems.updatedAt });
      if (!ins) throw new Error('failed to insert catalog item');
      itemId = ins.id;
      created += 1;
      createdItemIds.push(ins.id);
      createdStamps.set(ins.id, ins.updatedAt.toISOString());
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

    // Determinate progress for a background import written in one call (a
    // chunked import writes its cumulative progress after each chunk instead).
    const done = created + updated + unchanged;
    if (args.sourceImportId && !args.chunk && done % PROGRESS_EVERY === 0) {
      await db
        .update(catalogImports)
        .set({ createdItems: created, updatedItems: updated })
        .where(and(eq(catalogImports.id, args.sourceImportId), eq(catalogImports.restaurantId, restaurantId)));
    }
  }

  // Every written row is recorded (a row is written only when a value moves).
  const changes = [...rowChanges.values()];
  // AU-13's list-price changes: both sides priced and different (integer price units).
  const priceChanges: ImportPriceChange[] = changes
    .filter(
      (c) =>
        c.before.listPrice != null && c.after.listPrice != null && !samePrice(c.before.listPrice, c.after.listPrice),
    )
    .map((c) => ({
      itemId: c.itemId,
      productId: c.after.productId,
      name: c.name,
      sku: c.sku,
      oldListPrice: c.before.listPrice!,
      newListPrice: c.after.listPrice!,
      unit: c.after.unit ?? c.before.unit,
    }));

  // One audit row per committed import (or per chunk of a background import):
  // the record AU-13's priceListDiff reads ({ supplierId, priceChanges }) and
  // everything a revert needs (rowChanges with before/after snapshots, the
  // created rows with their stamps, commitAt). Append-only; written even when
  // nothing moved.
  await recordAudit(db, {
    restaurantId,
    userId: args.userId ?? null,
    action: args.chunk ? IMPORT_CHUNK_AUDIT_ACTION : IMPORT_COMMITTED_AUDIT_ACTION,
    entityType: 'catalog_import',
    entityId: args.sourceImportId ?? null,
    after: {
      revertVersion: IMPORT_RECORD_VERSION,
      ...(args.chunk ? { chunk: args.chunk } : {}),
      commitAt: commitAt.toISOString(),
      lockedAt,
      supplierId,
      created,
      updated,
      unchanged,
      createdProducts,
      keptPriceOnBlank,
      priceChanges,
      rowChanges: changes,
      createdItemIds,
      createdItems: createdItemIds.map((id) => ({ itemId: id, updatedAt: createdStamps.get(id)! })),
    },
  });

  return { created, updated, unchanged, createdProducts, ambiguous, priceChanges, keptPriceOnBlank };
}

/** What a chunk record carries (the summary adds these up). */
interface ChunkRecord {
  chunk?: { index: number; count: number; size?: number };
  created?: number;
  updated?: number;
  unchanged?: number;
  createdProducts?: number;
  keptPriceOnBlank?: number;
  rowChanges?: ImportRowChange[];
  createdItemIds?: string[];
}

/**
 * W3-10 · the ONE `catalog.import_committed` record of a background import
 * (what AU-13's priceListDiff announces), adding its chunks up — after the last
 * chunk, or (`partial`) when the import ends failed part-way, so the rises that
 * did go live are still announced. Its price changes are merged across chunks
 * per row (round 3): the first chunk's `before`, the last chunk's `after`; a
 * row this import created, or one with no price before it, is not a change. It
 * carries no revert data (`chunked` = the chunk records the revert works from).
 * Runs in the caller's transaction, under the supplier lock.
 */
export async function recordImportSummary(
  db: Database,
  args: { restaurantId: string; supplierId: string; importId: string; userId?: string | null; partial?: boolean },
): Promise<{ created: number; updated: number; unchanged: number; createdProducts: number; chunks: number }> {
  const lockTime = await lockSupplierCatalog(db, args.restaurantId, args.supplierId);
  const recs = (
    await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.restaurantId, args.restaurantId),
          eq(auditLog.action, IMPORT_CHUNK_AUDIT_ACTION),
          eq(auditLog.entityId, args.importId),
        ),
      )
  )
    .map((r) => (r.after ?? {}) as ChunkRecord)
    .sort((x, y) => (x.chunk?.index ?? 0) - (y.chunk?.index ?? 0));
  const sum = (k: 'created' | 'updated' | 'unchanged' | 'createdProducts' | 'keptPriceOnBlank') =>
    recs.reduce((n, r) => n + (r[k] ?? 0), 0);
  // The summary ranks where its chunks went live (round 4): a partial summary
  // written later at finalize must not rank as the supplier's latest import.
  const [maxChunk] = (await db.execute(sql`
    select max((after ->> 'lockedAt')::timestamptz)::text as t from audit_log
     where restaurant_id = ${args.restaurantId} and entity_id = ${args.importId}::uuid
       and action = ${IMPORT_CHUNK_AUDIT_ACTION}
  `)) as unknown as Array<{ t: string | null }>;
  const lockedAt = maxChunk?.t ?? lockTime;
  const createdHere = new Set(recs.flatMap((r) => r.createdItemIds ?? []));
  const rows = new Map<string, ImportRowChange>();
  for (const r of recs) {
    for (const c of r.rowChanges ?? []) {
      const prev = rows.get(c.itemId);
      rows.set(c.itemId, prev ? { ...c, before: prev.before } : c);
    }
  }
  const priceChanges: ImportPriceChange[] = [...rows.values()]
    .filter(
      (c) =>
        !createdHere.has(c.itemId) &&
        c.before.listPrice != null &&
        c.after.listPrice != null &&
        !samePrice(c.before.listPrice, c.after.listPrice),
    )
    .map((c) => ({
      itemId: c.itemId,
      productId: c.after.productId,
      name: c.name,
      sku: c.sku,
      oldListPrice: c.before.listPrice!,
      newListPrice: c.after.listPrice!,
      unit: c.after.unit ?? c.before.unit,
    }));
  const totals = {
    created: sum('created'),
    updated: sum('updated'),
    unchanged: sum('unchanged'),
    createdProducts: sum('createdProducts'),
  };
  await recordAudit(db, {
    restaurantId: args.restaurantId,
    userId: args.userId ?? null,
    action: IMPORT_COMMITTED_AUDIT_ACTION,
    entityType: 'catalog_import',
    entityId: args.importId,
    after: {
      revertVersion: IMPORT_RECORD_VERSION,
      chunked: recs.length,
      ...(args.partial ? { partial: true } : {}),
      lockedAt,
      supplierId: args.supplierId,
      ...totals,
      keptPriceOnBlank: sum('keptPriceOnBlank'),
      priceChanges,
    },
  });
  return { ...totals, chunks: recs.length };
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

/** Write progress to the import row every this many rows (one-call background imports). */
const PROGRESS_EVERY = 25;

/** The stored columns a write returns: the row's snapshot and its stamp. */
const STORED = {
  listPrice: supplierCatalogItems.listPrice,
  unit: supplierCatalogItems.unit,
  packSize: supplierCatalogItems.packSize,
  productId: supplierCatalogItems.productId,
  active: supplierCatalogItems.active,
  supplierNameRaw: supplierCatalogItems.supplierNameRaw,
  barcodeEan: supplierCatalogItems.barcodeEan,
  updatedAt: supplierCatalogItems.updatedAt,
};

function toAfter(r: ItemSnapshot & { updatedAt: Date }): ImportRowChange['after'] {
  return {
    listPrice: r.listPrice,
    unit: r.unit,
    packSize: r.packSize,
    productId: r.productId,
    active: r.active,
    supplierNameRaw: r.supplierNameRaw,
    barcodeEan: r.barcodeEan,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** pack_size is numeric(12,3): round to what is stored, so the record and the guard agree (round 2). */
export function packString(pack: number | null | undefined): string | null {
  return pack == null ? null : (Math.round(pack * 1000) / 1000).toFixed(3);
}

/** The same pack size at the stored scale (3). */
function samePack(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.round(Number(a) * 1000) === Math.round(Number(b) * 1000);
}

/** Would writing `b` over `a` change anything stored? */
export function sameSnapshot(a: ItemSnapshot, b: ItemSnapshot): boolean {
  return (
    samePrice(a.listPrice, b.listPrice) &&
    (a.unit ?? null) === (b.unit ?? null) &&
    samePack(a.packSize, b.packSize) &&
    (a.productId ?? null) === (b.productId ?? null) &&
    a.active === b.active &&
    a.supplierNameRaw === b.supplierNameRaw &&
    (a.barcodeEan ?? null) === (b.barcodeEan ?? null)
  );
}
