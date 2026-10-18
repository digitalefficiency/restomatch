import { TRPCError } from '@trpc/server';
import {
  and,
  creditNotes,
  eq,
  inArray,
  recoveryClaims,
  recoveryEvents,
  sql,
  type Database,
  type RecoveryStatus,
} from '@restomatch/db';
import { assertSupplierOwned } from '../tenant';
import {
  AWAITING_SUPPLIER,
  CREDITABLE,
  OPEN_STATUSES,
  ageingBucket,
  allocateCredit,
  canTransition,
  stampFor,
  type AgeingBucket,
} from './lifecycle';

/**
 * "₪ back" tracker — the money side of a claim, in INTEGER AGOROT.
 *
 * A claim is materialised from every discrepancy the team accepted to claim
 * back (resolution accepted/resolved) that counts as leak under the hero's
 * rules (warn/block, not PRICE_LOWER / UNORDERED_ARRIVAL). Its amount is
 * |delta| parsed from NUMERIC at the boundary (`round(abs(x)*100)::bigint`),
 * capped per invoice at the invoice total like the hero and the claim letter,
 * so "claimed ₪" here never exceeds what the hero calls claimed.
 */

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const int = (v: unknown): number => (v == null ? 0 : Number(v));
const isoOrNull = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

const notFound = (what: string) => new TRPCError({ code: 'NOT_FOUND', message: `${what} not found` });

const CLAIMABLE_FILTER = sql`d.severity IN ('warn','block')
  AND d.type NOT IN ('PRICE_LOWER','UNORDERED_ARRIVAL')
  AND d.resolution_status IN ('accepted','resolved')`;

/** Event note marking a claim the system wrote off because its discrepancy is no longer accepted. */
export const AUTO_WRITE_OFF_NOTE = 'auto: discrepancy no longer accepted';

/**
 * Bring claims in line with the team's current decisions, then create the
 * missing ones (idempotent: one claim per discrepancy). Returns how many were
 * created.
 *  1. A discrepancy that is no longer accepted (rejected / re-opened): its
 *     claim, if no money moved yet (claimed / letter_sent), is written off by
 *     the system — it stops counting as owed.
 *  2. Re-accepted again: a claim the SYSTEM wrote off is re-opened (`claimed`).
 *  3. New claims take what is left of the per-invoice cap; written-off claims
 *     that never received money no longer hold any of it.
 */
export async function syncClaims(db: Database, restaurantId: string, actorId?: string | null): Promise<number> {
  const autoClosed = rowsOf(
    await db.execute(sql`
      WITH gone AS (
        SELECT c.id, c.status AS from_status
        FROM recovery_claims c
        JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
        WHERE c.restaurant_id = ${restaurantId}
          AND c.status IN ('claimed', 'letter_sent')
          AND NOT (${CLAIMABLE_FILTER})
        FOR UPDATE OF c
      )
      UPDATE recovery_claims c
      SET status = 'written_off', closed_at = now()
      FROM gone
      WHERE c.id = gone.id AND c.restaurant_id = ${restaurantId}
      RETURNING c.id, c.amount_agorot, gone.from_status
    `),
  );
  const reopened = rowsOf(
    await db.execute(sql`
      UPDATE recovery_claims c
      SET status = 'claimed', closed_at = NULL
      FROM discrepancies d
      WHERE c.restaurant_id = ${restaurantId}
        AND d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
        AND c.status = 'written_off'
        AND ${CLAIMABLE_FILTER}
        AND (
          SELECT e.note FROM recovery_events e
          WHERE e.claim_id = c.id AND e.restaurant_id = ${restaurantId}
          ORDER BY e.created_at DESC, e.id DESC LIMIT 1
        ) = ${AUTO_WRITE_OFF_NOTE}
      RETURNING c.id, c.amount_agorot
    `),
  );
  for (const [rowsSet, to, note] of [
    [autoClosed, 'written_off', AUTO_WRITE_OFF_NOTE],
    [reopened, 'claimed', 'auto: discrepancy accepted again'],
  ] as const) {
    if (rowsSet.length === 0) continue;
    await db.execute(sql`
      INSERT INTO recovery_events (restaurant_id, claim_id, from_status, to_status, amount_agorot, actor_id, note)
      SELECT ${restaurantId}, x.id, x.from_status, ${to}, x.amount, ${actorId ?? null}, ${note}
      FROM (VALUES ${sql.join(
        rowsSet.map(
          (r) =>
            sql`(${String(r.id)}::uuid, ${String(r.from_status ?? 'written_off')}::varchar, ${Number(r.amount_agorot)}::bigint)`,
        ),
        sql`, `,
      )}) AS x(id, from_status, amount)
    `);
  }

  const res = await db.execute(sql`
    WITH claimed AS (
      -- Agorot already claimed per invoice: new claims only get what is left of
      -- the cap. A written-off claim that never received money holds none of it.
      SELECT invoice_id, SUM(amount_agorot) AS agorot
      FROM recovery_claims
      WHERE restaurant_id = ${restaurantId} AND invoice_id IS NOT NULL
        AND NOT (status = 'written_off' AND credited_agorot = 0)
      GROUP BY invoice_id
    ),
    cand AS (
      SELECT
        d.id AS discrepancy_id,
        i.id AS invoice_id,
        i.supplier_id,
        COALESCE(d.resolved_at, d.created_at) AS claimed_at,
        round(abs(d.delta_amount) * 100)::bigint AS raw_agorot,
        GREATEST(0, round(COALESCE(i.total_incl_vat, 0) * 100)::bigint - COALESCE(cl.agorot, 0)) AS cap_agorot,
        SUM(round(abs(d.delta_amount) * 100)::bigint) OVER (
          PARTITION BY i.id ORDER BY d.created_at, d.id
        ) AS cum_agorot
      FROM discrepancies d
      JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${restaurantId}
      JOIN invoices i ON i.id = mr.invoice_id AND i.restaurant_id = ${restaurantId}
      LEFT JOIN claimed cl ON cl.invoice_id = i.id
      WHERE d.restaurant_id = ${restaurantId}
        AND d.delta_amount IS NOT NULL
        AND ${CLAIMABLE_FILTER}
        AND NOT EXISTS (SELECT 1 FROM recovery_claims rc WHERE rc.discrepancy_id = d.id)
    )
    INSERT INTO recovery_claims (restaurant_id, discrepancy_id, supplier_id, invoice_id, amount_agorot, claimed_at, created_by)
    SELECT ${restaurantId}, c.discrepancy_id, c.supplier_id, c.invoice_id,
           LEAST(c.raw_agorot, GREATEST(0, c.cap_agorot - (c.cum_agorot - c.raw_agorot))),
           c.claimed_at, ${actorId ?? null}
    FROM cand c
    WHERE LEAST(c.raw_agorot, GREATEST(0, c.cap_agorot - (c.cum_agorot - c.raw_agorot))) > 0
    ON CONFLICT (discrepancy_id) DO NOTHING
    RETURNING id
  `);
  const created = rowsOf(res);
  if (created.length > 0) {
    await db.execute(sql`
      INSERT INTO recovery_events (restaurant_id, claim_id, from_status, to_status, amount_agorot, actor_id)
      SELECT restaurant_id, id, NULL, 'claimed', amount_agorot, ${actorId ?? null}
      FROM recovery_claims
      WHERE restaurant_id = ${restaurantId}
        AND id IN (${sql.join(created.map((r) => sql`${String(r.id)}::uuid`), sql`, `)})
    `);
  }
  return created.length;
}

export interface RecoveryClaimRow {
  id: string;
  status: RecoveryStatus;
  amountAgorot: number;
  creditedAgorot: number;
  outstandingAgorot: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  discrepancyType: string;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  claimedAt: string;
  letterSentAt: string | null;
  acknowledgedAt: string | null;
  creditedAt: string | null;
  recoveredAt: string | null;
  closedAt: string | null;
  lastReminderAt: string | null;
  ageDays: number;
  overdue: boolean;
  creditNoteNumber: string | null;
  note: string | null;
}

/** Waiting on the supplier this many days after the letter (or the claim) ⇒ overdue. */
export const OVERDUE_DAYS = 14;
/** Do not chase the same claim more often than this. */
export const REMIND_EVERY_DAYS = 7;
/** Upper bound for one page of the claims LIST (totals never truncate — see computeRecoverySummary). */
export const MAX_CLAIMS = 5000;

export async function listClaims(
  db: Database,
  restaurantId: string,
  /** `limit: null` = every claim (summaries); otherwise one list page, at most MAX_CLAIMS. */
  opts: { status?: RecoveryStatus; supplierId?: string; now?: Date; limit?: number | null } = {},
): Promise<RecoveryClaimRow[]> {
  const now = opts.now ?? new Date();
  const limit = opts.limit === null ? null : Math.min(Math.max(opts.limit ?? 200, 1), MAX_CLAIMS);
  const res = await db.execute(sql`
    SELECT
      c.id, c.status, c.amount_agorot, c.credited_agorot, c.supplier_id, c.invoice_id,
      c.claimed_at, c.letter_sent_at, c.acknowledged_at, c.credited_at, c.recovered_at, c.closed_at,
      c.last_reminder_at, c.note,
      s.name AS supplier_name, s.name_en AS supplier_name_en,
      i.invoice_number,
      d.type AS discrepancy_type,
      p.canonical_name AS product_name, p.name_en AS product_name_en,
      il.raw_description AS line_description, il.raw_description_en AS line_description_en,
      cn.number AS credit_note_number,
      -- Ageing in the restaurant's calendar days (Asia/Jerusalem by default).
      ((${now.toISOString()}::timestamptz AT TIME ZONE tz.tz)::date - (c.claimed_at AT TIME ZONE tz.tz)::date) AS age_days,
      -- Overdue: exactly the reminder job's rule (findOverdue), so the badge and the email agree.
      (COALESCE(c.letter_sent_at, c.claimed_at) < ${now.toISOString()}::timestamptz - make_interval(days => ${OVERDUE_DAYS})) AS waiting_overdue
    FROM recovery_claims c
    CROSS JOIN (SELECT COALESCE(timezone, 'Asia/Jerusalem') AS tz FROM restaurants WHERE id = ${restaurantId}) tz
    JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
    LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.restaurant_id = ${restaurantId}
    LEFT JOIN invoices i ON i.id = c.invoice_id AND i.restaurant_id = ${restaurantId}
    LEFT JOIN products p ON p.id = d.product_id AND p.restaurant_id = ${restaurantId}
    LEFT JOIN invoice_lines il ON il.id = d.invoice_line_id
    LEFT JOIN credit_notes cn ON cn.id = c.credit_note_id AND cn.restaurant_id = ${restaurantId}
    WHERE c.restaurant_id = ${restaurantId}
      ${opts.status ? sql`AND c.status = ${opts.status}` : sql``}
      ${opts.supplierId ? sql`AND c.supplier_id = ${opts.supplierId}` : sql``}
    ORDER BY
      CASE WHEN c.status IN ('recovered','written_off') THEN 1 ELSE 0 END,
      c.claimed_at ASC, c.id
    ${limit === null ? sql`` : sql`LIMIT ${limit}`}
  `);
  return rowsOf(res).map((r) => {
    const status = String(r.status) as RecoveryStatus;
    const amount = int(r.amount_agorot);
    const credited = int(r.credited_agorot);
    const open = (OPEN_STATUSES as readonly string[]).includes(status);
    return {
      id: String(r.id),
      status,
      amountAgorot: amount,
      creditedAgorot: credited,
      outstandingAgorot: open ? Math.max(0, amount - credited) : 0,
      supplierId: (r.supplier_id as string | null) ?? null,
      supplierName: (r.supplier_name as string | null) ?? null,
      supplierNameEn: (r.supplier_name_en as string | null) ?? null,
      invoiceId: (r.invoice_id as string | null) ?? null,
      invoiceNumber: (r.invoice_number as string | null) ?? null,
      discrepancyType: String(r.discrepancy_type),
      productName: (r.product_name as string | null) ?? null,
      productNameEn: (r.product_name_en as string | null) ?? null,
      lineDescription: (r.line_description as string | null) ?? null,
      lineDescriptionEn: (r.line_description_en as string | null) ?? null,
      claimedAt: isoOrNull(r.claimed_at)!,
      letterSentAt: isoOrNull(r.letter_sent_at),
      acknowledgedAt: isoOrNull(r.acknowledged_at),
      creditedAt: isoOrNull(r.credited_at),
      recoveredAt: isoOrNull(r.recovered_at),
      closedAt: isoOrNull(r.closed_at),
      lastReminderAt: isoOrNull(r.last_reminder_at),
      ageDays: int(r.age_days),
      overdue: (AWAITING_SUPPLIER as readonly string[]).includes(status) && r.waiting_overdue === true,
      creditNoteNumber: (r.credit_note_number as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    };
  });
}

export interface RecoverySupplierRow {
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  claimCount: number;
  claimedAgorot: number;
  creditedAgorot: number;
  recoveredAgorot: number;
  outstandingAgorot: number;
  /** credited ÷ claimed (0..1); null when nothing was claimed. */
  recoveryRate: number | null;
}

export interface RecoverySummary {
  claimCount: number;
  claimedAgorot: number;
  /** Backed by a credit note (includes what is already recovered). */
  creditedAgorot: number;
  /** Money actually back (claims in `recovered`). */
  recoveredAgorot: number;
  outstandingAgorot: number;
  writtenOffAgorot: number;
  disputedAgorot: number;
  overdueCount: number;
  overdueAgorot: number;
  ageing: Record<AgeingBucket, number>;
  byStatus: Record<RecoveryStatus, { count: number; agorot: number }>;
  bySupplier: RecoverySupplierRow[];
  /** credited ÷ claimed (0..1); null when nothing was claimed. */
  recoveryRate: number | null;
}

const ALL_STATUSES: RecoveryStatus[] = [
  'claimed',
  'letter_sent',
  'acknowledged',
  'credited',
  'recovered',
  'disputed',
  'written_off',
];

/** Totals, ageing and per-supplier recovery rate — all integer agorot, summed from listClaims. */
export function summarize(claims: RecoveryClaimRow[]): RecoverySummary {
  const ageing: Record<AgeingBucket, number> = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, { count: 0, agorot: 0 }])) as RecoverySummary['byStatus'];
  const suppliers = new Map<string, RecoverySupplierRow>();
  const sum = {
    claimed: 0,
    credited: 0,
    recovered: 0,
    outstanding: 0,
    writtenOff: 0,
    disputed: 0,
    overdueCount: 0,
    overdue: 0,
  };
  for (const c of claims) {
    sum.claimed += c.amountAgorot;
    sum.credited += c.creditedAgorot;
    sum.outstanding += c.outstandingAgorot;
    if (c.status === 'recovered') sum.recovered += c.creditedAgorot;
    // Written off: the whole remainder; recovered short of the claim: the shortfall the team let go.
    if (c.status === 'written_off' || c.status === 'recovered') sum.writtenOff += Math.max(0, c.amountAgorot - c.creditedAgorot);
    if (c.status === 'disputed') sum.disputed += c.outstandingAgorot;
    if (c.overdue) {
      sum.overdueCount += 1;
      sum.overdue += c.outstandingAgorot;
    }
    if (c.outstandingAgorot > 0) ageing[ageingBucket(c.ageDays)] += c.outstandingAgorot;
    byStatus[c.status].count += 1;
    byStatus[c.status].agorot += c.status === 'recovered' || c.status === 'credited' ? c.creditedAgorot : c.outstandingAgorot;

    const key = c.supplierId ?? '—';
    const s = suppliers.get(key) ?? {
      supplierId: c.supplierId,
      supplierName: c.supplierName,
      supplierNameEn: c.supplierNameEn,
      claimCount: 0,
      claimedAgorot: 0,
      creditedAgorot: 0,
      recoveredAgorot: 0,
      outstandingAgorot: 0,
      recoveryRate: null,
    };
    s.claimCount += 1;
    s.claimedAgorot += c.amountAgorot;
    s.creditedAgorot += c.creditedAgorot;
    if (c.status === 'recovered') s.recoveredAgorot += c.creditedAgorot;
    s.outstandingAgorot += c.outstandingAgorot;
    suppliers.set(key, s);
  }
  const bySupplier = [...suppliers.values()]
    .map((s) => ({ ...s, recoveryRate: s.claimedAgorot > 0 ? s.creditedAgorot / s.claimedAgorot : null }))
    .sort((a, b) => b.outstandingAgorot - a.outstandingAgorot || b.claimedAgorot - a.claimedAgorot);
  return {
    claimCount: claims.length,
    claimedAgorot: sum.claimed,
    creditedAgorot: sum.credited,
    recoveredAgorot: sum.recovered,
    outstandingAgorot: sum.outstanding,
    writtenOffAgorot: sum.writtenOff,
    disputedAgorot: sum.disputed,
    overdueCount: sum.overdueCount,
    overdueAgorot: sum.overdue,
    ageing,
    byStatus,
    bySupplier,
    recoveryRate: sum.claimed > 0 ? sum.credited / sum.claimed : null,
  };
}

export async function computeRecoverySummary(
  db: Database,
  restaurantId: string,
  now: Date = new Date(),
): Promise<RecoverySummary> {
  return summarize(await listClaims(db, restaurantId, { now, limit: null }));
}

/**
 * "₪ actually returned" in a local calendar month: credited agorot of claims
 * that reached `recovered` inside [monthStart, monthEnd) of the restaurant tz.
 */
export async function returnedInMonth(
  db: Database,
  restaurantId: string,
  opts: { monthOffset?: number; now?: Date } = {},
): Promise<{ monthStart: string; monthEnd: string; returnedAgorot: number; claimCount: number }> {
  const now = opts.now ?? new Date();
  const offset = opts.monthOffset ?? 0;
  const res = await db.execute(sql`
    WITH r AS (
      SELECT COALESCE(timezone, 'Asia/Jerusalem') AS tz FROM restaurants WHERE id = ${restaurantId}
    ),
    b AS (
      SELECT
        (date_trunc('month', (${now.toISOString()}::timestamptz AT TIME ZONE r.tz)) + make_interval(months => ${offset}::int)) AT TIME ZONE r.tz AS lo,
        (date_trunc('month', (${now.toISOString()}::timestamptz AT TIME ZONE r.tz)) + make_interval(months => ${offset + 1}::int)) AT TIME ZONE r.tz AS hi
      FROM r
    )
    SELECT b.lo, b.hi,
      COALESCE(SUM(c.credited_agorot), 0) AS returned,
      COUNT(c.id) AS cnt
    FROM b
    LEFT JOIN recovery_claims c
      ON c.restaurant_id = ${restaurantId}
     AND c.status = 'recovered'
     AND c.recovered_at >= b.lo AND c.recovered_at < b.hi
    GROUP BY b.lo, b.hi
  `);
  const r = rowsOf(res)[0] ?? {};
  return {
    monthStart: isoOrNull(r.lo) ?? now.toISOString(),
    monthEnd: isoOrNull(r.hi) ?? now.toISOString(),
    returnedAgorot: int(r.returned),
    claimCount: int(r.cnt),
  };
}

/**
 * Load claims of this restaurant, ROW-LOCKED (FOR UPDATE) when `lock` is set:
 * concurrent credit notes / transitions on the same claim serialise inside the
 * member transaction and the second one sees the first one's result.
 */
async function loadOwnedClaims(db: Database, restaurantId: string, ids: string[], lock = false) {
  if (ids.length === 0) return [];
  const q = db
    .select()
    .from(recoveryClaims)
    .where(and(eq(recoveryClaims.restaurantId, restaurantId), inArray(recoveryClaims.id, ids)))
    .orderBy(recoveryClaims.id);
  const rows = lock ? await q.for('update') : await q;
  if (rows.length !== new Set(ids).size) throw notFound('claim');
  return rows;
}

/** Move one claim along the lifecycle (not into `credited` — see recordCreditNote). */
export async function transitionClaim(
  db: Database,
  restaurantId: string,
  input: { claimId: string; to: RecoveryStatus; note?: string | null; actorId?: string | null; at?: Date },
): Promise<{ id: string; status: RecoveryStatus }> {
  const [claim] = await loadOwnedClaims(db, restaurantId, [input.claimId], true);
  if (!claim) throw notFound('claim');
  if (input.to === 'credited') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'a claim becomes credited through a credit note' });
  }
  if (!canTransition(claim.status, input.to)) {
    throw new TRPCError({ code: 'CONFLICT', message: `cannot move a claim from ${claim.status} to ${input.to}` });
  }
  const at = input.at ?? new Date();
  const stamp = stampFor(input.to);
  const patch: Partial<typeof recoveryClaims.$inferInsert> = { status: input.to };
  if (stamp) patch[stamp] = at;
  if (input.to === 'claimed') patch.closedAt = null;
  if (input.note != null) patch.note = input.note;
  await db
    .update(recoveryClaims)
    .set(patch)
    .where(and(eq(recoveryClaims.id, claim.id), eq(recoveryClaims.restaurantId, restaurantId)));
  await db.insert(recoveryEvents).values({
    restaurantId,
    claimId: claim.id,
    fromStatus: claim.status,
    toStatus: input.to,
    actorId: input.actorId ?? null,
    note: input.note ?? null,
    createdAt: at,
  });
  return { id: claim.id, status: input.to };
}

export interface CreditLineSuggestion {
  invoiceLineId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierId: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  description: string;
  descriptionEn: string | null;
  amountAgorot: number;
}

/**
 * Credit (negative) lines on invoices that arrived after the supplier's oldest
 * open claim and are not yet used by a credit note — candidates to close claims.
 */
export async function creditLineSuggestions(
  db: Database,
  restaurantId: string,
  opts: { supplierId?: string } = {},
): Promise<CreditLineSuggestion[]> {
  const res = await db.execute(sql`
    WITH open_claims AS (
      SELECT supplier_id, MIN(claimed_at) AS since
      FROM recovery_claims
      WHERE restaurant_id = ${restaurantId}
        AND status IN ('claimed','letter_sent','acknowledged','disputed')
        AND supplier_id IS NOT NULL
      GROUP BY supplier_id
    )
    SELECT il.id AS line_id, i.id AS invoice_id, i.invoice_number,
           COALESCE(i.invoice_date, i.created_at) AS invoice_date,
           i.supplier_id, s.name AS supplier_name, s.name_en AS supplier_name_en,
           il.raw_description, il.raw_description_en,
           round(abs(il.line_total) * 100)::bigint AS amount_agorot
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id AND i.restaurant_id = ${restaurantId}
    JOIN open_claims oc ON oc.supplier_id = i.supplier_id
    LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${restaurantId}
    WHERE il.line_total < 0
      AND COALESCE(i.invoice_date, i.created_at) >= date_trunc('day', oc.since)
      AND NOT EXISTS (SELECT 1 FROM credit_notes cn WHERE cn.invoice_line_id = il.id)
      ${opts.supplierId ? sql`AND i.supplier_id = ${opts.supplierId}` : sql``}
    ORDER BY invoice_date DESC
    LIMIT 50
  `);
  return rowsOf(res).map((r) => ({
    invoiceLineId: String(r.line_id),
    invoiceId: String(r.invoice_id),
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    invoiceDate: isoOrNull(r.invoice_date),
    supplierId: String(r.supplier_id),
    supplierName: (r.supplier_name as string | null) ?? null,
    supplierNameEn: (r.supplier_name_en as string | null) ?? null,
    description: String(r.raw_description ?? ''),
    descriptionEn: (r.raw_description_en as string | null) ?? null,
    amountAgorot: int(r.amount_agorot),
  }));
}

export interface RecordCreditNoteInput {
  claimIds: string[];
  /** Manual entry … */
  supplierId?: string;
  number?: string | null;
  amountAgorot?: number;
  issuedOn?: string;
  /** … or matched to a later invoice's credit line (amount/number/date derived from it). */
  invoiceLineId?: string;
  note?: string | null;
  /** Client-generated per form submission: a double submit records the note once. */
  idempotencyKey?: string;
  actorId?: string | null;
  at?: Date;
}

/**
 * Record a supplier credit note and apply it to the claims the user SELECTED
 * (oldest first, never to any other claim). Amounts are on the hero's basis:
 * before VAT. A credit-note number is recorded once per supplier (CONFLICT on a
 * repeat); a repeated idempotency key returns the first result (`duplicate`). Every
 * claim must belong to this restaurant and to the note's supplier and still be
 * creditable. Claims that receive credit move to `credited`. Any unallocated
 * remainder stays on the note (visible as `unallocatedAgorot`).
 */
export async function recordCreditNote(
  db: Database,
  restaurantId: string,
  input: RecordCreditNoteInput,
): Promise<{
  creditNoteId: string;
  allocatedAgorot: number;
  unallocatedAgorot: number;
  creditedClaimIds: string[];
  duplicate?: boolean;
}> {
  if (input.idempotencyKey) {
    const [seen] = await db
      .select({ id: creditNotes.id })
      .from(creditNotes)
      .where(and(eq(creditNotes.restaurantId, restaurantId), eq(creditNotes.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (seen) return { creditNoteId: seen.id, allocatedAgorot: 0, unallocatedAgorot: 0, creditedClaimIds: [], duplicate: true };
  }
  let supplierId = input.supplierId;
  let amountAgorot = input.amountAgorot;
  let number = input.number ?? null;
  let issuedOn = input.issuedOn;
  let invoiceId: string | null = null;

  if (input.invoiceLineId) {
    const res = await db.execute(sql`
      SELECT i.id AS invoice_id, i.supplier_id, i.invoice_number,
             to_char(COALESCE(i.invoice_date, i.created_at), 'YYYY-MM-DD') AS issued_on,
             il.line_total, round(abs(il.line_total) * 100)::bigint AS amount_agorot
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id AND i.restaurant_id = ${restaurantId}
      WHERE il.id = ${input.invoiceLineId}
    `);
    const line = rowsOf(res)[0];
    if (!line) throw notFound('invoice line');
    if (Number(line.line_total) >= 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'not a credit line' });
    }
    if (supplierId && supplierId !== line.supplier_id) throw notFound('invoice line');
    supplierId = String(line.supplier_id);
    amountAgorot = int(line.amount_agorot);
    number = number ?? ((line.invoice_number as string | null) ?? null);
    issuedOn = issuedOn ?? String(line.issued_on);
    invoiceId = String(line.invoice_id);
  }

  if (!supplierId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'supplier is required' });
  await assertSupplierOwned(db, supplierId, restaurantId);
  if (!amountAgorot || !Number.isSafeInteger(amountAgorot) || amountAgorot <= 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'amount must be a positive number of agorot' });
  }
  if (!issuedOn) throw new TRPCError({ code: 'BAD_REQUEST', message: 'issue date is required' });

  if (input.invoiceLineId) {
    const [used] = await db
      .select({ id: creditNotes.id })
      .from(creditNotes)
      .where(and(eq(creditNotes.invoiceLineId, input.invoiceLineId), eq(creditNotes.restaurantId, restaurantId)))
      .limit(1);
    if (used) throw new TRPCError({ code: 'CONFLICT', message: 'this credit line is already recorded' });
  }

  const claims = (await loadOwnedClaims(db, restaurantId, [...new Set(input.claimIds)], true)).sort(
    (a, b) => a.claimedAt.getTime() - b.claimedAt.getTime() || a.id.localeCompare(b.id),
  );
  for (const c of claims) {
    if (c.supplierId !== supplierId) throw notFound('claim');
    if (!(CREDITABLE as readonly string[]).includes(c.status) || c.creditedAgorot >= c.amountAgorot) {
      throw new TRPCError({ code: 'CONFLICT', message: `claim is ${c.status}` });
    }
  }

  if (number) {
    const [dup] = await db
      .select({ id: creditNotes.id })
      .from(creditNotes)
      .where(
        and(eq(creditNotes.restaurantId, restaurantId), eq(creditNotes.supplierId, supplierId), eq(creditNotes.number, number)),
      )
      .limit(1);
    if (dup) throw new TRPCError({ code: 'CONFLICT', message: `credit note ${number} is already recorded for this supplier` });
  }

  const at = input.at ?? new Date();
  let note: { id: string } | undefined;
  try {
    [note] = await db
      .insert(creditNotes)
      .values({
        restaurantId,
        supplierId,
        number,
        amountAgorot,
        issuedOn,
        source: input.invoiceLineId ? 'invoice_line' : 'manual',
        invoiceLineId: input.invoiceLineId ?? null,
        invoiceId,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: input.actorId ?? null,
        createdAt: at,
      })
      .returning({ id: creditNotes.id });
  } catch (err) {
    // A concurrent duplicate (same number / line / idempotency key) lost the race.
    if ((err as { code?: string }).code === '23505') {
      throw new TRPCError({ code: 'CONFLICT', message: 'this credit note is already recorded' });
    }
    throw err;
  }
  if (!note) throw new Error('credit note insert failed');

  const { allocations, remainder } = allocateCredit(amountAgorot, claims);
  const byId = new Map(claims.map((c) => [c.id, c]));
  for (const a of allocations) {
    const c = byId.get(a.id)!;
    await db
      .update(recoveryClaims)
      .set({
        status: 'credited',
        creditedAgorot: c.creditedAgorot + a.agorot,
        creditNoteId: note.id,
        creditedAt: at,
      })
      .where(and(eq(recoveryClaims.id, c.id), eq(recoveryClaims.restaurantId, restaurantId)));
    await db.insert(recoveryEvents).values({
      restaurantId,
      claimId: c.id,
      fromStatus: c.status,
      toStatus: 'credited',
      amountAgorot: a.agorot,
      actorId: input.actorId ?? null,
      note: number ? `credit note ${number}` : null,
      createdAt: at,
    });
  }
  return {
    creditNoteId: note.id,
    allocatedAgorot: amountAgorot - remainder,
    unallocatedAgorot: remainder,
    creditedClaimIds: allocations.map((a) => a.id),
  };
}

/**
 * Lock every claim a bulk call touches up front, in id order, so two bulk
 * calls naming the same claims in a different order cannot deadlock (40P01).
 * Returns the sorted, de-duplicated ids.
 */
export async function lockClaims(db: Database, restaurantId: string, claimIds: string[]): Promise<string[]> {
  const ids = [...new Set(claimIds)].sort();
  await loadOwnedClaims(db, restaurantId, ids, true);
  return ids;
}

/**
 * Before a re-match deletes an invoice's match runs (and so its discrepancies):
 * claims on them that are still bare `claimed` (or system-written-off) carry no
 * money history — remove them; the re-accepted discrepancies of the new run
 * are claimed again by syncClaims. Any claim further along (letter sent, credit,
 * money back, dispute, a manual write-off) is money history: refuse the
 * re-match (CONFLICT) instead of losing it. The DB backs this up — the claim →
 * discrepancy FK is ON DELETE NO ACTION.
 */
export async function releaseClaimsForRematch(db: Database, restaurantId: string, invoiceId: string): Promise<number> {
  const claims = rowsOf(
    await db.execute(sql`
      SELECT c.id, c.status, c.credited_agorot,
        (SELECT e.note FROM recovery_events e WHERE e.claim_id = c.id AND e.restaurant_id = ${restaurantId}
         ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS last_note
      FROM recovery_claims c
      JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
      JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${restaurantId}
      WHERE c.restaurant_id = ${restaurantId} AND mr.invoice_id = ${invoiceId}
      FOR UPDATE OF c
    `),
  );
  const releasable = (r: Row) =>
    int(r.credited_agorot) === 0 &&
    (r.status === 'claimed' || (r.status === 'written_off' && r.last_note === AUTO_WRITE_OFF_NOTE));
  const blocked = claims.filter((r) => !releasable(r));
  if (blocked.length > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `this invoice has ${blocked.length} credit claim(s) in progress (₪-back tracker) — finish or write them off before re-matching`,
    });
  }
  if (claims.length === 0) return 0;
  await db
    .delete(recoveryClaims)
    .where(and(eq(recoveryClaims.restaurantId, restaurantId), inArray(recoveryClaims.id, claims.map((r) => String(r.id)))));
  return claims.length;
}

/** Lifecycle history of one claim (oldest first). */
export async function claimHistory(db: Database, restaurantId: string, claimId: string) {
  await loadOwnedClaims(db, restaurantId, [claimId]);
  return db
    .select({
      id: recoveryEvents.id,
      fromStatus: recoveryEvents.fromStatus,
      toStatus: recoveryEvents.toStatus,
      amountAgorot: recoveryEvents.amountAgorot,
      note: recoveryEvents.note,
      createdAt: recoveryEvents.createdAt,
    })
    .from(recoveryEvents)
    .where(and(eq(recoveryEvents.claimId, claimId), eq(recoveryEvents.restaurantId, restaurantId)))
    .orderBy(recoveryEvents.createdAt);
}
