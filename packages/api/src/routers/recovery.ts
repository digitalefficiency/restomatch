import { RECOVERY_STATUSES } from '@restomatch/db';
import { z } from 'zod';
import { assertFeatureOn, isFeatureOn } from '../lib/featureGate';
import {
  claimHistory,
  computeRecoverySummary,
  creditLineSuggestions,
  creditVatRateBp,
  exclVatAgorot,
  listClaims,
  lockClaims,
  MAX_CLAIMS,
  recordCreditNote,
  returnedInMonth,
  summarize,
  transitionClaim,
  transitionClaims,
} from '../recovery/service';
import { exportRecovery } from '../recovery/export';
import { buildClaimLetters, sendLetter, unsendLetter } from '../recovery/letters';
import { supplierReminderDraft } from '../recovery/reminders';
import { financeProcedure, memberProcedure } from '../trpc';
import { router } from '../trpc';

/**
 * "₪ back" tracker (flag `recovery`). Money is integer agorot end to end; the
 * web formats with formatIls() at display. Every procedure runs under RLS
 * (member transaction) and filters by ctx.session.restaurantId; client ids are
 * verified to belong to the restaurant before any write (service.ts).
 */
const flagged = <T extends typeof financeProcedure | typeof memberProcedure>(p: T) =>
  p.use(async ({ ctx, next }) => {
    await assertFeatureOn(ctx.db, ctx.session.restaurantId, 'recovery');
    return next();
  }) as T;

const recoveryProcedure = flagged(financeProcedure);
const status = z.enum(RECOVERY_STATUSES);
const monthOffset = z.number().int().min(-24).max(0).optional();

export const recoveryRouter = router({
  /** Which of this area's flags are on for the caller's restaurant (nav / hero / routes). Never gated. */
  flags: memberProcedure.query(async ({ ctx }) => {
    const [recovery, monthlyReport, monthlyDigestPreview, leakProof] = await Promise.all([
      isFeatureOn(ctx.db, ctx.session.restaurantId, 'recovery'),
      isFeatureOn(ctx.db, ctx.session.restaurantId, 'monthlyReport'),
      isFeatureOn(ctx.db, ctx.session.restaurantId, 'monthlyDigestPreview'),
      isFeatureOn(ctx.db, ctx.session.restaurantId, 'leakProof'),
    ]);
    return { recovery, monthlyReport, monthlyDigestPreview, leakProof };
  }),

  /**
   * Totals, ageing, per-supplier recovery rate + this month's returned ₪.
   * A read writes nothing: claims are created at decision time
   * (`materializeClaims`, W2-10a), never by whoever opens the screen.
   */
  summary: recoveryProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const [claims, returned] = await Promise.all([
      listClaims(ctx.db, ctx.session.restaurantId, { now, limit: null }),
      returnedInMonth(ctx.db, ctx.session.restaurantId, { now }),
    ]);
    return { summary: summarize(claims), returnedThisMonth: returned };
  }),

  /** One page of claims; `limit` (default 200, at most MAX_CLAIMS) lets a screen that sums them ask for all. */
  list: recoveryProcedure
    .input(
      z
        .object({
          status: status.optional(),
          supplierId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(MAX_CLAIMS).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      // Read-only (W2-10a): no claim is materialised here.
      return listClaims(ctx.db, ctx.session.restaurantId, {
        status: input?.status,
        supplierId: input?.supplierId,
        limit: input?.limit,
      });
    }),

  history: recoveryProcedure
    .input(z.object({ claimId: z.string().uuid() }))
    .query(({ ctx, input }) => claimHistory(ctx.db, ctx.session.restaurantId, input.claimId)),

  /**
   * Move one or more claims (letter sent, acknowledged, disputed, written off,
   * recovered, re-open).
   *  - `items[{claimId, expectedStatus}]` (W2-10, the desk): all-or-nothing,
   *    a per-item CONFLICT when a claim moved meanwhile, and a reason on
   *    terminal edges (`requiresReason`).
   *  - `claimIds` (legacy, wave-1 callers and the attack suite): unguarded
   *    single moves in one transaction. TODO(W2-10): drop once no caller sends it.
   */
  transition: recoveryProcedure
    .input(
      z
        .object({
          claimIds: z.array(z.string().uuid()).min(1).max(200).optional(),
          items: z
            .array(z.object({ claimId: z.string().uuid(), expectedStatus: status }))
            .min(1)
            .max(200)
            .optional(),
          to: status.exclude(['credited']),
          note: z.string().trim().max(500).optional(),
        })
        .refine((v) => (v.claimIds ? 1 : 0) + (v.items ? 1 : 0) === 1, { message: 'send claimIds or items, not both' }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.items) {
        return transitionClaims(ctx.db, ctx.session.restaurantId, {
          items: input.items,
          to: input.to,
          note: input.note ?? null,
          actorId: ctx.session.userId,
        });
      }
      const out = [];
      const ids = await lockClaims(ctx.db, ctx.session.restaurantId, input.claimIds!);
      for (const claimId of ids) {
        out.push(
          await transitionClaim(ctx.db, ctx.session.restaurantId, {
            claimId,
            to: input.to,
            note: input.note ?? null,
            actorId: ctx.session.userId,
          }),
        );
      }
      return out;
    }),

  /** Credit note — manual (supplier, number, amount, date) or matched to a later invoice's credit line. */
  recordCreditNote: recoveryProcedure
    .input(
      z
        .object({
          claimIds: z.array(z.string().uuid()).min(1).max(200),
          supplierId: z.string().uuid().optional(),
          number: z.string().trim().max(64).optional(),
          /** Legacy: the amount BEFORE VAT. The desk sends `printedAgorot` + `vat` instead. */
          amountAgorot: z.number().int().positive().max(100_000_000_00).optional(),
          /** The amount exactly as printed on the credit note … */
          printedAgorot: z.number().int().positive().max(100_000_000_00).optional(),
          /** … and how it was printed: incl. or excl. VAT. No default (chain-09). */
          vat: z.enum(['incl', 'excl']).optional(),
          issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          invoiceLineId: z.string().uuid().optional(),
          note: z.string().trim().max(500).optional(),
          /** One per form submission (client crypto.randomUUID()): a double submit records once. */
          idempotencyKey: z.string().uuid().optional(),
        })
        .refine((v) => (v.printedAgorot == null) === (v.vat == null), {
          message: 'a printed amount needs its VAT mode (incl. or excl.)',
        })
        .refine((v) => !(v.printedAgorot != null && v.amountAgorot != null), { message: 'send amountAgorot or printedAgorot, not both' })
        .refine((v) => v.invoiceLineId || (v.supplierId && (v.amountAgorot || v.printedAgorot) && v.issuedOn), {
          message: 'manual credit notes need supplier, amount and date',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const { printedAgorot, vat, ...rest } = input;
      let amountAgorot = rest.amountAgorot;
      if (printedAgorot != null && vat && rest.supplierId && !rest.invoiceLineId) {
        // Server-side conversion, in agorot, half-up, at the supplier's rate.
        const rateBp = await creditVatRateBp(ctx.db, ctx.session.restaurantId, rest.supplierId);
        amountAgorot = exclVatAgorot(printedAgorot, vat, rateBp);
      }
      return recordCreditNote(ctx.db, ctx.session.restaurantId, { ...rest, amountAgorot, actorId: ctx.session.userId });
    }),

  /**
   * Claim letters (W2-10): one draft per supplier, built ONLY from that
   * supplier's `claimed` claims, in two sections (before payment / for credit).
   * Reads only.
   */
  letters: recoveryProcedure
    .input(z.object({ supplierId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) => buildClaimLetters(ctx.db, ctx.session.restaurantId, { supplierId: input?.supplierId })),

  /** Confirm a letter went out (after the hand-off + 10 s undo): its claims → letter_sent, all or nothing. */
  sendLetter: recoveryProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        claimIds: z.array(z.string().uuid()).min(1).max(500),
        channel: z.enum(['whatsapp', 'email', 'print']),
      }),
    )
    .mutation(({ ctx, input }) => sendLetter(ctx.db, ctx.session.restaurantId, { ...input, actorId: ctx.session.userId })),

  /** Take a sent letter back within the window (guarded letter_sent → claimed). */
  unsendLetter: recoveryProcedure
    .input(z.object({ claimIds: z.array(z.string().uuid()).min(1).max(500) }))
    .mutation(({ ctx, input }) => unsendLetter(ctx.db, ctx.session.restaurantId, { claimIds: input.claimIds, actorId: ctx.session.userId })),

  /** Owner decision 16: the data of a per-supplier overdue reminder DRAFT (opened on a click; nothing is sent). */
  reminderDraft: recoveryProcedure
    .input(z.object({ supplierId: z.string().uuid() }))
    .query(({ ctx, input }) => supplierReminderDraft(ctx.db, ctx.session.restaurantId, input.supplierId)),

  /** CSV / XLSX of every claim (no 200-row cut) plus its history. */
  export: recoveryProcedure
    .input(z.object({ format: z.enum(['csv', 'xlsx']), status: status.optional(), supplierId: z.string().uuid().optional() }))
    .query(({ ctx, input }) => exportRecovery(ctx.db, ctx.session.restaurantId, input)),

  creditLineSuggestions: recoveryProcedure
    .input(z.object({ supplierId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) => creditLineSuggestions(ctx.db, ctx.session.restaurantId, input ?? {})),

  /** Hero tile: "₪ actually returned this month" — aggregate only, any member (like the hero). */
  returnedThisMonth: flagged(memberProcedure)
    .input(z.object({ monthOffset }).optional())
    .query(({ ctx, input }) => returnedInMonth(ctx.db, ctx.session.restaurantId, { monthOffset: input?.monthOffset })),
});

export { computeRecoverySummary };
