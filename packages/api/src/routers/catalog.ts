import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  asc,
  desc,
  eq,
  products,
  priceHistory,
  sql,
  suppliers,
  supplierCatalogItems,
  catalogImports,
  inArray,
  isNull,
  ne,
  or,
  productAliases,
  restaurants,
  type Database,
} from '@restomatch/db';
import { MockEmbeddingProvider, recordConfirmedMatch } from '@restomatch/catalog';
import { enqueueCatalogImport, isQueueUnavailableError } from '@restomatch/queue';
import { managerProcedure, memberProcedure, router } from '../trpc';
import { assertSupplierOwned } from '../tenant';
import {
  analyzeCatalogRows,
  autoDetectMapping,
  CatalogFileError,
  detectVatBasis,
  parseCatalogFile,
  type CatalogImportMapping,
  type ParsedTable,
} from '../catalog/parse';
import { commitCatalogRows } from '../catalog/commit';
import { catalogUnitPrice, cheapestComparable } from '../lib/unitPrice';

/**
 * Above this row count a commit is handed to the import-catalog worker (about 4
 * queries a row: 200 rows stay well inside one request; more get a progress card).
 */
const INLINE_ROW_LIMIT = 200;
/** A parsed price this many times above / below the current list price is flagged in the preview. */
const OUTLIER_HIGH = 5;
const OUTLIER_LOW = 0.2;
/** Cap on the per-row lists the preview / commit return (the counts stay exact). */
const LIST_CAP = 200;
/** Hard cap to bound request size / parse cost. */
const MAX_ROWS = 20000;

/** Postgres unique-violation backstop for the (supplier, sku) index. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  const causeCode = (err as { cause?: { code?: string } }).cause?.code;
  return code === '23505' || causeCode === '23505';
}

/** Editable fields of a single catalog row (price/SKU/unit/name/etc). */
const ItemPatchSchema = z
  .object({
    supplierNameRaw: z.string().trim().min(1).max(400).optional(),
    supplierSku: z.string().trim().max(64).nullable().optional(),
    unit: z.string().trim().max(32).nullable().optional(),
    packSize: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
    listPrice: z.number().finite().nonnegative().max(10_000_000).nullable().optional(),
    barcodeEan: z.string().trim().max(32).nullable().optional(),
    productId: z.string().uuid().nullable().optional(),
    /** Link to a NEW product with this name (the import review's "מוצר חדש"). */
    newProductName: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((v) => !(v.newProductName && v.productId), { message: 'productId or newProductName, not both' });

const FileInput = z
  .object({
    filename: z.string().min(1).max(255),
    base64: z.string().max(12_000_000).optional(), // ~9MB binary
    text: z.string().max(12_000_000).optional(),
  })
  .strict()
  .refine((f) => !!f.base64 || !!f.text, { message: 'file content required (base64 or text)' });

const MappingSchema = z
  .object({
    sku: z.string().optional(),
    name: z.string().optional(),
    unit: z.string().optional(),
    price: z.string().optional(),
    barcode: z.string().optional(),
    packSize: z.string().optional(),
  })
  .strict();

/** The price list's VAT basis — asked in the wizard, stored with the mapping. */
const VatBasisSchema = z.enum(['ex', 'inc']);

/**
 * The VAT rate this supplier's prices carry, resolved the way the matching
 * engine's input is (match/buildMatchInput: a PO's rate, else the supplier's
 * override, else the restaurant's). A price list has no PO, so: supplier
 * override → restaurant rate. Read-only — the rate is never redefined here.
 */
async function supplierVatRate(db: Database, restaurantId: string, supplierId: string): Promise<string> {
  const [r] = await db
    .select({ supplierRate: suppliers.vatRate, restaurantRate: restaurants.vatRate })
    .from(restaurants)
    .leftJoin(suppliers, and(eq(suppliers.id, supplierId), eq(suppliers.restaurantId, restaurantId)))
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  // restaurants.vat_rate is NOT NULL (default 0.18); the literal only covers a missing row.
  return r?.supplierRate ?? r?.restaurantRate ?? '0.18';
}

export type PriceFlag = 'ZERO' | 'HIGH' | 'LOW';

/** 0, or more than 5× / less than 0.2× the supplier's current list price for the same item. */
function priceFlag(price: number | null, current: number | null): PriceFlag | null {
  if (price == null) return null;
  if (price === 0) return 'ZERO';
  if (current == null || !(current > 0)) return null;
  if (price > current * OUTLIER_HIGH) return 'HIGH';
  if (price < current * OUTLIER_LOW) return 'LOW';
  return null;
}

/** The supplier's current list prices, keyed the way commit finds an existing row (SKU, else name). */
async function currentPrices(db: Database, restaurantId: string, supplierId: string) {
  const items = await db
    .select({
      supplierSku: supplierCatalogItems.supplierSku,
      supplierNameRaw: supplierCatalogItems.supplierNameRaw,
      listPrice: supplierCatalogItems.listPrice,
    })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.restaurantId, restaurantId), eq(supplierCatalogItems.supplierId, supplierId)));
  const bySku = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const it of items) {
    if (it.listPrice == null) continue;
    const v = Number(it.listPrice);
    if (it.supplierSku) bySku.set(it.supplierSku, v);
    byName.set(it.supplierNameRaw, v);
  }
  return (sku: string | null, name: string): number | null =>
    (sku ? bySku.get(sku) : byName.get(name)) ?? null;
}

const embedder = new MockEmbeddingProvider(1536);

/**
 * Parse + size-check an upload, turning user-fixable file problems into a
 * BAD_REQUEST whose message starts with a stable `CATALOG_FILE_<code>` token
 * (the import screen maps it to a localized explanation). Previously these
 * surfaced as 500s with an exceljs stack message.
 */
async function parseUpload(file: z.infer<typeof FileInput>): Promise<ParsedTable> {
  try {
    const table = await parseCatalogFile(file);
    if (table.rows.length > MAX_ROWS) {
      throw new CatalogFileError(
        'TOO_MANY_ROWS',
        `קובץ גדול מדי (${table.rows.length} שורות, מקסימום ${MAX_ROWS})`,
      );
    }
    return table;
  } catch (err) {
    if (err instanceof CatalogFileError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `CATALOG_FILE_${err.code}: ${err.message}`,
        cause: err,
      });
    }
    throw err;
  }
}

export const catalogRouter = router({
  /** Priced catalog (supplier_catalog_items) joined to products + suppliers. */
  items: memberProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid().optional(),
          search: z.string().trim().max(100).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
          includeInactive: z.boolean().optional(),
          /** Rows written by one import (the wizard's review after a background import). */
          importId: z.string().uuid().optional(),
          /** Only rows with no product link (to be reviewed). */
          unlinkedOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const conds = [eq(supplierCatalogItems.restaurantId, restaurantId)];
      if (input?.importId) conds.push(eq(supplierCatalogItems.sourceImportId, input.importId));
      if (input?.unlinkedOnly) conds.push(isNull(supplierCatalogItems.productId));
      if (input?.supplierId) conds.push(eq(supplierCatalogItems.supplierId, input.supplierId));
      if (!input?.includeInactive) conds.push(eq(supplierCatalogItems.active, true));
      if (input?.search) {
        const like = `%${input.search}%`;
        conds.push(
          sql`(${supplierCatalogItems.supplierNameRaw} ILIKE ${like} OR ${supplierCatalogItems.supplierSku} ILIKE ${like} OR ${products.canonicalName} ILIKE ${like} OR ${products.nameEn} ILIKE ${like})`,
        );
      }
      return ctx.db
        .select({
          id: supplierCatalogItems.id,
          supplierId: supplierCatalogItems.supplierId,
          supplierName: suppliers.name,
          supplierNameEn: suppliers.nameEn,
          productId: supplierCatalogItems.productId,
          canonicalName: products.canonicalName,
          productNameEn: products.nameEn,
          supplierNameRaw: supplierCatalogItems.supplierNameRaw,
          supplierSku: supplierCatalogItems.supplierSku,
          unit: supplierCatalogItems.unit,
          packSize: supplierCatalogItems.packSize,
          listPrice: supplierCatalogItems.listPrice,
          barcodeEan: supplierCatalogItems.barcodeEan,
          active: supplierCatalogItems.active,
        })
        .from(supplierCatalogItems)
        .innerJoin(suppliers, eq(suppliers.id, supplierCatalogItems.supplierId))
        .leftJoin(products, eq(products.id, supplierCatalogItems.productId))
        .where(and(...conds))
        .orderBy(asc(supplierCatalogItems.supplierNameRaw))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
    }),

  /** A product with all its supplier prices + recent observed-price history. */
  productDetail: memberProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [product] = await ctx.db
        // Explicit projection: never ship the 1536-dim `embedding` vector to the client.
        .select({
          id: products.id,
          restaurantId: products.restaurantId,
          supplierId: products.supplierId,
          productGroupId: products.productGroupId,
          canonicalName: products.canonicalName,
          nameEn: products.nameEn,
          category: products.category,
          defaultUnit: products.defaultUnit,
          barcodeEan: products.barcodeEan,
          createdAt: products.createdAt,
          updatedAt: products.updatedAt,
        })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.restaurantId, restaurantId)))
        .limit(1);
      if (!product) return null;
      const rawItems = await ctx.db
        .select({
          id: supplierCatalogItems.id,
          supplierId: supplierCatalogItems.supplierId,
          supplierName: suppliers.name,
          supplierNameEn: suppliers.nameEn,
          supplierSku: supplierCatalogItems.supplierSku,
          unit: supplierCatalogItems.unit,
          packSize: supplierCatalogItems.packSize,
          listPrice: supplierCatalogItems.listPrice,
          active: supplierCatalogItems.active,
        })
        .from(supplierCatalogItems)
        .innerJoin(suppliers, eq(suppliers.id, supplierCatalogItems.supplierId))
        .where(
          and(
            eq(supplierCatalogItems.restaurantId, restaurantId),
            eq(supplierCatalogItems.productId, input.productId),
          ),
        )
        .orderBy(asc(suppliers.name));
      // ₪ per the product's default unit — the same normalisation the price-alert
      // sweep uses (one catalogUnitPrice), so "הזול ביותר" only ever compares
      // like with like, and only when two or more active prices are comparable.
      const priced = rawItems.map((it) => ({
        ...it,
        unitPricePerDefaultUnit: catalogUnitPrice({ ...it, productUnit: product.defaultUnit }),
      }));
      const cheapestUnitPrice = cheapestComparable(
        priced.filter((it) => it.active).map((it) => it.unitPricePerDefaultUnit),
      );
      const history = await ctx.db
        .select({
          supplierId: priceHistory.supplierId,
          observedAt: priceHistory.observedAt,
          unitPrice: priceHistory.unitPrice,
        })
        .from(priceHistory)
        .where(
          and(
            eq(priceHistory.restaurantId, restaurantId),
            eq(priceHistory.productId, input.productId),
          ),
        )
        .orderBy(desc(priceHistory.observedAt))
        .limit(24);
      return { product, items: priced, cheapestUnitPrice, history };
    }),

  /**
   * Parse an uploaded file and return headers + sample + auto-mapping for the
   * UI, plus the price check for the chosen mapping: every row's parsed ₪ (ex
   * VAT), the rows held out as "מחיר לא ברור", and the rows flagged against the
   * current list price (0, >5×, <0.2×). Re-called when the mapping or VAT basis
   * changes; nothing is written.
   */
  parsePreview: managerProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        file: FileInput,
        mapping: MappingSchema.optional(),
        vatBasis: VatBasisSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      const table = await parseUpload(input.file);
      const detected = autoDetectMapping(table.headers);
      const mapping = input.mapping ?? detected;
      const vatBasisDetected = detectVatBasis(mapping.price);
      const vatRate = await supplierVatRate(ctx.db, restaurantId, input.supplierId);
      const vatBasis = input.vatBasis ?? vatBasisDetected ?? 'ex';
      const analysis = analyzeCatalogRows(table, { ...mapping, vatBasis, vatRate });
      const current = await currentPrices(ctx.db, restaurantId, input.supplierId);
      const priced = analysis.rows.map((r) => {
        const cur = current(r.supplierSku, r.supplierNameRaw);
        return {
          rowNumber: r.rowNumber,
          supplierNameRaw: r.supplierNameRaw,
          supplierSku: r.supplierSku,
          unit: r.unit,
          rawPrice: r.rawPrice,
          price: r.listPrice,
          currentPrice: cur,
          flag: priceFlag(r.listPrice, cur),
        };
      });
      const flagged = priced.filter((r) => r.flag != null);
      return {
        headers: table.headers,
        sample: table.rows.slice(0, 20),
        rowCount: table.rows.length,
        mapping: detected,
        vatBasisDetected,
        vatRate,
        check: {
          decimal: analysis.decimal,
          committable: analysis.rows.length,
          rows: priced.slice(0, 20),
          held: analysis.held.slice(0, LIST_CAP),
          heldCount: analysis.held.length,
          flagged: flagged.slice(0, LIST_CAP),
          flaggedCount: flagged.length,
        },
      };
    }),

  /** Commit an import: parse → dedupe → upsert. Inline for small files, worker for large. */
  commitImport: managerProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        file: FileInput,
        mapping: MappingSchema,
        /** Required by the wizard; an API caller that omits it means ex-VAT (the old behaviour). */
        vatBasis: VatBasisSchema.optional(),
        /**
         * The person checked the prices flagged against the current list (0, >5×,
         * <0.2×). Re-checked here on the file being committed, so a stale preview
         * can't wave a flagged price through.
         */
        confirmFlagged: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      if (!input.mapping.name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'CATALOG_MAPPING_NAME: חובה למפות עמודת שם/תיאור' });
      }
      const table = await parseUpload(input.file);
      // The VAT basis and the rate it was converted with live beside the column
      // mapping (catalog_imports.column_mapping jsonb) and travel in the job payload.
      const mapping: CatalogImportMapping = {
        ...input.mapping,
        vatBasis: input.vatBasis ?? 'ex',
        vatRate: await supplierVatRate(ctx.db, restaurantId, input.supplierId),
      };
      const analysis = analyzeCatalogRows(table, mapping);
      if (!input.confirmFlagged) {
        const current = await currentPrices(ctx.db, restaurantId, input.supplierId);
        const flagged = analysis.rows.filter(
          (r) => priceFlag(r.listPrice, current(r.supplierSku, r.supplierNameRaw)) != null,
        ).length;
        if (flagged > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `CATALOG_FLAGGED_PRICES: ${flagged} מחירים רחוקים מהמחירון הנוכחי — יש לאשר אותם`,
          });
        }
      }
      const rows = analysis.rows.map(({ supplierSku, supplierNameRaw, unit, listPrice, barcodeEan, packSize }) => ({
        supplierSku,
        supplierNameRaw,
        unit,
        listPrice,
        barcodeEan,
        packSize,
      }));
      const held = analysis.held.slice(0, LIST_CAP);
      const heldCount = analysis.held.length;
      if (rows.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'CATALOG_FILE_NO_ROWS: אין שורות עם שם מוצר בעמודה שנבחרה',
        });
      }

      const [imp] = await ctx.db
        .insert(catalogImports)
        .values({
          restaurantId,
          supplierId: input.supplierId,
          filename: input.file.filename,
          status: 'pending',
          rowCount: rows.length,
          columnMapping: mapping,
          createdBy: ctx.session.userId,
        })
        .returning({ id: catalogImports.id });
      if (!imp) throw new TRPCError({ code: 'NOT_FOUND', message: 'failed to create catalog import' });

      // Large files → background worker (when a queue is available).
      if (rows.length > INLINE_ROW_LIMIT) {
        // Redis down/misconfigured → commit inline rather than fail the import.
        const queued = await enqueueCatalogImport({
          restaurantId,
          supplierId: input.supplierId,
          importId: imp.id,
          file: input.file,
          mapping: { ...mapping },
        }).catch((err: unknown) => {
          if (!isQueueUnavailableError(err)) throw err;
          console.warn(`[catalog.import] ${err.message} — committing import=${imp.id} inline`);
          return false;
        });
        if (queued) {
          return {
            importId: imp.id,
            queued: true,
            rowCount: rows.length,
            created: 0,
            updated: 0,
            createdProducts: 0,
            ambiguous: [],
            held,
            heldCount,
          };
        }
        // No queue available → fall through to inline (slower but never silently drops).
      }

      const result = await commitCatalogRows(
        ctx.db,
        { restaurantId, supplierId: input.supplierId, sourceImportId: imp.id },
        rows,
        embedder,
      );
      await ctx.db
        .update(catalogImports)
        .set({ status: 'committed', createdItems: result.created, updatedItems: result.updated })
        .where(eq(catalogImports.id, imp.id));
      return { importId: imp.id, queued: false, rowCount: rows.length, ...result, held, heldCount };
    }),

  /**
   * Import history (catalog_imports) — newest first, optionally for one
   * supplier. Restaurant-scoped; a foreign supplierId simply yields nothing.
   */
  imports: memberProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(50).default(10),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      return ctx.db
        .select({
          id: catalogImports.id,
          supplierId: catalogImports.supplierId,
          filename: catalogImports.filename,
          status: catalogImports.status,
          rowCount: catalogImports.rowCount,
          createdItems: catalogImports.createdItems,
          updatedItems: catalogImports.updatedItems,
          error: catalogImports.error,
          createdAt: catalogImports.createdAt,
          /**
           * Rows this import saved without a product link — still waiting in its
           * "בדיקה" (the review persists here). The outer column is spelled out:
           * drizzle renders it unqualified, which inside the subquery means sci.id.
           */
          unlinkedItems: sql<number>`(SELECT count(*)::int FROM supplier_catalog_items sci
            WHERE sci.source_import_id = "catalog_imports"."id" AND sci.restaurant_id = ${rid} AND sci.product_id IS NULL)`,
        })
        .from(catalogImports)
        .where(
          and(
            eq(catalogImports.restaurantId, rid),
            input?.supplierId ? eq(catalogImports.supplierId, input.supplierId) : undefined,
          ),
        )
        .orderBy(desc(catalogImports.createdAt))
        .limit(input?.limit ?? 10);
    }),

  /** Toggle a catalog item active/inactive. */
  setItemActive: managerProcedure
    .input(z.object({ itemId: z.string().uuid(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [row] = await ctx.db
        .update(supplierCatalogItems)
        .set({ active: input.active, updatedAt: new Date() })
        .where(
          and(
            eq(supplierCatalogItems.id, input.itemId),
            eq(supplierCatalogItems.restaurantId, restaurantId),
          ),
        )
        .returning({ id: supplierCatalogItems.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'catalog item not found' });
      return { ok: true };
    }),

  /**
   * Add a single priced catalog row for a supplier — the in-app alternative to
   * re-uploading a whole spreadsheet. The (supplier, SKU) unique index is the
   * backstop; a clash returns CONFLICT.
   */
  createItem: managerProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid(),
          supplierNameRaw: z.string().trim().min(1).max(400),
          supplierSku: z.string().trim().max(64).optional(),
          unit: z.string().trim().max(32).optional(),
          packSize: z.number().finite().nonnegative().max(1_000_000).optional(),
          listPrice: z.number().finite().nonnegative().max(10_000_000).optional(),
          barcodeEan: z.string().trim().max(32).optional(),
          productId: z.string().uuid().optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      if (input.productId) {
        const [owned] = await ctx.db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, input.productId), eq(products.restaurantId, restaurantId)))
          .limit(1);
        if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
      }
      try {
        const [row] = await ctx.db
          .insert(supplierCatalogItems)
          .values({
            restaurantId,
            supplierId: input.supplierId,
            supplierNameRaw: input.supplierNameRaw,
            supplierSku: input.supplierSku?.trim() || null,
            unit: input.unit?.trim() || null,
            packSize: input.packSize == null ? null : String(input.packSize),
            listPrice: input.listPrice == null ? null : String(input.listPrice),
            barcodeEan: input.barcodeEan?.trim() || null,
            productId: input.productId ?? null,
          })
          .returning({ id: supplierCatalogItems.id });
        return { id: row!.id };
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'כבר קיים פריט עם המק״ט הזה לספק.' });
        }
        throw err;
      }
    }),

  /** Edit a single catalog row (price / SKU / unit / name / pack / barcode / linked product). */
  updateItem: managerProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        patch: ItemPatchSchema.refine((v) => Object.values(v).some((x) => x !== undefined), {
          message: 'אין שינויים לעדכן',
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const p = input.patch;
      const [item] = await ctx.db
        .select({
          id: supplierCatalogItems.id,
          supplierId: supplierCatalogItems.supplierId,
          supplierNameRaw: supplierCatalogItems.supplierNameRaw,
          supplierSku: supplierCatalogItems.supplierSku,
          unit: supplierCatalogItems.unit,
          barcodeEan: supplierCatalogItems.barcodeEan,
        })
        .from(supplierCatalogItems)
        .where(and(eq(supplierCatalogItems.id, input.itemId), eq(supplierCatalogItems.restaurantId, restaurantId)))
        .limit(1);
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'catalog item not found' });
      if (p.productId) {
        const [owned] = await ctx.db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, p.productId), eq(products.restaurantId, restaurantId)))
          .limit(1);
        if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
      }
      const set: Partial<typeof supplierCatalogItems.$inferInsert> = { updatedAt: new Date() };
      if (p.supplierNameRaw !== undefined) set.supplierNameRaw = p.supplierNameRaw;
      if (p.supplierSku !== undefined) set.supplierSku = p.supplierSku?.trim() || null;
      if (p.unit !== undefined) set.unit = p.unit?.trim() || null;
      if (p.packSize !== undefined) set.packSize = p.packSize == null ? null : String(p.packSize);
      if (p.listPrice !== undefined) set.listPrice = p.listPrice == null ? null : String(p.listPrice);
      if (p.barcodeEan !== undefined) set.barcodeEan = p.barcodeEan?.trim() || null;
      if (p.productId !== undefined) set.productId = p.productId;
      if (p.newProductName) {
        // "מוצר חדש" from the import review: a product owned by this item's
        // supplier (same tenant — the item was read restaurant-scoped above).
        const [created] = await ctx.db
          .insert(products)
          .values({
            restaurantId,
            supplierId: item.supplierId,
            canonicalName: p.newProductName,
            defaultUnit: set.unit !== undefined ? set.unit : item.unit,
            barcodeEan: set.barcodeEan !== undefined ? set.barcodeEan : item.barcodeEan,
          })
          .returning({ id: products.id });
        if (!created) throw new Error('failed to create product');
        set.productId = created.id;
      }

      try {
        const [row] = await ctx.db
          .update(supplierCatalogItems)
          .set(set)
          .where(
            and(
              eq(supplierCatalogItems.id, input.itemId),
              eq(supplierCatalogItems.restaurantId, restaurantId),
            ),
          )
          .returning({ id: supplierCatalogItems.id });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'catalog item not found' });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'כבר קיים פריט עם המק״ט הזה לספק.' });
        }
        throw err;
      }
      // A person linked this row to a product: that is a confirmation, so learn
      // the supplier-name (+ SKU) → product alias for future invoices and imports.
      if (set.productId) {
        const rawName = set.supplierNameRaw ?? item.supplierNameRaw;
        const sku = set.supplierSku !== undefined ? set.supplierSku : item.supplierSku;
        // A person's link supersedes any earlier alias of this supplier's name /
        // SKU to another product — otherwise one SKU would resolve two ways.
        const own = ctx.db
          .select({ id: products.id })
          .from(products)
          .where(eq(products.restaurantId, restaurantId));
        await ctx.db
          .delete(productAliases)
          .where(
            and(
              eq(productAliases.supplierId, item.supplierId),
              ne(productAliases.productId, set.productId),
              inArray(productAliases.productId, own),
              sku
                ? or(eq(productAliases.supplierNameRaw, rawName.trim()), eq(productAliases.supplierSku, sku))
                : eq(productAliases.supplierNameRaw, rawName.trim()),
            ),
          );
        await recordConfirmedMatch(ctx.db, {
          productId: set.productId,
          rawName: set.supplierNameRaw ?? item.supplierNameRaw,
          supplierId: item.supplierId,
          supplierSku: set.supplierSku !== undefined ? set.supplierSku : item.supplierSku,
          provenance: 'human', // G-08: a person linked it → 1.000
        });
      }
      return { ok: true, productId: set.productId ?? null };
    }),

  /** Delete a single catalog row. */
  deleteItem: managerProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [row] = await ctx.db
        .delete(supplierCatalogItems)
        .where(
          and(
            eq(supplierCatalogItems.id, input.itemId),
            eq(supplierCatalogItems.restaurantId, restaurantId),
          ),
        )
        .returning({ id: supplierCatalogItems.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'catalog item not found' });
      return { ok: true };
    }),
});
