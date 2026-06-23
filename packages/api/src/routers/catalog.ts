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
  type Database,
} from '@restomatch/db';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { enqueueCatalogImport } from '@restomatch/queue';
import { managerProcedure, memberProcedure, router } from '../trpc';
import { assertSupplierOwned } from '../tenant';
import { autoDetectMapping, extractCatalogRows, parseCatalogFile } from '../catalog/parse';
import { commitCatalogRows } from '../catalog/commit';

/** Above this row count a commit is handed to the import-catalog worker. */
const INLINE_ROW_LIMIT = 1500;
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
  })
  .strict();

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

const embedder = new MockEmbeddingProvider(1536);

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
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const conds = [eq(supplierCatalogItems.restaurantId, restaurantId)];
      if (input?.supplierId) conds.push(eq(supplierCatalogItems.supplierId, input.supplierId));
      if (!input?.includeInactive) conds.push(eq(supplierCatalogItems.active, true));
      if (input?.search) {
        const like = `%${input.search}%`;
        conds.push(
          sql`(${supplierCatalogItems.supplierNameRaw} ILIKE ${like} OR ${supplierCatalogItems.supplierSku} ILIKE ${like} OR ${products.canonicalName} ILIKE ${like})`,
        );
      }
      return ctx.db
        .select({
          id: supplierCatalogItems.id,
          supplierId: supplierCatalogItems.supplierId,
          supplierName: suppliers.name,
          productId: supplierCatalogItems.productId,
          canonicalName: products.canonicalName,
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
      const items = await ctx.db
        .select({
          id: supplierCatalogItems.id,
          supplierId: supplierCatalogItems.supplierId,
          supplierName: suppliers.name,
          supplierSku: supplierCatalogItems.supplierSku,
          unit: supplierCatalogItems.unit,
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
      return { product, items, history };
    }),

  /** Parse an uploaded file and return headers + sample + auto-mapping for the UI. */
  parsePreview: managerProcedure
    .input(z.object({ supplierId: z.string().uuid(), file: FileInput }))
    .mutation(async ({ ctx, input }) => {
      await assertSupplierOwned(ctx.db, input.supplierId, ctx.session.restaurantId);
      const table = parseCatalogFile(input.file);
      if (table.rows.length > MAX_ROWS) {
        throw new Error(`קובץ גדול מדי (${table.rows.length} שורות, מקסימום ${MAX_ROWS})`);
      }
      return {
        headers: table.headers,
        sample: table.rows.slice(0, 20),
        rowCount: table.rows.length,
        mapping: autoDetectMapping(table.headers),
      };
    }),

  /** Commit an import: parse → dedupe → upsert. Inline for small files, worker for large. */
  commitImport: managerProcedure
    .input(z.object({ supplierId: z.string().uuid(), file: FileInput, mapping: MappingSchema }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      const table = parseCatalogFile(input.file);
      if (table.rows.length > MAX_ROWS) {
        throw new Error(`קובץ גדול מדי (${table.rows.length} שורות, מקסימום ${MAX_ROWS})`);
      }
      const rows = extractCatalogRows(table, input.mapping);

      const [imp] = await ctx.db
        .insert(catalogImports)
        .values({
          restaurantId,
          supplierId: input.supplierId,
          filename: input.file.filename,
          status: 'pending',
          rowCount: rows.length,
          columnMapping: input.mapping,
          createdBy: ctx.session.userId,
        })
        .returning({ id: catalogImports.id });
      if (!imp) throw new TRPCError({ code: 'NOT_FOUND', message: 'failed to create catalog import' });

      // Large files → background worker (when a queue is available).
      if (rows.length > INLINE_ROW_LIMIT) {
        const queued = await enqueueCatalogImport({
          restaurantId,
          supplierId: input.supplierId,
          importId: imp.id,
          file: input.file,
          mapping: input.mapping,
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
      return { importId: imp.id, queued: false, rowCount: rows.length, ...result };
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
        return { ok: true };
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'כבר קיים פריט עם המק״ט הזה לספק.' });
        }
        throw err;
      }
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
