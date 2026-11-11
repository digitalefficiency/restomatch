import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, eq, inArray, invoices, restaurants, suppliers, type Database, type UserRole } from '@restomatch/db';
import { featureEnabled } from '../lib/features';
import { memberProcedure, router } from '../trpc';
import {
  allocationRequestDraft,
  priorAllocationEvents,
  recordAllocationEvent,
  VAT_ALLOCATION_REQUESTED,
  VAT_ALLOCATION_SET,
  type AllocationRequestDraft,
} from '../vat/allocationCase';
import { daysSinceRequest, israelDay, normaliseAllocationNumber } from '../vat/caseState';
import { ITA_VERIFY_DISCLAIMER_HE, ITA_VERIFY_URL, itaVerifyFields, type ItaField } from '../vat/itaVerify';
import { vatAtRisk, type VatAtRiskRow } from '../vat/vatAtRisk';

/**
 * AU-08 (catalogue A13) — allocation-number guard and chase. Behind the
 * existing `vatAtRisk` flag: when it is off every procedure returns `null`
 * (the UI hides). VAT ₪ is "מע״מ בסיכון", never part of the leak.
 *
 * Roles (server): reads = owner, manager, bookkeeper; writes =
 * ALLOCATION_WRITE_ROLES. Receiver and chef are FORBIDDEN everywhere.
 * Nothing here sends anything to a supplier: the UI hands off via wa.me /
 * mailto / copy and then calls `markRequested`.
 */

/** Who may set the number or mark a request sent. Manager only on the owner's word. */
export const ALLOCATION_WRITE_ROLES: ReadonlyArray<UserRole> = ['owner', 'bookkeeper'];
/** Who may read the case (VAT ₪ included). */
export const ALLOCATION_READ_ROLES: ReadonlyArray<UserRole> = ['owner', 'manager', 'bookkeeper'];

function roles(allowed: ReadonlyArray<UserRole>) {
  return memberProcedure.use(({ ctx, next }) => {
    if (!allowed.includes(ctx.session.role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `Required role: ${allowed.join('|')}, got: ${ctx.session.role}` });
    }
    return next();
  });
}
const readProcedure = roles(ALLOCATION_READ_ROLES);
const writeProcedure = roles(ALLOCATION_WRITE_ROLES);

async function flagOn(db: Database, restaurantId: string): Promise<boolean> {
  const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  return featureEnabled(r?.settings, 'vatAtRisk');
}

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'not found' });

const ClientMutationId = z.string().trim().min(8).max(64);

export interface SetAllocationResult {
  invoiceId: string;
  allocationNumber: string;
  /** True when this call replayed an earlier one with the same clientMutationId. */
  replayed: boolean;
}

export interface MarkRequestedResult {
  supplierId: string;
  invoiceIds: string[];
  requestedAt: string;
  replayed: boolean;
}

export interface InvoiceCase {
  /** The at-risk row with its case state, or null when the invoice is not at risk (any more). */
  row: VatAtRiskRow | null;
  /** Days since the latest request (for "נשלחה בקשה לפני N ימים"), or null. */
  daysSinceRequest: number | null;
  ita: { fields: ItaField[]; url: string | null; disclaimerHe: string };
  canWrite: boolean;
}

export const vatRouter = router({
  /** The cockpit strip for one invoice (AC 7). Null when the flag is off. */
  invoiceCase: readProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<InvoiceCase | null> => {
      const rid = ctx.session.restaurantId;
      if (!(await flagOn(ctx.db, rid))) return null;
      const [inv] = await ctx.db
        .select({ id: invoices.id, supplierId: invoices.supplierId })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, rid)))
        .limit(1);
      if (!inv) throw notFound();
      const res = await vatAtRisk(ctx.db, rid, 'all', { invoiceId: inv.id });
      const row = res.rows[0] ?? null;
      const [sup] = inv.supplierId
        ? await ctx.db
            .select({ businessId: suppliers.businessId })
            .from(suppliers)
            .where(and(eq(suppliers.id, inv.supplierId), eq(suppliers.restaurantId, rid)))
            .limit(1)
        : [];
      return {
        row,
        daysSinceRequest: row ? daysSinceRequest(row.requestedAt, israelDay(new Date())) : null,
        ita: {
          fields: row
            ? itaVerifyFields(
                {
                  allocationNumber: row.allocationNumber,
                  invoiceNumber: row.invoiceNumber,
                  invoiceDate: row.invoiceDate,
                  totalExclVat: row.totalExclVat,
                  vatAmount: row.vatAtRisk,
                },
                sup ?? null,
              )
            : [],
          url: ITA_VERIFY_URL,
          disclaimerHe: ITA_VERIFY_DISCLAIMER_HE,
        },
        canWrite: ALLOCATION_WRITE_ROLES.includes(ctx.session.role),
      };
    }),

  /** The pre-addressed request for one supplier (AC 3). Null when the flag is off. */
  requestDraft: readProcedure
    .input(z.object({ supplierId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<(AllocationRequestDraft & { canWrite: boolean }) | null> => {
      const rid = ctx.session.restaurantId;
      if (!(await flagOn(ctx.db, rid))) return null;
      const draft = await allocationRequestDraft(ctx.db, rid, input.supplierId);
      if (!draft) throw notFound();
      // The card shows "סמנו כנשלח" only to the roles markRequested accepts.
      return { ...draft, canWrite: ALLOCATION_WRITE_ROLES.includes(ctx.session.role) };
    }),

  /**
   * Store the allocation number (AC 1). Writes `invoices.allocation_number`
   * and one `vat.allocation_set` audit row. Never re-runs the match and never
   * touches any leak, claim or pay-run figure (the engine does not read it).
   */
  setAllocationNumber: writeProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        allocationNumber: z.string().max(40),
        source: z.enum(['typed', 'corrected_copy']),
        clientMutationId: ClientMutationId,
      }),
    )
    .mutation(async ({ ctx, input }): Promise<SetAllocationResult | null> => {
      const rid = ctx.session.restaurantId;
      if (!(await flagOn(ctx.db, rid))) return null;
      const [prior] = await priorAllocationEvents(ctx.db, rid, VAT_ALLOCATION_SET, input.clientMutationId);
      if (prior) {
        const after = prior.after as { allocationNumber?: string } | null;
        return { invoiceId: prior.invoiceId ?? input.invoiceId, allocationNumber: after?.allocationNumber ?? '', replayed: true };
      }
      const value = normaliseAllocationNumber(input.allocationNumber);
      if (!value) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'מספר הקצאה הוא 9 ספרות' });
      }
      const [inv] = await ctx.db
        .select({ id: invoices.id, allocationNumber: invoices.allocationNumber })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, rid)))
        .limit(1);
      if (!inv) throw notFound();
      if (input.source === 'corrected_copy') {
        // The chip only offers a number read from a corrected copy of THIS invoice.
        const res = await vatAtRisk(ctx.db, rid, 'all', { invoiceId: inv.id });
        if (res.rows[0]?.suggestedNumber?.value !== value) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'אין חשבונית מתוקנת עם המספר הזה' });
        }
      }
      await ctx.db
        .update(invoices)
        .set({ allocationNumber: value })
        .where(and(eq(invoices.id, inv.id), eq(invoices.restaurantId, rid)));
      await recordAllocationEvent(ctx.db, {
        restaurantId: rid,
        userId: ctx.session.userId,
        action: VAT_ALLOCATION_SET,
        invoiceId: inv.id,
        before: { allocationNumber: inv.allocationNumber },
        after: { allocationNumber: value, source: input.source, clientMutationId: input.clientMutationId },
      });
      return { invoiceId: inv.id, allocationNumber: value, replayed: false };
    }),

  /**
   * Record that the owner handed a request to the supplier (AC 4): one
   * `vat.allocation_requested` audit row per invoice. The server sends nothing.
   */
  markRequested: writeProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        invoiceIds: z.array(z.string().uuid()).min(1).max(200),
        channel: z.enum(['whatsapp', 'email', 'copy']),
        clientMutationId: ClientMutationId,
      }),
    )
    .mutation(async ({ ctx, input }): Promise<MarkRequestedResult | null> => {
      const rid = ctx.session.restaurantId;
      if (!(await flagOn(ctx.db, rid))) return null;
      const prior = await priorAllocationEvents(ctx.db, rid, VAT_ALLOCATION_REQUESTED, input.clientMutationId);
      if (prior.length) {
        return {
          supplierId: input.supplierId,
          invoiceIds: prior.map((p) => p.invoiceId).filter((x): x is string => !!x),
          requestedAt: prior[0]!.at.toISOString(),
          replayed: true,
        };
      }
      const [sup] = await ctx.db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.restaurantId, rid)))
        .limit(1);
      if (!sup) throw notFound();
      const ids = [...new Set(input.invoiceIds)];
      const found = await ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.restaurantId, rid), eq(invoices.supplierId, sup.id), inArray(invoices.id, ids)));
      if (found.length !== ids.length) throw notFound();
      for (const id of ids) {
        await recordAllocationEvent(ctx.db, {
          restaurantId: rid,
          userId: ctx.session.userId,
          action: VAT_ALLOCATION_REQUESTED,
          invoiceId: id,
          after: { supplierId: sup.id, channel: input.channel, clientMutationId: input.clientMutationId },
        });
      }
      return { supplierId: sup.id, invoiceIds: ids, requestedAt: new Date().toISOString(), replayed: false };
    }),
});
