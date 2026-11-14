import { z } from 'zod';
import {
  and,
  auditLog,
  desc,
  discrepancies,
  eq,
  inArray,
  invoiceLines,
  matchRuns,
  memberships,
  products,
  restaurants,
  sql,
  users,
  type Database,
  type RestaurantSettings,
} from '@restomatch/db';
import { notZeroShortTwin } from '@restomatch/charts';
import { resolveTolerances, runMatch, toAgorot, type MatchInput, type MatchOutput } from '@restomatch/matching';
import { DEFAULT_REVIEW_THRESHOLD } from '@restomatch/ocr';
import { buildRules, evaluateApproval, resolveApprovalThresholds, type ApprovalContext } from '../approvals/engine';
import { DISCREPANCY_DECIDABLE } from '../lifecycle/predicates';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { discrepancyKey } from '../match/persist';
import { recordAudit, type AuditAction } from '../audit';
import { appError } from '../errors';
import { vatRateOf } from '../lib/vat';
import { financeProcedure, managerProcedure, memberProcedure, ownerProcedure, router } from '../trpc';
import { hasNoControlChars, NO_CONTROL_CHARS_MESSAGE } from '../lib/text';

/**
 * W2-14 audit actions. G-05 pre-adds them to the `AuditAction` union
 * (`claude/ux-g-05-write-kernel`); until it is on main they are cast here.
 * TODO(W2-14 rebase): drop the casts once G-05 merges.
 */
const SETTINGS_UPDATED = 'settings.updated' as AuditAction;
const SETTINGS_PROFILE_UPDATED = 'settings.profile_updated' as AuditAction;
const SETTINGS_ACTIONS = [SETTINGS_UPDATED, SETTINGS_PROFILE_UPDATED] as const;

/**
 * Per-restaurant matching-rules editor (Phase 5).
 *
 * The worker reads `restaurants.settings.tolerances` (via resolveTolerances)
 * and `restaurants.settings.approvalThresholds` (via resolveApprovalThresholds),
 * plus `settings.ocrReviewThreshold`. This router is the owner-facing editor for
 * those JSONB knobs — it does a read-modify-write merge scoped to the caller's
 * restaurant so unrelated keys (e.g. baselineWindowDays) survive an update.
 */

/** A non-negative finite number bounded by `max`, used for tolerance/threshold knobs. */
const boundedNonNeg = (max: number) => z.number().finite().nonnegative().max(max);
/** A fraction in [0, 1] (e.g. percent tolerances stored as 0.05 = 5%). */
const fraction = z.number().finite().min(0).max(1);
/** A knob value, or `null` = remove the override and fall back to the engine default. */
const knob = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

const TolerancesSchema = z
  .object({
    pricePercent: knob(fraction),
    priceAbsolute: knob(boundedNonNeg(1_000_000)),
    qtyPercent: knob(fraction),
    qtyAbsolute: knob(boundedNonNeg(1_000_000)),
    blockPricePercent: knob(fraction),
  })
  .strict();

const ApprovalThresholdsSchema = z
  .object({
    largeInvoiceWithoutPo: knob(boundedNonNeg(100_000_000)),
    unorderedItemSignificant: knob(boundedNonNeg(100_000_000)),
    cumulativeLargeAmount: knob(boundedNonNeg(100_000_000)),
    cumulativeLargePct: knob(fraction),
    cumulativeMediumAmountMin: knob(boundedNonNeg(100_000_000)),
    cumulativeMediumPctMin: knob(fraction),
  })
  .strict();

const UpdateInput = z
  .object({
    tolerances: TolerancesSchema.optional(),
    approvalThresholds: ApprovalThresholdsSchema.optional(),
    ocrReviewThreshold: knob(fraction),
  })
  .strict();

/** A valid IANA timezone (e.g. Asia/Jerusalem) — load-bearing for day boundaries. */
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'אזור זמן לא תקין', params: { appCode: 'settings.invalidTimezone' } },
  );

/** Restaurant profile patch. vatRate is a fraction (0.18 = 18%). businessId
 *  nullable so it can be cleared. At least one field required. */
const ProfileUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(200).refine(hasNoControlChars, NO_CONTROL_CHARS_MESSAGE).optional(),
    businessId: z.string().trim().max(32).nullable().optional(),
    vatRate: fraction.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'אין שינויים לעדכן', params: { appCode: 'settings.noChanges' } });

/**
 * Merge a partial patch over the stored knobs. `undefined` leaves a knob alone;
 * `null` DELETES the key (restores the engine default). Writing `null` would not
 * do: `resolve*` would still see the key, so the key must be gone.
 */
function mergeKnobs<T extends Record<string, number | undefined>>(
  current: T | undefined,
  patch: Record<string, number | null | undefined>,
): T {
  const out: Record<string, number | undefined> = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

export interface EffectiveValue {
  value: number;
  /** true = no override stored, the engine default is in force. */
  isDefault: boolean;
}

/**
 * The values the engine ACTUALLY enforces for a settings blob: the stored
 * override, else the default. Defaults come from the engine's own resolvers
 * (`resolveTolerances`, `resolveApprovalThresholds`, `DEFAULT_REVIEW_THRESHOLD`)
 * and are never redefined here.
 */
export function effectiveSettings(settings: RestaurantSettings) {
  const tol = resolveTolerances(settings.tolerances);
  const appr = resolveApprovalThresholds(settings.approvalThresholds);
  const pick = <T extends Record<string, number>>(resolved: T, stored: Partial<T> | undefined) =>
    Object.fromEntries(
      Object.entries(resolved).map(([k, value]) => [
        k,
        { value, isDefault: stored?.[k as keyof T] == null } satisfies EffectiveValue,
      ]),
    ) as { [K in keyof T]: EffectiveValue };
  return {
    tolerances: pick(tol, settings.tolerances),
    approvalThresholds: pick(appr, settings.approvalThresholds),
    ocrReviewThreshold: {
      value: settings.ocrReviewThreshold ?? DEFAULT_REVIEW_THRESHOLD,
      isDefault: settings.ocrReviewThreshold == null,
    } satisfies EffectiveValue,
  };
}

/**
 * Normalise an Israeli phone number to E.164 (+972…). Accepts local forms
 * ("050-123 4567", "03-1234567") and international ones ("+972 50…", "00972…").
 * Returns null when it is not a plausible Israeli number (8–9 national digits).
 */
export function normalizeIlPhone(raw: string): string | null {
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `972${d.slice(1)}`;
  if (!/^972\d+$/.test(d)) return null;
  const national = d.slice(3).replace(/^0/, '');
  if (!/^[2-9]\d{7,8}$/.test(national)) return null;
  return `+972${national}`;
}

/** Owner/admin connection: `users` is REVOKE'd from the tenant app role (rls.ts). */
function adminConn(ctx: { adminDb?: Database; db: Database }): Database {
  return ctx.adminDb ?? ctx.db;
}

/**
 * The letterhead of the supplier credit-request letters (בקשת זיכוי):
 * restaurants.settings.letterhead (JSONB, no migration), every field optional.
 * An empty string clears a field.
 */
const textField = (max: number) => z.string().trim().max(max).refine(hasNoControlChars, NO_CONTROL_CHARS_MESSAGE);
export const LetterheadInput = z
  .object({
    legalName: textField(200).optional(),
    /** ח״פ / עוסק מורשה: 9 digits. */
    businessId: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\d{9}$/.test(v), 'businessId must be 9 digits')
      .optional(),
    address: textField(300).optional(),
    /** An Israeli number: 0X… or +972…, 9–10 digits once spaces / dashes are dropped. */
    phone: z
      .string()
      .trim()
      .max(32)
      .refine((v) => v === '' || /^(?:\+972|0)\d{8,9}$/.test(v.replace(/[\s-]/g, '')), 'invalid phone number')
      .optional(),
    email: z
      .string()
      .trim()
      .max(200)
      .refine((v) => v === '' || z.string().email().safeParse(v).success, 'invalid email')
      .optional(),
  })
  .strict();
export const LETTERHEAD_FIELDS = ['legalName', 'businessId', 'address', 'phone', 'email'] as const;
export type Letterhead = Partial<Record<(typeof LETTERHEAD_FIELDS)[number], string>>;

/** The stored letterhead, defensively (only non-empty strings of the known fields). */
export function letterheadOf(settings: unknown): Letterhead {
  const raw = (settings as { letterhead?: unknown } | null | undefined)?.letterhead;
  const out: Letterhead = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of LETTERHEAD_FIELDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 * DS3-06 · what a threshold change WOULD do to the gaps open now (read-only).
 *
 * Thresholds are read when an invoice is matched; saving starts no re-match, so
 * a saved change acts only on invoices checked from then on and every open gap
 * stays open. The preview answers a conditional question instead: had these
 * thresholds been in force, which of today's open gaps would have been opened?
 * It never re-implements a rule. For each invoice with open gaps it rebuilds the
 * engine's input exactly as a re-match does (buildMatchInputForInvoice, pinned
 * to the run's order), runs the matching engine (packages/matching, immutable)
 * twice — with the thresholds in force and with the proposal — and routes each
 * finding through the approvals engine as persistMatchRun does (auto-approved =
 * never open). A stored gap counts only when the re-run with the thresholds in
 * force reproduces it (data that moved since cannot be attributed to a
 * threshold), so the answer never claims fewer open gaps than there are.
 * Nothing is written.
 * ────────────────────────────────────────────────────────────────────────── */

/** At most this many invoices are re-run per preview (newest gaps first); the rest are reported as not re-run. */
export const PREVIEW_MAX_INVOICES = 60;
/** At most this many named gaps in "לא היו נפתחים". */
export const PREVIEW_MAX_NAMED = 5;

const PreviewInput = z
  .object({
    tolerances: TolerancesSchema.optional(),
    approvalThresholds: ApprovalThresholdsSchema.optional(),
  })
  .strict();

export interface ThresholdPreview {
  /** Open gaps today (open + escalated), as the approvals queue counts them. */
  openNow: number;
  /** False when the proposal equals the thresholds in force (then only `openNow` is computed). */
  changed: boolean;
  /** Open gaps the re-run with the thresholds in force reproduced (the base of the conditional). */
  considered: number;
  /** Of `considered`: would still have been opened with the proposal. */
  wouldOpen: number;
  /** Of `wouldOpen`: would block payment (severity block). */
  wouldBlock: number;
  /** Of `considered`: would not have been opened with the proposal. */
  notOpenedCount: number;
  /** Their gap amounts, before VAT, in integer agorot. */
  notOpenedAgorot: number;
  /** The largest of them (label = the product, else the invoice line), at most PREVIEW_MAX_NAMED. */
  notOpened: Array<{ label: string | null; amountAgorot: number }>;
  /** Invoices with open gaps that were re-run. */
  evaluatedInvoices: number;
  /** Invoices with open gaps beyond PREVIEW_MAX_INVOICES (not re-run; their gaps count as staying open). */
  skippedInvoices: number;
}

type OpenFinding = { severity: string };

/**
 * The findings of one engine run that would be OPEN once persisted: the same
 * approval context persistMatchRun builds (match/persist.ts), auto-approved ones
 * dropped. Keyed by discrepancyKey, a list per key (two findings may share one).
 */
function openFindingsOf(
  input: MatchInput,
  output: MatchOutput,
  rules: ReturnType<typeof buildRules>,
): Map<string, OpenFinding[]> {
  const byKey = new Map<string, OpenFinding[]>();
  for (const d of output.discrepancies) {
    const ctx: ApprovalContext = {
      discrepancy: { type: d.type, severity: d.severity, deltaAmount: d.deltaAmount },
      matchRun: {
        totalDiscrepancyAmount: output.totalDiscrepancyAmount,
        totalInvoiceAmount: input.invoice.totalInclVat,
        poExists: input.poLines.length > 0,
      },
    };
    if (evaluateApproval(ctx, rules).action === 'auto_approve') continue;
    const key = discrepancyKey({
      type: d.type,
      invoiceLineId: d.invoiceLineId ?? null,
      poLineId: d.poLineId ?? null,
      productId: d.productId,
    });
    const list = byKey.get(key);
    if (list) list.push({ severity: d.severity });
    else byKey.set(key, [{ severity: d.severity }]);
  }
  return byKey;
}

/** Take one finding of `key` (each stored gap is matched to at most one finding). */
function takeFinding(byKey: Map<string, OpenFinding[]>, key: string): OpenFinding | null {
  const list = byKey.get(key);
  return list && list.length > 0 ? (list.shift() ?? null) : null;
}

function sameValues(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

export const settingsRouter = router({
  /** Current matching-rules settings for the caller's restaurant. */
  get: memberProcedure.query(async ({ ctx }): Promise<RestaurantSettings> => {
    const [row] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    return row?.settings ?? {};
  }),

  /**
   * Owner-only partial update. Read-modify-write inside the member tx (RLS GUC
   * set) — merges nested tolerances / approvalThresholds key-by-key over the
   * existing JSONB and preserves keys the editor does not touch.
   */
  update: ownerProcedure.input(UpdateInput).mutation(async ({ ctx, input }): Promise<RestaurantSettings> => {
    const [row] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1)
      // G-08 (round 4): lock the row — a concurrent writer of other keys
      // (learned charge keys) must not be lost by this read-modify-write.
      .for('no key update');
    const current: RestaurantSettings = row?.settings ?? {};

    const next: RestaurantSettings = { ...current };
    if (input.tolerances !== undefined) {
      next.tolerances = mergeKnobs(current.tolerances, input.tolerances);
    }
    if (input.approvalThresholds !== undefined) {
      next.approvalThresholds = mergeKnobs(current.approvalThresholds, input.approvalThresholds);
    }
    if (input.ocrReviewThreshold === null) {
      delete next.ocrReviewThreshold;
    } else if (input.ocrReviewThreshold !== undefined) {
      next.ocrReviewThreshold = input.ocrReviewThreshold;
    }

    const [updated] = await ctx.db
      .update(restaurants)
      .set({ settings: next, updatedAt: new Date() })
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .returning({ settings: restaurants.settings });
    await recordAudit(ctx.db, {
      restaurantId: ctx.session.restaurantId,
      userId: ctx.session.userId,
      action: SETTINGS_UPDATED,
      entityType: 'restaurant',
      entityId: ctx.session.restaurantId,
      before: {
        tolerances: current.tolerances ?? {},
        approvalThresholds: current.approvalThresholds ?? {},
        ocrReviewThreshold: current.ocrReviewThreshold ?? null,
      },
      after: {
        tolerances: next.tolerances ?? {},
        approvalThresholds: next.approvalThresholds ?? {},
        ocrReviewThreshold: next.ocrReviewThreshold ?? null,
      },
    });
    return updated?.settings ?? next;
  }),

  /**
   * The rules in force, per knob: `{ value, isDefault }`. Read-only, any member
   * (the same tier as `get`). The UI shows a "ברירת מחדל" / "הותאם" chip and one
   * rule sentence per group from this, so a blank input never hides a ₪ rule.
   */
  effective: memberProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    return effectiveSettings(row?.settings ?? {});
  }),

  /**
   * DS3-06 · the preview before saving a threshold (see the block comment above
   * PREVIEW_MAX_INVOICES). Read-only; finance tier, like `history` — it names
   * products and ₪ of open gaps, so receivers and chefs never get it. The input
   * is a patch over the stored overrides with update's semantics (null = back to
   * the engine default).
   */
  previewThresholds: financeProcedure.input(PreviewInput).query(async ({ ctx, input }): Promise<ThresholdPreview> => {
    const rid = ctx.session.restaurantId;
    const [row] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, rid))
      .limit(1);
    const stored: RestaurantSettings = row?.settings ?? {};
    const tolNow = resolveTolerances(stored.tolerances);
    const tolNext = resolveTolerances(
      input.tolerances !== undefined ? mergeKnobs(stored.tolerances, input.tolerances) : stored.tolerances,
    );
    const apprNow = resolveApprovalThresholds(stored.approvalThresholds);
    const apprNext = resolveApprovalThresholds(
      input.approvalThresholds !== undefined
        ? mergeKnobs(stored.approvalThresholds, input.approvalThresholds)
        : stored.approvalThresholds,
    );

    // The open gaps, as the approvals queue lists them (open | escalated, without
    // the zero-₪ short twin of an over-billing). Child tables carry no
    // restaurant_id: the invoice line is scoped through the run's invoice.
    const open = await ctx.db
      .select({
        type: discrepancies.type,
        severity: discrepancies.severity,
        deltaAmount: discrepancies.deltaAmount,
        invoiceLineId: discrepancies.invoiceLineId,
        poLineId: discrepancies.poLineId,
        productId: discrepancies.productId,
        createdAt: discrepancies.createdAt,
        invoiceId: matchRuns.invoiceId,
        poId: matchRuns.poId,
        productName: products.canonicalName,
        lineText: invoiceLines.rawDescription,
      })
      .from(discrepancies)
      .innerJoin(matchRuns, and(eq(matchRuns.id, discrepancies.matchRunId), eq(matchRuns.restaurantId, rid)))
      .leftJoin(products, and(eq(products.id, discrepancies.productId), eq(products.restaurantId, rid)))
      .leftJoin(
        invoiceLines,
        and(eq(invoiceLines.id, discrepancies.invoiceLineId), eq(invoiceLines.invoiceId, matchRuns.invoiceId)),
      )
      .where(
        and(
          eq(discrepancies.restaurantId, rid),
          inArray(discrepancies.resolutionStatus, [...DISCREPANCY_DECIDABLE]),
          notZeroShortTwin(),
        ),
      );

    const base: ThresholdPreview = {
      openNow: open.length,
      changed: !(sameValues(tolNow, tolNext) && sameValues(apprNow, apprNext)),
      considered: 0,
      wouldOpen: 0,
      wouldBlock: 0,
      notOpenedCount: 0,
      notOpenedAgorot: 0,
      notOpened: [],
      evaluatedInvoices: 0,
      skippedInvoices: 0,
    };
    if (!base.changed || open.length === 0) return base;

    // Invoices with open gaps, newest gap first; a gap whose invoice is gone cannot be re-run.
    const byInvoice = new Map<string, { poId: string | null; newest: number; gaps: typeof open }>();
    for (const g of open) {
      if (!g.invoiceId) continue;
      const at = g.createdAt ? new Date(g.createdAt).getTime() : 0;
      const entry = byInvoice.get(g.invoiceId);
      if (entry) {
        entry.gaps.push(g);
        entry.newest = Math.max(entry.newest, at);
      } else {
        byInvoice.set(g.invoiceId, { poId: g.poId, newest: at, gaps: [g] });
      }
    }
    const ordered = [...byInvoice.entries()].sort((a, b) => b[1].newest - a[1].newest);
    const rulesNow = buildRules(apprNow);
    const rulesNext = buildRules(apprNext);
    const notOpened: Array<{ label: string | null; amountAgorot: number }> = [];

    for (const [invoiceId, entry] of ordered.slice(0, PREVIEW_MAX_INVOICES)) {
      const built = await buildMatchInputForInvoice(ctx.db, rid, invoiceId, { pinnedPoId: entry.poId });
      if (!built) continue; // e.g. a consolidated invoice: its gaps come from the cross-match and stay open
      base.evaluatedInvoices += 1;
      const now = openFindingsOf(built.input, runMatch({ ...built.input, tolerances: tolNow }), rulesNow);
      const next = openFindingsOf(built.input, runMatch({ ...built.input, tolerances: tolNext }), rulesNext);
      for (const g of entry.gaps) {
        const key = discrepancyKey({
          type: g.type,
          invoiceLineId: g.invoiceLineId,
          poLineId: g.poLineId,
          productId: g.productId,
        });
        if (!takeFinding(now, key)) continue; // not reproduced today: never attributed to a threshold
        base.considered += 1;
        const kept = takeFinding(next, key);
        if (kept) {
          base.wouldOpen += 1;
          if (kept.severity === 'block') base.wouldBlock += 1;
        } else {
          const amountAgorot = toAgorot(Math.abs(Number(g.deltaAmount ?? 0)));
          base.notOpenedCount += 1;
          base.notOpenedAgorot += amountAgorot;
          notOpened.push({ label: g.productName ?? g.lineText ?? null, amountAgorot });
        }
      }
    }
    base.skippedInvoices = Math.max(0, ordered.length - PREVIEW_MAX_INVOICES);
    base.notOpened = notOpened.sort((a, b) => b.amountAgorot - a.amountAgorot).slice(0, PREVIEW_MAX_NAMED);
    return base;
  }),

  /**
   * Change history of the restaurant's rules and profile (audit rows written by
   * `update` / `updateProfile`), newest first. Finance tier (owner, manager,
   * bookkeeper): the same roles that see the settings sections.
   */
  history: financeProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          at: auditLog.at,
          before: auditLog.before,
          after: auditLog.after,
          userId: auditLog.userId,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.restaurantId, ctx.session.restaurantId),
            inArray(auditLog.action, [...SETTINGS_ACTIONS]),
          ),
        )
        .orderBy(desc(auditLog.at))
        .limit(input?.limit ?? 30);
      // Names live in `users` (off-limits to the app role): read them on the
      // owner connection, only for the ids this tenant's own audit rows name.
      const ids = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
      const names = ids.length
        ? await adminConn(ctx)
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, ids))
        : [];
      const byId = new Map(names.map((u) => [u.id, u.name || u.email]));
      return rows.map((r) => ({
        id: r.id,
        kind: r.action === SETTINGS_UPDATED ? ('rules' as const) : ('profile' as const),
        at: r.at,
        byName: r.userId ? (byId.get(r.userId) ?? null) : null,
        before: r.before as Record<string, unknown> | null,
        after: r.after as Record<string, unknown> | null,
      }));
    }),

  /** Restaurant profile (name / business id / VAT rate / timezone) for the editor. */
  profile: memberProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        name: restaurants.name,
        businessId: restaurants.businessId,
        vatRate: restaurants.vatRate,
        timezone: restaurants.timezone,
      })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    return {
      name: row?.name ?? '',
      businessId: row?.businessId ?? null,
      // vatRate is NUMERIC → Drizzle returns a string; expose it as a fraction number.
      vatRate: vatRateOf(row?.vatRate),
      timezone: row?.timezone ?? 'Asia/Jerusalem',
    };
  }),

  /**
   * Owner-only profile update. VAT rate and timezone are load-bearing for the
   * leak engine and receiving day-boundaries — this is the in-app path to fix
   * them (previously editable only via a manual DB write).
   */
  updateProfile: ownerProcedure.input(ProfileUpdateInput).mutation(async ({ ctx, input }) => {
    const patch: Partial<typeof restaurants.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.businessId !== undefined) patch.businessId = input.businessId || null;
    if (input.vatRate !== undefined) patch.vatRate = String(input.vatRate);
    if (input.timezone !== undefined) patch.timezone = input.timezone;

    const [prev] = await ctx.db
      .select({
        name: restaurants.name,
        businessId: restaurants.businessId,
        vatRate: restaurants.vatRate,
        timezone: restaurants.timezone,
      })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);

    const [updated] = await ctx.db
      .update(restaurants)
      .set(patch)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .returning({
        name: restaurants.name,
        businessId: restaurants.businessId,
        vatRate: restaurants.vatRate,
        timezone: restaurants.timezone,
      });
    // Only the fields the patch touched, before and after.
    const touched = (['name', 'businessId', 'vatRate', 'timezone'] as const).filter((k) => input[k] !== undefined);
    await recordAudit(ctx.db, {
      restaurantId: ctx.session.restaurantId,
      userId: ctx.session.userId,
      action: SETTINGS_PROFILE_UPDATED,
      entityType: 'restaurant',
      entityId: ctx.session.restaurantId,
      before: Object.fromEntries(touched.map((k) => [k, prev?.[k] ?? null])),
      after: Object.fromEntries(touched.map((k) => [k, updated?.[k] ?? null])),
    });
    return {
      name: updated?.name ?? '',
      businessId: updated?.businessId ?? null,
      vatRate: vatRateOf(updated?.vatRate),
      timezone: updated?.timezone ?? 'Asia/Jerusalem',
    };
  }),

  /** The credit-letter letterhead (finance roles: the claims letters render it). */
  letterhead: financeProcedure.query(async ({ ctx }): Promise<Letterhead> => {
    const [row] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    return letterheadOf(row?.settings);
  }),

  /**
   * Owner / manager sets the letterhead. MERGES with jsonb `||` in one UPDATE —
   * settings keeps every other key (features, tolerances…) and the letterhead keeps
   * the fields not sent; an empty string clears that field. Audited.
   */
  updateLetterhead: managerProcedure.input(LetterheadInput).mutation(async ({ ctx, input }): Promise<Letterhead> => {
    const patch: Record<string, string | null> = {};
    for (const k of LETTERHEAD_FIELDS) {
      const v = input[k];
      if (v !== undefined) patch[k] = v === '' ? null : v;
    }
    const [before] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    const res = await ctx.db.execute(sql`
      UPDATE restaurants
      SET settings = COALESCE(settings, '{}'::jsonb)
            || jsonb_build_object('letterhead',
                 jsonb_strip_nulls(COALESCE(settings -> 'letterhead', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)),
          updated_at = now()
      WHERE id = ${ctx.session.restaurantId}
      RETURNING settings
    `);
    const rows = (res as unknown as { rows?: Array<{ settings: unknown }> }).rows ?? (res as unknown as Array<{ settings: unknown }>);
    const after = letterheadOf(rows[0]?.settings);
    await recordAudit(ctx.db, {
      restaurantId: ctx.session.restaurantId,
      userId: ctx.session.userId,
      action: 'settings.letterhead_updated',
      entityType: 'restaurant',
      entityId: ctx.session.restaurantId,
      before: letterheadOf(before?.settings),
      after,
    });
    return after;
  }),

  /**
   * The caller's own app language on the active restaurant (memberships.
   * preferred_locale, 0028). NULL = no preference (device cookie / Hebrew).
   */
  myLocale: memberProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ locale: memberships.preferredLocale })
      .from(memberships)
      .where(
        and(
          eq(memberships.restaurantId, ctx.session.restaurantId),
          eq(memberships.userId, ctx.session.userId),
        ),
      )
      .limit(1);
    const locale = row?.locale;
    // Receiver languages (S14, 0052) pass through; the web gates them by the flag.
    return {
      locale:
        locale === 'he' || locale === 'en' || locale === 'ar' || locale === 'ru' || locale === 'th' || locale === 'ti'
          ? locale
          : null,
    };
  }),

  /** Any member sets their OWN app language (self only — keyed by the session). */
  setMyLocale: memberProcedure
    .input(z.object({ locale: z.enum(['he', 'en']).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(memberships)
        .set({ preferredLocale: input.locale })
        .where(
          and(
            eq(memberships.restaurantId, ctx.session.restaurantId),
            eq(memberships.userId, ctx.session.userId),
          ),
        );
      await recordAudit(ctx.db, {
        restaurantId: ctx.session.restaurantId,
        userId: ctx.session.userId,
        action: 'settings.my_locale_changed',
        entityType: 'user',
        entityId: ctx.session.userId,
        after: { locale: input.locale },
      });
      return { locale: input.locale };
    }),

  /**
   * The caller's own phone (users.phone) and whether it is verified. Verification
   * is not live yet: `users.phone_verified_at` arrives with G-03 (deploy Tue
   * 24.11) and OTP sending needs a WhatsApp/SMS provider (Phase-6), so
   * `verified` is false and `verificationAvailable` is false until then.
   */
  myPhone: memberProcedure.query(async ({ ctx }) => {
    const [row] = await adminConn(ctx)
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, ctx.session.userId))
      .limit(1);
    return { phone: row?.phone ?? null, verified: false, verificationAvailable: false };
  }),

  /**
   * Self only: set (or clear, with null) the caller's phone, normalised to E.164
   * (+972…). `users` is REVOKE'd from the tenant app role, so this writes on the
   * auth/owner connection, scoped `WHERE id = session.userId` and nothing else.
   * The number is stored UNVERIFIED (interim until G-03's phone_verified_at).
   */
  setMyPhone: memberProcedure
    .input(z.object({ phone: z.string().trim().max(32).nullable() }))
    .mutation(async ({ ctx, input }) => {
      let phone: string | null = null;
      if (input.phone) {
        phone = normalizeIlPhone(input.phone);
        if (!phone) throw appError('BAD_REQUEST', 'input.invalid', 'מספר טלפון לא תקין');
      }
      await adminConn(ctx)
        .update(users)
        .set({ phone, updatedAt: new Date() })
        .where(eq(users.id, ctx.session.userId));
      return { phone, verified: false };
    }),
});
