import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, asc, eq, suppliers, type Supplier } from '@restomatch/db';
import { OrderSchedule } from '@restomatch/types';
import { managerProcedure, memberProcedure, router } from '../trpc';
import { assertSupplierOwned } from '../tenant';

/**
 * Supplier setup (Phase-2). The CRUD surface for the suppliers a restaurant
 * orders from. Reads are open to any member (the catalog / order builders need
 * the list); writes are manager+ (managerProcedure). Suppliers are never hard-
 * deleted (purchase_orders.supplier_id is onDelete:restrict) — `setActive`
 * soft-deactivates instead.
 *
 * Platform-synced suppliers carry sourcePlatform/externalRef; this router only
 * creates/edits manual ones, leaving those columns null.
 */

const timeList = z.array(z.string().trim().min(1).max(16)).max(12);

/** Validates the DeliverySchedule jsonb (Partial<Record<day, string[]>>). */
const DeliveryScheduleSchema = z
  .object({
    sun: timeList.optional(),
    mon: timeList.optional(),
    tue: timeList.optional(),
    wed: timeList.optional(),
    thu: timeList.optional(),
    fri: timeList.optional(),
    sat: timeList.optional(),
  })
  .strict();

const SupplierCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    businessId: z.string().trim().max(32).optional(),
    contactEmail: z.string().trim().email().max(200).optional(),
    contactWhatsapp: z.string().trim().max(32).optional(),
    paymentTerms: z.string().trim().max(500).optional(),
    deliverySchedule: DeliveryScheduleSchema.optional(),
    /** ACTIONABLE order cadence (drives expectedDeliveryAt). Info-only deliverySchedule stays separate. */
    orderSchedule: OrderSchedule.optional(),
  })
  .strict();

/** Patch: undefined = leave untouched; explicit null clears a nullable field. */
const SupplierPatch = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    businessId: z.string().trim().max(32).nullish(),
    contactEmail: z.string().trim().email().max(200).nullish(),
    contactWhatsapp: z.string().trim().max(32).nullish(),
    paymentTerms: z.string().trim().max(500).nullish(),
    deliverySchedule: DeliveryScheduleSchema.nullish(),
    orderSchedule: OrderSchedule.nullish(),
  })
  .strict();

function mustExist<T>(row: T | undefined, what: string): T {
  if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `${what} write returned no row` });
  return row;
}

export const suppliersRouter = router({
  /** All suppliers for the caller's restaurant, active-only by default. */
  list: memberProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }): Promise<Supplier[]> => {
      const where = input?.includeInactive
        ? eq(suppliers.restaurantId, ctx.session.restaurantId)
        : and(eq(suppliers.restaurantId, ctx.session.restaurantId), eq(suppliers.active, true));
      return ctx.db.select().from(suppliers).where(where).orderBy(asc(suppliers.name));
    }),

  get: memberProcedure
    .input(z.object({ supplierId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<Supplier> => {
      await assertSupplierOwned(ctx.db, input.supplierId, ctx.session.restaurantId);
      const [row] = await ctx.db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, input.supplierId))
        .limit(1);
      return mustExist(row, 'supplier');
    }),

  create: managerProcedure
    .input(SupplierCreate)
    .mutation(async ({ ctx, input }): Promise<Supplier> => {
      const [row] = await ctx.db
        .insert(suppliers)
        .values({
          restaurantId: ctx.session.restaurantId,
          name: input.name,
          businessId: input.businessId ?? null,
          contactEmail: input.contactEmail ?? null,
          contactWhatsapp: input.contactWhatsapp ?? null,
          paymentTerms: input.paymentTerms ?? null,
          deliverySchedule: input.deliverySchedule ?? null,
          orderSchedule: input.orderSchedule ?? null,
        })
        .returning();
      return mustExist(row, 'supplier');
    }),

  update: managerProcedure
    .input(z.object({ supplierId: z.string().uuid(), patch: SupplierPatch }))
    .mutation(async ({ ctx, input }): Promise<Supplier> => {
      await assertSupplierOwned(ctx.db, input.supplierId, ctx.session.restaurantId);
      const set: Partial<typeof suppliers.$inferInsert> = { updatedAt: new Date() };
      const { patch } = input;
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.businessId !== undefined) set.businessId = patch.businessId;
      if (patch.contactEmail !== undefined) set.contactEmail = patch.contactEmail;
      if (patch.contactWhatsapp !== undefined) set.contactWhatsapp = patch.contactWhatsapp;
      if (patch.paymentTerms !== undefined) set.paymentTerms = patch.paymentTerms;
      if (patch.deliverySchedule !== undefined) set.deliverySchedule = patch.deliverySchedule;
      if (patch.orderSchedule !== undefined) set.orderSchedule = patch.orderSchedule;
      const [row] = await ctx.db
        .update(suppliers)
        .set(set)
        .where(
          and(eq(suppliers.id, input.supplierId), eq(suppliers.restaurantId, ctx.session.restaurantId)),
        )
        .returning();
      return mustExist(row, 'supplier');
    }),

  setActive: managerProcedure
    .input(z.object({ supplierId: z.string().uuid(), active: z.boolean() }))
    .mutation(async ({ ctx, input }): Promise<Supplier> => {
      await assertSupplierOwned(ctx.db, input.supplierId, ctx.session.restaurantId);
      const [row] = await ctx.db
        .update(suppliers)
        .set({ active: input.active, updatedAt: new Date() })
        .where(
          and(eq(suppliers.id, input.supplierId), eq(suppliers.restaurantId, ctx.session.restaurantId)),
        )
        .returning();
      return mustExist(row, 'supplier');
    }),
});
