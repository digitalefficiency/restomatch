import { z } from 'zod';
import {
  and,
  auditLog,
  desc,
  discrepancies,
  eq,
  goodsReceipts,
  inArray,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  products,
  restaurants,
  sql,
  users,
  type Database,
  type RestaurantSettings,
} from '@restomatch/db';
import { resolveTolerances, runMatch, toAgorot, type MatchInput, type MatchOutput } from '@restomatch/matching';
import { DEFAULT_REVIEW_THRESHOLD } from '@restomatch/ocr';
import { buildRules, evaluateApproval, resolveApprovalThresholds, type ApprovalContext } from '../approvals/engine';
import { awaitingDecision } from '../approvals/awaiting';
import { orderQuestionCount } from '../catalog/linkQuestions';
import { hasCap } from '../lib/capabilities';
import { DISCREPANCY_DECIDABLE } from '../lifecycle/predicates';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import { pairPriorDecisions, type FindingIdentity, type PriorDecision } from '../match/persist';
import { isClaimableRow } from './approvals';
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
 * stays open until its invoice is checked again. The preview answers a
 * conditional question: had these thresholds been in force, which of today's
 * open gaps would have been opened? It never re-implements a rule:
 *  • only the four finding types a tolerance can change are re-run
 *    (PRICE_HIGHER, PRICE_LOWER, QTY_SHORT, QTY_OVER); every other open gap has
 *    a fixed type and severity in the engine and is counted as it is;
 *  • a re-run rebuilds the engine's input exactly as a re-match does
 *    (buildMatchInputForInvoice, strictly pinned to the run's order) and runs
 *    the matching engine (packages/matching, immutable) with the thresholds in
 *    force and with the proposal; each finding is routed through the approvals
 *    engine as persistMatchRun does (auto-approved = never open);
 *  • stored rows pair with re-run findings per run, by fingerprint first and by
 *    key only when one of each is left (pairPriorDecisions, the persist rule);
 *  • the quantity findings of one order line (QTY_SHORT, QTY_OVER) are one unit:
 *    the engine moves units between them when the unit tolerance changes;
 *  • a gap the re-run with the thresholds in force does not reproduce (data that
 *    moved since), or whose invoice was not re-run (budget, a receipt still being
 *    counted, an open order question, another order chosen), counts as one that
 *    would open, with its stored severity — the answer never claims fewer open
 *    gaps, or fewer blocking ones, than there are.
 * The transaction is READ ONLY (any write fails), bounded by a statement timeout,
 * a run cap and a time budget. Only SELECTs, buildMatchInputForInvoice, runMatch,
 * evaluateApproval and awaitingDecision are used: no lock, hold or persist helper.
 * ────────────────────────────────────────────────────────────────────────── */

/** At most this many runs are re-run per preview (newest first). */
export const PREVIEW_MAX_RUNS = 25;
/** Stop starting re-runs after this long; the rest count as not re-run. */
export const PREVIEW_BUDGET_MS = 2_000;
/** The whole preview's statement timeout (per statement, inside its read-only transaction). */
const PREVIEW_STATEMENT_TIMEOUT_MS = 5_000;
/** At most this many named gaps in "לא היו נפתחים". */
export const PREVIEW_MAX_NAMED = 5;

/** The finding types a tolerance can create, remove or re-grade (engine.ts evaluatePrice / evaluateQty / 5b / evaluateBaseline). */
const TOLERANCE_TYPES: ReadonlySet<string> = new Set(['PRICE_HIGHER', 'PRICE_LOWER', 'QTY_SHORT', 'QTY_OVER']);
const QTY_TYPES: ReadonlySet<string> = new Set(['QTY_SHORT', 'QTY_OVER']);
/** Approval thresholds that can change whether an info finding is queued or approved by itself. */
const ROUTING_KEYS = ['cumulativeLargeAmount', 'cumulativeLargePct', 'cumulativeMediumAmountMin', 'cumulativeMediumPctMin'] as const;

const PreviewInput = z
  .object({
    tolerances: TolerancesSchema.optional(),
    approvalThresholds: ApprovalThresholdsSchema.optional(),
  })
  .strict();

export interface ThresholdPreview {
  /** Open gaps today, as awaitingDecision counts them (the figure every screen shows). */
  openNow: number;
  /** False when the proposal resolves to the thresholds in force (then only `openNow`). */
  changed: boolean;
  /** Of `openNow`: gaps that would still have been opened (including those not re-run). */
  wouldOpen: number;
  /** Of `wouldOpen`: would block payment (severity block). */
  wouldBlock: number;
  /** Of `openNow`: would not have been opened with the proposal. */
  notOpenedCount: number;
  /** Their ₪ that the queue would ask back (claimable rows only), before VAT, in integer agorot. */
  notOpenedAgorot: number;
  /** The largest of them by ₪, at most PREVIEW_MAX_NAMED; label = the product, else the invoice line. */
  notOpened: Array<{ label: string | null; labelEn: string | null; amountAgorot: number }>;
  /** Of `wouldOpen`: tolerance-type gaps that were not re-run or not reproduced (counted as staying). */
  notEvaluated: number;
  /** Runs re-run / runs left out by the cap or the time budget. */
  evaluatedRuns: number;
  skippedRuns: number;
  /** The thresholds this answer is for (resolved), so a client can tell a stale answer. */
  proposal: { tolerances: Record<string, number>; approvalThresholds: Record<string, number> };
}

interface RunFinding {
  type: string;
  severity: string;
  deltaAmount: number;
  expected: number | null;
  actual: number | null;
  invoiceLineId: string | null;
  poLineId: string | null;
  productId: string | null;
  open: boolean;
}

/** One engine run's findings, each marked open or approved by itself — persistMatchRun's routing (match/persist.ts). */
function routedFindings(input: MatchInput, output: MatchOutput, rules: ReturnType<typeof buildRules>): RunFinding[] {
  return output.discrepancies.map((d) => {
    const ctx: ApprovalContext = {
      discrepancy: { type: d.type, severity: d.severity, deltaAmount: d.deltaAmount },
      matchRun: {
        totalDiscrepancyAmount: output.totalDiscrepancyAmount,
        totalInvoiceAmount: input.invoice.totalInclVat,
        poExists: input.poLines.length > 0,
      },
    };
    return {
      type: d.type,
      severity: d.severity,
      deltaAmount: d.deltaAmount,
      // DATE_ANOMALY carries dates in expected/actual; persist stores no number for it.
      expected: d.type === 'DATE_ANOMALY' ? null : (d.expected ?? null),
      actual: d.type === 'DATE_ANOMALY' ? null : (d.actual ?? null),
      invoiceLineId: d.invoiceLineId ?? null,
      poLineId: d.poLineId ?? null,
      productId: d.productId,
      open: evaluateApproval(ctx, rules).action !== 'auto_approve',
    };
  });
}

/**
 * Pair `from` with `to` the way persist carries a decision across a re-match
 * (pairPriorDecisions: fingerprint first, then key when exactly one of each is
 * left). Returns, for each item of `from`, the index of its partner in `to`.
 */
function pairByFingerprint(from: FindingIdentity[], to: FindingIdentity[]): Array<number | undefined> {
  const tags = from.map((_, i) => ({ fromIndex: i }) as unknown as PriorDecision);
  const paired = pairPriorDecisions(
    from.map((f, i) => ({ ...f, decision: tags[i]! })),
    to,
  );
  const out: Array<number | undefined> = from.map(() => undefined);
  paired.forEach((tag, toIndex) => {
    if (tag) out[(tag as unknown as { fromIndex: number }).fromIndex] = toIndex;
  });
  return out;
}

const isZeroShortTwin = (r: { type: string; deltaAmount: string | number | null }) =>
  r.type === 'QTY_SHORT' && Number(r.deltaAmount ?? 0) === 0;

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
   * PREVIEW_MAX_RUNS). Read-only. The count of open gaps is finance tier (it is
   * the figure the rules section shows in force); the what-if — a proposal that
   * differs from the thresholds in force — needs `settings.edit` (the owner: the
   * only role that can save). The input is a patch over the stored overrides
   * with update's semantics (null = back to the engine default).
   */
  previewThresholds: financeProcedure.input(PreviewInput).query(async ({ ctx, input }): Promise<ThresholdPreview> => {
    const startedAt = Date.now();
    // Read-only by construction: any write in this transaction fails (SQLSTATE 25006).
    await ctx.db.execute(sql`set transaction read only`);
    await ctx.db.execute(sql.raw(`set local statement_timeout = ${PREVIEW_STATEMENT_TIMEOUT_MS}`));

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
    const toleranceChanged = !sameValues(tolNow, tolNext);
    const routingChanged = ROUTING_KEYS.some((k) => apprNow[k] !== apprNext[k]);
    const changed = toleranceChanged || !sameValues(apprNow, apprNext);

    const awaiting = await awaitingDecision(ctx.db, { session: { restaurantId: rid, role: ctx.session.role } }, { scope: 'all' });
    const base: ThresholdPreview = {
      openNow: awaiting.count,
      changed,
      wouldOpen: awaiting.count,
      wouldBlock: 0,
      notOpenedCount: 0,
      notOpenedAgorot: 0,
      notOpened: [],
      notEvaluated: 0,
      evaluatedRuns: 0,
      skippedRuns: 0,
      proposal: { tolerances: tolNext, approvalThresholds: apprNext },
    };
    if (!changed) return base;
    if (!hasCap(ctx.session.role, 'settings.edit')) {
      throw appError('FORBIDDEN', 'capability.required', 'Required capability: settings.edit', {
        capability: 'settings.edit',
      });
    }

    // The open rows, the zero-₪ short twins included (they pair, they are not counted).
    // Child tables carry no restaurant_id: the line is scoped through this tenant's invoice.
    const rows = await ctx.db
      .select({
        type: discrepancies.type,
        severity: discrepancies.severity,
        deltaAmount: discrepancies.deltaAmount,
        expected: discrepancies.expectedValue,
        actual: discrepancies.actualValue,
        invoiceLineId: discrepancies.invoiceLineId,
        poLineId: discrepancies.poLineId,
        productId: discrepancies.productId,
        runId: matchRuns.id,
        runAt: matchRuns.runAt,
        poId: matchRuns.poId,
        invoiceId: invoices.id,
        productName: products.canonicalName,
        productNameEn: products.nameEn,
        lineText: invoiceLines.rawDescription,
        lineTextEn: invoiceLines.rawDescriptionEn,
      })
      .from(discrepancies)
      .innerJoin(matchRuns, and(eq(matchRuns.id, discrepancies.matchRunId), eq(matchRuns.restaurantId, rid)))
      .leftJoin(invoices, and(eq(invoices.id, matchRuns.invoiceId), eq(invoices.restaurantId, rid)))
      .leftJoin(invoiceLines, and(eq(invoiceLines.id, discrepancies.invoiceLineId), eq(invoiceLines.invoiceId, invoices.id)))
      .leftJoin(products, and(eq(products.id, discrepancies.productId), eq(products.restaurantId, rid)))
      .where(and(eq(discrepancies.restaurantId, rid), inArray(discrepancies.resolutionStatus, [...DISCREPANCY_DECIDABLE])));
    type Row = (typeof rows)[number];

    // Every counted row starts as "would open" with its stored severity; re-runs below can only lower that.
    const counted = rows.filter((r) => !isZeroShortTwin(r));
    let wouldBlock = counted.filter((r) => r.severity === 'block').length;
    let notEvaluated = 0;
    const notOpened: Array<{ label: string | null; labelEn: string | null; amountAgorot: number }> = [];

    // Which runs a re-run could change: a run with an order, the latest of its invoice, holding an open
    // tolerance-type gap — an info one when only the routing thresholds changed.
    const latestRunOf = new Map<string, { runId: string; at: number }>();
    for (const r of rows) {
      if (!r.invoiceId) continue;
      const at = r.runAt ? new Date(r.runAt).getTime() : 0;
      const cur = latestRunOf.get(r.invoiceId);
      if (!cur || at > cur.at) latestRunOf.set(r.invoiceId, { runId: r.runId, at });
    }
    const runs = new Map<string, { invoiceId: string; poId: string; at: number; rows: Row[] }>();
    for (const r of rows) {
      if (!r.invoiceId || !r.poId || latestRunOf.get(r.invoiceId)?.runId !== r.runId) continue;
      const entry = runs.get(r.runId);
      if (entry) entry.rows.push(r);
      else runs.set(r.runId, { invoiceId: r.invoiceId, poId: r.poId, at: latestRunOf.get(r.invoiceId)!.at, rows: [r] });
    }
    const candidates = [...runs.values()]
      .filter((run) =>
        run.rows.some(
          (r) => !isZeroShortTwin(r) && TOLERANCE_TYPES.has(r.type) && (toleranceChanged || (routingChanged && r.severity === 'info')),
        ),
      )
      .sort((a, b) => b.at - a.at);
    const tolTypeRows = (rs: Row[]) => rs.filter((r) => !isZeroShortTwin(r) && TOLERANCE_TYPES.has(r.type) && (toleranceChanged || (routingChanged && r.severity === 'info'))).length;
    // Tolerance-type rows on runs that cannot be re-run (no order, a superseded run, a gone invoice).
    const rerunnable = new Set(candidates.flatMap((c) => c.rows));
    const canChange = (r: Row) => TOLERANCE_TYPES.has(r.type) && (toleranceChanged || (routingChanged && r.severity === 'info'));
    notEvaluated += counted.filter((r) => canChange(r) && !rerunnable.has(r)).length;

    if (toleranceChanged || routingChanged) {
      const rulesNow = buildRules(apprNow);
      const rulesNext = buildRules(apprNext);
      for (const [i, run] of candidates.entries()) {
        if (i >= PREVIEW_MAX_RUNS || Date.now() - startedAt > PREVIEW_BUDGET_MS) {
          base.skippedRuns += candidates.length - i;
          notEvaluated += candidates.slice(i).reduce((n, c) => n + tolTypeRows(c.rows), 0);
          break;
        }
        const built = await buildMatchInputForInvoice(ctx.db, rid, run.invoiceId, { pinnedPoId: run.poId, strictPin: true });
        // The same guards as the match job: the run's own order, no receipt still being counted, no open order question.
        let skip = !built || built.poId !== run.poId;
        if (!skip && built!.grId) {
          const [gr] = await ctx.db
            .select({ status: goodsReceipts.status })
            .from(goodsReceipts)
            .where(and(eq(goodsReceipts.id, built!.grId), eq(goodsReceipts.restaurantId, rid)))
            .limit(1);
          skip = gr?.status === 'pending';
        }
        if (!skip && (await orderQuestionCount(ctx.db, rid, run.poId)) > 0) skip = true;
        if (skip || !built) {
          notEvaluated += tolTypeRows(run.rows);
          continue;
        }
        base.evaluatedRuns += 1;
        const now = routedFindings(built.input, runMatch({ ...built.input, tolerances: tolNow }), rulesNow);
        const next = routedFindings(built.input, runMatch({ ...built.input, tolerances: tolNext }), rulesNext);
        const storedIds: FindingIdentity[] = run.rows.map((r) => ({
          type: r.type,
          invoiceLineId: r.invoiceLineId,
          poLineId: r.poLineId,
          productId: r.productId,
          deltaAmount: r.deltaAmount,
          expected: r.expected,
          actual: r.actual,
        }));
        const toNow = pairByFingerprint(storedIds, now);
        const nowToNext = pairByFingerprint(now, next);

        // Units: a price finding on its own; the quantity findings of one order line together.
        const units = new Map<string, Row[]>();
        run.rows.forEach((r, idx) => {
          if (!TOLERANCE_TYPES.has(r.type)) return;
          const reproduced = toNow[idx] !== undefined && now[toNow[idx]!]!.open;
          if (!reproduced) {
            if (!isZeroShortTwin(r) && canChange(r)) notEvaluated += 1; // not reproduced today: never attributed to a threshold
            return;
          }
          const key = QTY_TYPES.has(r.type) && r.poLineId ? `qty|${r.poLineId}` : `row|${idx}`;
          const list = units.get(key);
          if (list) list.push(r);
          else units.set(key, [r]);
        });
        for (const [key, unitRows] of units) {
          const countedRows = unitRows.filter((r) => !isZeroShortTwin(r));
          if (countedRows.length === 0) continue;
          let opensNext: boolean;
          let blocksNext: boolean;
          if (key.startsWith('qty|')) {
            const poLineId = key.slice(4);
            const nextQty = next.filter(
              (f) => f.open && QTY_TYPES.has(f.type) && f.poLineId === poLineId && !isZeroShortTwin(f),
            );
            opensNext = nextQty.length > 0;
            blocksNext = nextQty.some((f) => f.severity === 'block');
          } else {
            const idx = run.rows.indexOf(unitRows[0]!);
            const nowIdx = toNow[idx]!;
            const nextIdx = nowToNext[nowIdx];
            const partner = nextIdx === undefined ? null : next[nextIdx]!;
            opensNext = !!partner && partner.open;
            blocksNext = !!partner && partner.severity === 'block';
          }
          const storedBlocks = countedRows.filter((r) => r.severity === 'block').length;
          if (opensNext) {
            // Still open: its blocking follows the proposal (a block may become a warning, or the other way).
            wouldBlock += (blocksNext ? Math.max(1, storedBlocks) : 0) - storedBlocks;
            continue;
          }
          wouldBlock -= storedBlocks;
          for (const r of countedRows) {
            base.notOpenedCount += 1;
            const claimable = isClaimableRow({ type: r.type, severity: r.severity, deltaAmount: r.deltaAmount });
            const amountAgorot = claimable ? toAgorot(Math.abs(Number(r.deltaAmount ?? 0))) : 0;
            base.notOpenedAgorot += amountAgorot;
            notOpened.push({
              label: r.productName ?? r.lineText ?? null,
              labelEn: r.productNameEn ?? r.lineTextEn ?? null,
              amountAgorot,
            });
          }
        }
      }
    }

    base.wouldOpen = Math.max(0, base.openNow - base.notOpenedCount);
    base.wouldBlock = Math.max(0, Math.min(base.wouldOpen, wouldBlock));
    base.notEvaluated = notEvaluated;
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
