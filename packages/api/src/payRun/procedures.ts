/**
 * AU-14 · tRPC procedures for the pay-run pre-flight.
 *
 * NOT mounted in `routers/payRun.ts` yet: that file is W2-03's (#248) until it merges.
 * After that the router spreads `...preflightProcedures` (one line, through the orchestrator),
 * W2-03's `markPaid` makes ONE call to `assertPreflightClear`, and `coverage/AU-14.ts` lists
 * the paths. Until then the tests mount them on a local router.
 *
 *  • preflight       finance (owner / manager / bookkeeper): read-only. Flags per invoice + counts.
 *  • remittanceText  finance: a he/en text draft + wa.me / mailto links. Nothing is sent.
 *  • confirmBankChange (owner only): lands with H-03's `supplier_bank_account_changes`.
 *
 * Every procedure is restaurant-scoped. A foreign supplier or invoice id → NOT_FOUND.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, restaurants, sql, type Database } from '@restomatch/db';
import { featureEnabled } from '../lib/features';
import { localDateKeyInTz } from '../lib/time';
import { financeProcedure } from '../trpc';
import { PREFLIGHT_KINDS, checkPreflightClear, parseAgorot, type AcknowledgedFlags, type PreflightKind } from './preflight';
import { runPreflight, type BankChangeSource } from './preflightData';
import { claimShortNo, remittanceText, renderReason, shareLinks, type RemittanceOffset } from './remittanceText';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));

const kindSchema = z.enum(PREFLIGHT_KINDS as [PreflightKind, ...PreflightKind[]]);
export const acknowledgedFlagsSchema = z
  .array(z.object({ invoiceId: z.string().uuid(), kinds: z.array(kindSchema).max(5) }))
  .max(500)
  .default([]);

async function settingsOf(db: Database, rid: string): Promise<{ settings: unknown; tz: string; name: string }> {
  const [r] = await db
    .select({ settings: restaurants.settings, tz: restaurants.timezone, name: restaurants.name })
    .from(restaurants)
    .where(eq(restaurants.id, rid))
    .limit(1);
  return { settings: r?.settings ?? {}, tz: r?.tz ?? 'Asia/Jerusalem', name: r?.name ?? '' };
}

/**
 * Option `payRunPreflight`: defaults ON whenever `payRun` is on. Off hides the panel and drops
 * the soft checks only: the hard bank hold and a confirmed copy stay on regardless (AD12).
 * Interim location `settings.automations.payRunPreflight` until AU-01's registry row lands.
 */
export function preflightSoftChecksOn(settings: unknown): boolean {
  if (!featureEnabled(settings, 'payRun')) return false;
  const a = (settings as { automations?: { payRunPreflight?: boolean } } | null)?.automations;
  return a?.payRunPreflight !== false;
}

/**
 * The markPaid guard. W2-03's `markPaid` calls this once, before anything is written,
 * for the whole batch (all-or-nothing). Returns the acknowledged soft kinds per invoice
 * for the paid audit row (`automationId: 'A19'`).
 */
export async function assertPreflightClear(
  db: Database,
  restaurantId: string,
  invoiceIds: string[],
  acknowledged: AcknowledgedFlags,
  opts: { bank?: BankChangeSource; now?: Date } = {},
): Promise<Map<string, PreflightKind[]>> {
  const { settings, tz } = await settingsOf(db, restaurantId);
  const pre = await runPreflight(db, restaurantId, { invoiceIds, tz, bank: opts.bank, now: opts.now });
  const verdict = checkPreflightClear(pre.flags, invoiceIds, acknowledged, {
    softChecks: preflightSoftChecksOn(settings),
  });
  if (verdict.ok) return verdict.acknowledged;
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: verdict.reason,
    cause: {
      reason: verdict.reason,
      invoiceId: verdict.invoiceId,
      ...(verdict.reason === 'preflight_hold' ? { kind: verdict.kind } : { missing: verdict.missing }),
    },
  });
}

export function makePreflightProcedures(opts: { bank?: BankChangeSource; now?: () => Date } = {}) {
  return {
    preflight: financeProcedure
      .input(z.object({ invoiceIds: z.array(z.string().uuid()).max(500).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const rid = ctx.session.restaurantId;
        const { settings, tz } = await settingsOf(ctx.db, rid);
        const enabled = featureEnabled(settings, 'payRun');
        if (!enabled) return { enabled: false, softChecks: false, invoices: [], summary: null };
        const pre = await runPreflight(ctx.db, rid, {
          invoiceIds: input?.invoiceIds,
          tz,
          bank: opts.bank,
          now: opts.now?.(),
        });
        const softChecks = preflightSoftChecksOn(settings);
        const byId = new Map(pre.candidates.map((c) => [c.id, c]));
        const invoices = [...pre.flags.entries()]
          .map(([invoiceId, flags]) => ({
            invoiceId,
            invoiceNumber: byId.get(invoiceId)?.invoiceNumber ?? null,
            supplierId: byId.get(invoiceId)?.supplierId ?? null,
            supplierName: byId.get(invoiceId)?.supplierName ?? null,
            // Option off: only the blocking flags remain visible (AD12).
            flags: flags
              .filter((f) => softChecks || f.severity !== 'soft')
              .map((f) => ({
                ...f,
                atRiskIls: f.atRiskAgorot / 100,
                text: { he: renderReason(f, 'he'), en: renderReason(f, 'en') },
              })),
          }))
          .filter((i) => i.flags.length > 0)
          // Hard and hold rows first, then by ₪ at stake.
          .sort(
            (a, b) =>
              Number(b.flags.some((f) => f.severity !== 'soft')) - Number(a.flags.some((f) => f.severity !== 'soft')) ||
              (b.flags[0]?.atRiskAgorot ?? 0) - (a.flags[0]?.atRiskAgorot ?? 0),
          );
        const counts = Object.fromEntries(PREFLIGHT_KINDS.map((k) => [k, 0])) as Record<PreflightKind, number>;
        let atRiskAgorot = 0;
        for (const i of invoices) {
          for (const f of i.flags) counts[f.kind] += 1;
          atRiskAgorot += i.flags[0]?.atRiskAgorot ?? 0;
        }
        return {
          enabled: true,
          softChecks,
          invoices,
          summary: {
            counts,
            flags: invoices.reduce((s, i) => s + i.flags.length, 0),
            invoices: invoices.length,
            atRiskIls: atRiskAgorot / 100,
            blocked: invoices.filter((i) => i.flags.some((f) => f.severity !== 'soft')).length,
          },
        };
      }),

    remittanceText: financeProcedure
      .input(
        z.object({
          supplierId: z.string().uuid(),
          invoiceIds: z.array(z.string().uuid()).min(1).max(200),
          paidOn: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const rid = ctx.session.restaurantId;
        const { tz, name } = await settingsOf(ctx.db, rid);
        const supRes = await ctx.db.execute(sql`
          SELECT s.id, s.name, s.contact_email, s.contact_whatsapp FROM suppliers s
          WHERE s.id = ${input.supplierId} AND s.restaurant_id = ${rid}
        `);
        const sup = rowsOf(supRes)[0];
        if (!sup) throw new TRPCError({ code: 'NOT_FOUND', message: 'supplier not found' });

        const ids = sql.join(
          input.invoiceIds.map((i) => sql`${i}::uuid`),
          sql`, `,
        );
        // The paid invoices, plus this supplier's other unpaid invoices held on an UNDECIDED
        // (open / escalated) finding. Those are named "in review" only, with no ₪ and no reason.
        const invRes = await ctx.db.execute(sql`
          SELECT i.id, i.invoice_number, i.total_incl_vat, (i.id IN (${ids})) AS selected,
                 EXISTS (
                   SELECT 1 FROM match_runs mr
                   JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${rid}
                   WHERE mr.invoice_id = i.id AND mr.restaurant_id = ${rid}
                     AND d.severity IN ('warn', 'block') AND d.resolution_status IN ('open', 'escalated')
                     AND ABS(d.delta_amount) > 0
                 ) AS undecided
          FROM invoices i
          WHERE i.restaurant_id = ${rid} AND i.supplier_id = ${input.supplierId}
            AND (i.id IN (${ids}) OR (i.status NOT IN ('paid', 'ocr_pending')))
          ORDER BY COALESCE(i.invoice_date, i.created_at), i.invoice_number
        `);
        const rows = rowsOf(invRes);
        const selected = rows.filter((r) => r.selected === true);
        if (selected.length !== new Set(input.invoiceIds).size) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'invoice not found' });
        }
        // G-03 `payment_deductions` feed the offsets once deployed; none until then.
        const offsets: RemittanceOffset[] = [];
        const draft = remittanceText({
          supplierName: String(sup.name),
          restaurantName: name,
          paidOn: input.paidOn ?? localDateKeyInTz(opts.now?.() ?? new Date(), tz),
          paid: selected.map((r) => ({
            invoiceId: String(r.id),
            invoiceNumber: r.invoice_number == null ? null : String(r.invoice_number),
            totalAgorot: parseAgorot(r.total_incl_vat),
          })),
          offsets,
          inReview: rows
            .filter((r) => r.selected !== true && r.undecided === true)
            .map((r) => ({
              invoiceId: String(r.id),
              invoiceNumber: r.invoice_number == null ? null : String(r.invoice_number),
            })),
        });
        const contacts = {
          whatsapp: sup.contact_whatsapp == null ? null : String(sup.contact_whatsapp),
          email: sup.contact_email == null ? null : String(sup.contact_email),
        };
        return {
          he: draft.he,
          en: draft.en,
          netIls: draft.netAgorot / 100,
          links: {
            he: shareLinks(draft.he, contacts, `תשלום מ-${name}`),
            en: shareLinks(draft.en, contacts, `Payment from ${name}`),
          },
        };
      }),
  };
}

export { claimShortNo };
