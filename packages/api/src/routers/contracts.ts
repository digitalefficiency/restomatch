import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  asc,
  eq,
  products,
  supplierContractPrices,
  priceAlerts,
  restaurants,
  sql,
  suppliers,
} from '@restomatch/db';
import { financeProcedure, managerProcedure, memberProcedure, router } from '../trpc';
import { assertSupplierOwned } from '../tenant';
import { assertFeatureOn, isFeatureOn } from '../lib/featureGate';
import { contractPricesForOrder, orderPriceKey } from '../contracts/orderPrices';
import { featureEnabled } from '../lib/features';
import { CatalogFileError, parseCatalogFile, type ParsedTable } from '../catalog/parse';
import {
  autoDetectContractMapping,
  commitContractRows,
  extractContractRows,
} from '../contracts/import';
import { findOverContractLines } from '../contracts/overContract';

const MAX_ROWS = 5000;
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
/** A contract price of ₪0 would turn every billed line into a leak — must be > 0. */
const PRICE = z.number().finite().positive().max(10_000_000);

const FileInput = z
  .object({
    filename: z.string().min(1).max(255),
    base64: z.string().max(12_000_000).optional(),
    text: z.string().max(12_000_000).optional(),
  })
  .strict()
  .refine((f) => !!f.base64 || !!f.text, { message: 'file content required (base64 or text)' });

const MappingSchema = z
  .object({
    sku: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    unit: z.string().max(200).optional(),
    price: z.string().max(200).optional(),
    validFrom: z.string().max(200).optional(),
    validTo: z.string().max(200).optional(),
  })
  .strict();

/** Same user-fixable file errors as the catalog import (CATALOG_FILE_<code>). */
async function parseUpload(file: z.infer<typeof FileInput>): Promise<ParsedTable> {
  try {
    const table = await parseCatalogFile(file);
    if (table.rows.length > MAX_ROWS) {
      throw new CatalogFileError('TOO_MANY_ROWS', `קובץ גדול מדי (${table.rows.length} שורות, מקסימום ${MAX_ROWS})`);
    }
    return table;
  } catch (err) {
    if (err instanceof CatalogFileError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `CATALOG_FILE_${err.code}: ${err.message}`, cause: err });
    }
    throw err;
  }
}

async function assertProductOwned(db: Parameters<typeof assertSupplierOwned>[0], productId: string, restaurantId: string) {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.restaurantId, restaurantId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
}

async function assertContractOwned(db: Parameters<typeof assertSupplierOwned>[0], id: string, restaurantId: string) {
  const [row] = await db
    .select({ id: supplierContractPrices.id, validFrom: supplierContractPrices.validFrom, validTo: supplierContractPrices.validTo })
    .from(supplierContractPrices)
    .where(and(eq(supplierContractPrices.id, id), eq(supplierContractPrices.restaurantId, restaurantId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'contract price not found' });
  return row;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Supplier contract price lists (wave-1 `contracts`). Reads are finance-tier
 * (owner/manager/bookkeeper — agreed prices are commercial detail), writes are
 * manager-tier. Every procedure is feature-gated and RLS-scoped.
 */
export const contractsRouter = router({
  /**
   * Which wave-1 surfaces the caller may see (nav, tabs, badges) — never throws,
   * so a flag-off tenant doesn't log a FEATURE_DISABLED error per page load.
   * Flags are only reported to finance-tier roles (others can't use either).
   */
  access: memberProcedure.query(async ({ ctx }) => {
    const rid = ctx.session.restaurantId;
    const role = ctx.session.role;
    const finance = role === 'owner' || role === 'manager' || role === 'bookkeeper';
    if (!finance) return { contracts: false, priceAlerts: false, openAlerts: 0 };
    const [r] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, rid))
      .limit(1);
    const contracts = featureEnabled(r?.settings, 'contracts');
    const alertsOn = featureEnabled(r?.settings, 'priceAlerts');
    let openAlerts = 0;
    if (alertsOn) {
      const [c] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(priceAlerts)
        .where(and(eq(priceAlerts.restaurantId, rid), eq(priceAlerts.status, 'open')));
      openAlerts = c?.n ?? 0;
    }
    return { contracts, priceAlerts: alertsOn, openAlerts };
  }),

  /** Contract rows, optionally for one supplier, with product/supplier names. */
  list: financeProcedure
    .input(z.object({ supplierId: z.string().uuid().optional() }).strict().optional())
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'contracts');
      const conds = [eq(supplierContractPrices.restaurantId, rid)];
      if (input?.supplierId) conds.push(eq(supplierContractPrices.supplierId, input.supplierId));
      return ctx.db
        .select({
          id: supplierContractPrices.id,
          supplierId: supplierContractPrices.supplierId,
          supplierName: suppliers.name,
          supplierNameEn: suppliers.nameEn,
          productId: supplierContractPrices.productId,
          productName: products.canonicalName,
          productNameEn: products.nameEn,
          productUnit: products.defaultUnit,
          unit: supplierContractPrices.unit,
          contractPrice: supplierContractPrices.contractPrice,
          validFrom: supplierContractPrices.validFrom,
          validTo: supplierContractPrices.validTo,
          source: supplierContractPrices.source,
          note: supplierContractPrices.note,
          updatedAt: supplierContractPrices.updatedAt,
        })
        .from(supplierContractPrices)
        .innerJoin(suppliers, eq(suppliers.id, supplierContractPrices.supplierId))
        .innerJoin(products, eq(products.id, supplierContractPrices.productId))
        .where(and(...conds))
        .orderBy(asc(suppliers.name), asc(products.canonicalName), asc(supplierContractPrices.validFrom))
        .limit(2000);
    }),

  /** Products the contract form can pick for a supplier (own products first). */
  productOptions: financeProcedure
    .input(z.object({ supplierId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'contracts');
      await assertSupplierOwned(ctx.db, input.supplierId, rid);
      const rows = await ctx.db
        .select({
          id: products.id,
          name: products.canonicalName,
          nameEn: products.nameEn,
          unit: products.defaultUnit,
          supplierId: products.supplierId,
        })
        .from(products)
        .where(eq(products.restaurantId, rid))
        .orderBy(asc(products.canonicalName))
        .limit(3000);
      return rows
        .map((r) => ({ ...r, own: r.supplierId === input.supplierId }))
        .sort((a, b) => Number(b.own) - Number(a.own));
    }),

  create: managerProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid(),
          productId: z.string().uuid(),
          contractPrice: PRICE,
          unit: z.string().trim().max(32).nullable().optional(),
          validFrom: DAY,
          validTo: DAY.nullable().optional(),
          note: z.string().trim().max(500).nullable().optional(),
        })
        .strict()
        .refine((v) => !v.validTo || v.validTo >= v.validFrom, { message: 'validTo before validFrom', path: ['validTo'] }),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'contracts');
      await assertSupplierOwned(ctx.db, input.supplierId, rid);
      await assertProductOwned(ctx.db, input.productId, rid);
      try {
        const [row] = await ctx.db
          .insert(supplierContractPrices)
          .values({
            restaurantId: rid,
            supplierId: input.supplierId,
            productId: input.productId,
            contractPrice: input.contractPrice.toFixed(4),
            unit: input.unit || null,
            validFrom: input.validFrom,
            validTo: input.validTo ?? null,
            note: input.note || null,
            source: 'manual',
            createdBy: ctx.session.userId,
          })
          .returning({ id: supplierContractPrices.id });
        return { id: row!.id };
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'CONTRACT_DUPLICATE: כבר קיים מחיר חוזה למוצר זה מאותו תאריך' });
        }
        throw err;
      }
    }),

  update: managerProcedure
    .input(
      z
        .object({
          id: z.string().uuid(),
          contractPrice: PRICE.optional(),
          unit: z.string().trim().max(32).nullable().optional(),
          validFrom: DAY.optional(),
          validTo: DAY.nullable().optional(),
          note: z.string().trim().max(500).nullable().optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'contracts');
      const existing = await assertContractOwned(ctx.db, input.id, rid);
      const validFrom = input.validFrom ?? existing.validFrom;
      const validTo = input.validTo === undefined ? existing.validTo : input.validTo;
      if (validTo && validTo < validFrom) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'CONTRACT_RANGE: תאריך הסיום לפני תאריך ההתחלה' });
      }
      try {
        await ctx.db
          .update(supplierContractPrices)
          .set({
            ...(input.contractPrice !== undefined ? { contractPrice: input.contractPrice.toFixed(4) } : {}),
            ...(input.unit !== undefined ? { unit: input.unit || null } : {}),
            ...(input.note !== undefined ? { note: input.note || null } : {}),
            validFrom,
            validTo,
          })
          .where(and(eq(supplierContractPrices.id, input.id), eq(supplierContractPrices.restaurantId, rid)));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'CONTRACT_DUPLICATE: כבר קיים מחיר חוזה למוצר זה מאותו תאריך' });
        }
        throw err;
      }
      return { ok: true as const };
    }),

  delete: managerProcedure
    .input(z.object({ id: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'contracts');
      await assertContractOwned(ctx.db, input.id, rid);
      await ctx.db
        .delete(supplierContractPrices)
        .where(and(eq(supplierContractPrices.id, input.id), eq(supplierContractPrices.restaurantId, rid)));
      return { ok: true as const };
    }),

  /** Parse an uploaded CSV/XLSX price list → headers, sample and auto-mapping. */
  importPreview: managerProcedure
    .input(z.object({ supplierId: z.string().uuid(), file: FileInput }).strict())
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'contracts');
      await assertSupplierOwned(ctx.db, input.supplierId, rid);
      const table = await parseUpload(input.file);
      return {
        headers: table.headers,
        sample: table.rows.slice(0, 10),
        rowCount: table.rows.length,
        mapping: autoDetectContractMapping(table.headers),
      };
    }),

  /** Commit an upload: resolve products, upsert on (supplier, product, valid_from). */
  importCommit: managerProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid(),
          file: FileInput,
          mapping: MappingSchema,
          defaultValidFrom: DAY,
          defaultValidTo: DAY.nullable().optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'contracts');
      await assertSupplierOwned(ctx.db, input.supplierId, rid);
      if ((!input.mapping.name && !input.mapping.sku) || !input.mapping.price) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'CONTRACT_MAPPING: חובה למפות עמודת מחיר ועמודת שם או מק״ט' });
      }
      const table = await parseUpload(input.file);
      const rows = extractContractRows(table, input.mapping);
      return commitContractRows(
        ctx.db,
        {
          restaurantId: rid,
          supplierId: input.supplierId,
          userId: ctx.session.userId,
          defaultValidFrom: input.defaultValidFrom,
          defaultValidTo: input.defaultValidTo ?? null,
        },
        rows,
      );
    }),

  /** Over-contract lines of one invoice (the invoice-view badge). */
  overContractForInvoice: financeProcedure
    .input(z.object({ invoiceId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'contracts');
      // Restaurant-scoped by construction: a foreign invoice id yields [].
      return findOverContractLines(ctx.db, rid, { invoiceIds: [input.invoiceId] });
    }),

  /** Over-contract lines over the last `days` days (leak view + contracts page). */
  overContract: financeProcedure
    .input(z.object({ days: z.number().int().min(1).max(366).default(90) }).strict().optional())
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'contracts');
      const since = new Date(Date.now() - (input?.days ?? 90) * 86_400_000);
      // Total over EVERY line; only the newest 500 are returned for display.
      let truncated = false;
      const all = await findOverContractLines(ctx.db, rid, { since, onTruncated: () => (truncated = true) });
      return {
        lines: all.slice(0, 500),
        totalOverAgorot: all.reduce((s, l) => s + l.overAgorot, 0),
        lineCount: all.length,
        /** True when more invoice lines exist than one scan covers — the total is a lower bound. */
        truncated,
      };
    }),
  /**
   * Contract unit prices for an order being built (new-order wizard): for each
   * (product, unit) of `supplierId`, the contract price in force today, in that
   * unit. Managers only (same as orders.createDraft). Flag off → `enabled: false`.
   */
  orderPrices: managerProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid(),
          items: z.array(z.object({ productId: z.string().uuid(), unit: z.string().trim().min(1).max(32) })).max(500),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      if (!(await isFeatureOn(ctx.db, rid, 'contracts'))) return { enabled: false, prices: [] };
      await assertSupplierOwned(ctx.db, input.supplierId, rid);
      const map = await contractPricesForOrder(ctx.db, rid, input.supplierId, input.items);
      const prices: Array<{ productId: string; unit: string; contractPrice: number }> = [];
      for (const it of input.items) {
        const contractPrice = map.get(orderPriceKey(it.productId, it.unit));
        if (contractPrice !== undefined) prices.push({ productId: it.productId, unit: it.unit, contractPrice });
      }
      return { enabled: true, prices };
    }),
});
