import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@restomatch/db';
import { LEAK_FILTER } from './leak-views';

/**
 * AU-07 · automation telemetry, per restaurant per Israel week (Sunday 00:00 in
 * the restaurant's time zone → next Sunday 00:00).
 *
 * Read-only SQL. Every subquery filters `restaurant_id` itself: the admin
 * procedure that calls this runs WITHOUT the tenant RLS scope.
 *
 * Money rules:
 *  - The ₪ funnel is integer agorot. Shekel NUMERIC columns are converted per
 *    row with round(x*100)::bigint and then summed. Floats are never summed.
 *  - "found" is the hero's leak definition exactly: per invoice
 *    LEAST(Σ|delta| under LEAK_FILTER, invoice total), dated by
 *    COALESCE(invoice_date, created_at). See computeFoundAgorot and the parity test.
 *  - The time ledger (hours-₪) is a separate result key and is never added to any
 *    funnel figure.
 *  - Unknown is never ₪0. A metric with no basis is null ("לא נמדד").
 */

/** Discrepancy types never asked back from a supplier. Mirrors api `NEVER_CLAIMABLE_TYPES` (pinned by an api test; charts may not import api). */
export const AUTOMATION_NEVER_CLAIMABLE = ['PRICE_LOWER', 'UNORDERED_ARRIVAL', 'MISSING_ON_INVOICE'] as const;

/**
 * audit_log actions that mean a human corrected an invoice (header/line edit,
 * product mapping). Empty today: no producer writes one yet (G-05 / W2-05).
 * While empty, zero-touch is a labelled proxy ('proxy' basis). Filling it is
 * the only change needed to switch to the 'events' basis.
 */
export const TOUCH_ACTIONS: readonly string[] = [];

export const AUTOMATION_ROLES = ['receiver', 'bookkeeper', 'manager', 'chef', 'owner'] as const;
export type AutomationRole = (typeof AUTOMATION_ROLES)[number];

/**
 * Loaded hourly rates in ₪ (ASSUMPTIONS, ext-05 §4.3; the floor = the manager
 * rate; the owner hour defaults to the manager rate and may be raised per request).
 */
export const AUTOMATION_RATE_DEFAULTS: Readonly<Record<AutomationRole, number>> = {
  receiver: 63,
  bookkeeper: 89,
  manager: 103,
  chef: 127,
  owner: 103,
};

/** The external bookkeeper's monthly fee (ASSUMPTION inside the ₪300–1,200 band, ext-05 §4.1). */
export const BOOKKEEPER_FEE_DEFAULT_ILS = 600;

/**
 * Minutes saved per document (ASSUMPTIONS, research catalogue §0: "3–5 min per
 * document"). The receiver saves typing/photo checks on every arriving document,
 * and the bookkeeper saves the check on every untouched (zero-touch) invoice.
 */
export const AUTOMATION_MINUTES = {
  receiverPerDoc: { low: 0.5, high: 1 },
  bookkeeperPerZeroTouch: { low: 3, high: 5 },
} as const;

export const AUTOMATION_MAX_WEEKS = 12;
const ACTED_WINDOW_HOURS = 48;
const OPEN_DECISION_HOURS = 24;

export interface AutomationAlertRow {
  /** payload.event, else the dedupe_key prefix, else the related entity type. */
  event: string;
  queued: number;
  /** Sent through a real provider (not a mock id). */
  sent: number;
  /** Marked sent by a mock notifier: nothing actually left the building. */
  sentMock: number;
  failedNoProvider: number;
  failed: number;
  cancelled: number;
  /** No open tracking exists, so this is always null ("לא נמדד"), never 0. */
  opened: null;
  /** Sent rows whose invoice (or claim) got a human decision or transition within 48 h of sent_at. */
  actedWithin48h: number;
}

export interface AutomationFunnelAgorot {
  found: number;
  decided: number;
  claimed: number;
  sent: number;
  credited: number;
  recovered: number;
}

export interface AutomationCohortAgorot {
  claimed: number;
  sent: number;
  credited: number;
  recovered: number;
}

export interface AutomationWeek {
  /** UTC ISO instants of the local Sunday 00:00 bounds: [weekStart, weekEnd). */
  weekStart: string;
  weekEnd: string;
  /** False for a week that ended before the restaurant's first data ("אין עדיין נתונים"). */
  hasData: boolean;
  docsIn: number;
  docsBySource: Record<string, number>;
  inboxDocs: number;
  duplicateCopies: number;
  /** 0..100 with one decimal; null when nothing was first-matched this week. */
  zeroTouchPct: number | null;
  zeroTouchBasis: 'proxy' | 'events';
  zeroTouchDenominator: number;
  zeroTouchTouched: number;
  /** First-matched this week but out of the denominator (T4 / duplicates), counted apart. */
  zeroTouchExcluded: { consolidated: number; pendingLink: number; duplicate: number };
  arrivalToMatchedHoursP50: number | null;
  arrivalToMatchedHoursP90: number | null;
  exceptionPct: number | null;
  decisionAgeHoursP50: number | null;
  decisionsResolved: number;
  alerts: AutomationAlertRow[];
  /** Flow view: each stage dated by its own stamp. */
  funnelAgorot: AutomationFunnelAgorot;
  /** The claims made this week, followed to today. */
  cohortAgorot: AutomationCohortAgorot;
  /** Count per automationId (A1..A26) from audit_log.after and activity_events.metadata. */
  automationRuns: Record<string, number>;
}

export interface TimeLedgerAssumption {
  key: string;
  value: number;
  unit: 'ils_per_hour' | 'minutes' | 'ils_per_month' | 'count';
}

export interface AutomationTimeLedger {
  lowIls: number;
  highIls: number;
  /** The bookkeeper part was cut at her (prorated) fee: saved money only if the fee goes down. */
  bookkeeperCapped: boolean;
  byRole: Array<{ role: AutomationRole; lowIls: number; highIls: number }>;
  assumptions: TimeLedgerAssumption[];
}

export interface AutomationKpis {
  restaurantId: string;
  timezone: string;
  /** Oldest first; the last row is the current (partial) week. */
  weeks: AutomationWeek[];
  /** The first event we can measure from (earliest invoice / activity row), or null. */
  dataSince: string | null;
  /** Open warn/block findings older than 24 h, right now. */
  openDecisionsOver24h: number;
  touchActions: string[];
  /** Hours-₪: an estimate, separate from the ₪ funnel, never summed with it. */
  timeLedger: AutomationTimeLedger;
}

export interface AutomationKpisOptions {
  weeks?: number;
  now?: Date;
  rates?: Partial<Record<AutomationRole, number>>;
  bookkeeperFeeIls?: number;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Math.round(Number(v) * 10) / 10);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const AUTOMATION_ID_RE = '^A[0-9]{1,2}$';

const textList = (vals: readonly string[]) => sql.join(vals.map((v) => sql`${v}`), sql`, `);
const neverClaimable = sql`(${textList(AUTOMATION_NEVER_CLAIMABLE)})`;
/** A held duplicate copy: OCR set raw.duplicateOf. */
const isDuplicateCopy = (alias: string) =>
  sql`COALESCE(jsonb_typeof(${sql.raw(alias)}.ocr_payload -> 'raw' -> 'duplicateOf'), 'null') <> 'null'`;
const isConsolidated = (alias: string) =>
  sql`COALESCE(${sql.raw(alias)}.ocr_payload -> 'raw' ->> 'kind' = 'consolidated', false)`;
const touchActionMatch = (alias: string): SQL =>
  TOUCH_ACTIONS.length > 0 ? sql`${sql.raw(alias)}.action IN (${textList(TOUCH_ACTIONS)})` : sql`false`;

/** Week bounds in the restaurant's zone: idx 0 = the current week. */
function weeksCte(restaurantId: string, now: Date, weeks: number): SQL {
  return sql`
    r AS (
      SELECT COALESCE(timezone, 'Asia/Jerusalem') AS tz FROM restaurants WHERE id = ${restaurantId}
    ),
    s AS (
      SELECT r.tz,
             date_trunc('week', (${now.toISOString()}::timestamptz AT TIME ZONE r.tz) + interval '1 day') - interval '1 day' AS cur_local
      FROM r
    ),
    w AS (
      SELECT k AS idx,
             (s.cur_local - make_interval(weeks => k)) AT TIME ZONE s.tz AS lo,
             (s.cur_local - make_interval(weeks => k - 1)) AT TIME ZONE s.tz AS hi
      FROM s, generate_series(0, ${weeks - 1}::int) AS k
    )`;
}

/** Per-invoice capped leak (agorot) for invoices dated in [lo, hi): the hero's definition. */
function foundPerInvoiceSql(restaurantId: string, window: SQL): SQL {
  return sql`
    SELECT i.id, COALESCE(i.invoice_date, i.created_at) AS dated,
           round(LEAST(
             COALESCE(SUM(ABS(d.delta_amount)) FILTER (WHERE ${LEAK_FILTER}), 0),
             COALESCE(i.total_incl_vat, 0)
           ) * 100)::bigint AS leak_agorot
    FROM invoices i
    LEFT JOIN match_runs mr ON mr.invoice_id = i.id AND mr.restaurant_id = ${restaurantId}
    LEFT JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
    WHERE i.restaurant_id = ${restaurantId} AND ${window}
    GROUP BY i.id, i.invoice_date, i.created_at, i.total_incl_vat`;
}

/**
 * "found" in agorot for invoices dated in [from, to): exactly the hero's leak
 * (`computeLeakHero().leakIls * 100` over the same window). Exported for the parity test.
 */
export async function computeFoundAgorot(
  db: Database,
  restaurantId: string,
  window: { from: Date; to: Date },
): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(leak_agorot), 0) AS found FROM (
      ${foundPerInvoiceSql(
        restaurantId,
        sql`COALESCE(i.invoice_date, i.created_at) >= ${window.from.toISOString()}::timestamptz
            AND COALESCE(i.invoice_date, i.created_at) < ${window.to.toISOString()}::timestamptz`,
      )}
    ) f`);
  return num(rowsOf(res)[0]?.found);
}

function emptyWeek(lo: unknown, hi: unknown): AutomationWeek {
  return {
    weekStart: iso(lo),
    weekEnd: iso(hi),
    hasData: false,
    docsIn: 0,
    docsBySource: {},
    inboxDocs: 0,
    duplicateCopies: 0,
    zeroTouchPct: null,
    zeroTouchBasis: TOUCH_ACTIONS.length > 0 ? 'events' : 'proxy',
    zeroTouchDenominator: 0,
    zeroTouchTouched: 0,
    zeroTouchExcluded: { consolidated: 0, pendingLink: 0, duplicate: 0 },
    arrivalToMatchedHoursP50: null,
    arrivalToMatchedHoursP90: null,
    exceptionPct: null,
    decisionAgeHoursP50: null,
    decisionsResolved: 0,
    alerts: [],
    funnelAgorot: { found: 0, decided: 0, claimed: 0, sent: 0, credited: 0, recovered: 0 },
    cohortAgorot: { claimed: 0, sent: 0, credited: 0, recovered: 0 },
    automationRuns: {},
  };
}

export function clampWeeks(weeks: number | undefined): number {
  const w = Math.trunc(weeks ?? 8);
  if (!Number.isFinite(w)) return 8;
  return Math.min(AUTOMATION_MAX_WEEKS, Math.max(1, w));
}

export async function automationKpis(
  db: Database,
  restaurantId: string,
  options: AutomationKpisOptions = {},
): Promise<AutomationKpis> {
  const now = options.now ?? new Date();
  const weeks = clampWeeks(options.weeks);
  const W = weeksCte(restaurantId, now, weeks);
  const rid = restaurantId;

  const [weekRows, docRows, inboxRows, matchRows, decisionRows, openRows, alertRows, foundRows, decidedRows, claimRows, cohortRows, runRows, sinceRows] =
    await Promise.all([
      db.execute(sql`WITH ${W} SELECT idx, lo, hi, (SELECT tz FROM r) AS tz FROM w ORDER BY idx DESC`),
      // Documents in, by source; held duplicate copies.
      db.execute(sql`WITH ${W}
        SELECT w.idx, i.source::text AS source, COUNT(*) AS n,
               COUNT(*) FILTER (WHERE ${isDuplicateCopy('i')}) AS dup
        FROM w JOIN invoices i ON i.restaurant_id = ${rid} AND i.created_at >= w.lo AND i.created_at < w.hi
        GROUP BY w.idx, i.source`),
      db.execute(sql`WITH ${W}
        SELECT w.idx, COUNT(*) AS n
        FROM w JOIN ingest_documents g ON g.restaurant_id = ${rid} AND g.created_at >= w.lo AND g.created_at < w.hi
        GROUP BY w.idx`),
      // Zero-touch, arrival → first match, exceptions. "Matched" = the first
      // invoice_matched feed row (it survives the re-match delete of match_runs).
      db.execute(sql`WITH ${W},
        fm AS (
          SELECT (ae.metadata ->> 'invoiceId')::uuid AS invoice_id, MIN(ae.created_at) AS first_at, COUNT(*) AS runs
          FROM activity_events ae
          WHERE ae.restaurant_id = ${rid} AND ae.event_type = 'invoice_matched'
            AND ae.metadata ->> 'invoiceId' ~ ${UUID_RE}
          GROUP BY 1
        ),
        lr AS (
          SELECT DISTINCT ON (mr.invoice_id) mr.id, mr.invoice_id
          FROM match_runs mr
          WHERE mr.restaurant_id = ${rid} AND mr.invoice_id IS NOT NULL
          ORDER BY mr.invoice_id, mr.run_at DESC, mr.id DESC
        ),
        per AS (
          SELECT w.idx,
                 EXTRACT(EPOCH FROM (fm.first_at - i.created_at)) / 3600.0 AS hours,
                 ${isConsolidated('i')} AS consolidated,
                 ${isDuplicateCopy('i')} AS duplicate,
                 EXISTS (SELECT 1 FROM discrepancies d WHERE d.match_run_id = lr.id AND d.restaurant_id = ${rid}
                         AND d.type = 'UNORDERED_ARRIVAL' AND d.resolution_status IN ('open','escalated')) AS pending_link,
                 (fm.runs > 1
                   OR EXISTS (SELECT 1 FROM audit_log a WHERE a.restaurant_id = ${rid} AND a.entity_type = 'invoice'
                              AND a.entity_id = i.id AND ${touchActionMatch('a')})
                   OR EXISTS (SELECT 1 FROM discrepancies d WHERE d.match_run_id = lr.id AND d.restaurant_id = ${rid}
                              AND d.resolved_by IS NOT NULL)) AS touched,
                 EXISTS (SELECT 1 FROM discrepancies d WHERE d.match_run_id = lr.id AND d.restaurant_id = ${rid}
                         AND d.severity IN ('warn','block') AND d.type <> 'UNORDERED_ARRIVAL') AS exception
          FROM w
          JOIN fm ON fm.first_at >= w.lo AND fm.first_at < w.hi
          JOIN invoices i ON i.id = fm.invoice_id AND i.restaurant_id = ${rid}
          LEFT JOIN lr ON lr.invoice_id = i.id
        )
        SELECT idx,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS p50,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY hours) AS p90,
               COUNT(*) FILTER (WHERE consolidated) AS ex_consolidated,
               COUNT(*) FILTER (WHERE NOT consolidated AND duplicate) AS ex_duplicate,
               COUNT(*) FILTER (WHERE NOT consolidated AND NOT duplicate AND pending_link) AS ex_pending,
               COUNT(*) FILTER (WHERE NOT consolidated AND NOT duplicate AND NOT pending_link) AS denom,
               COUNT(*) FILTER (WHERE NOT consolidated AND NOT duplicate AND NOT pending_link AND touched) AS touched,
               COUNT(*) FILTER (WHERE NOT consolidated AND NOT duplicate AND NOT pending_link AND exception) AS exceptions
        FROM per GROUP BY idx`),
      db.execute(sql`WITH ${W}
        SELECT w.idx,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (d.resolved_at - d.created_at)) / 3600.0) AS p50,
               COUNT(*) AS n
        FROM w JOIN discrepancies d ON d.restaurant_id = ${rid} AND d.resolved_at >= w.lo AND d.resolved_at < w.hi
          AND d.resolution_status IN ('accepted','rejected','resolved')
        GROUP BY w.idx`),
      db.execute(sql`
        SELECT COUNT(*) AS n FROM discrepancies d
        WHERE d.restaurant_id = ${rid} AND d.resolution_status IN ('open','escalated')
          AND d.severity IN ('warn','block')
          AND d.created_at < ${now.toISOString()}::timestamptz - make_interval(hours => ${OPEN_DECISION_HOURS}::int)`),
      // Alerts by event key, joined to the INVOICE (never the run id, which a re-match deletes).
      db.execute(sql`WITH ${W},
        o AS (
          SELECT w.idx, n.status::text AS status, n.last_error, n.sent_at,
                 COALESCE(NULLIF(n.payload ->> 'event', ''), NULLIF(split_part(n.dedupe_key, ':', 1), ''), n.related_entity_type, 'other') AS event,
                 COALESCE(n.payload ->> 'externalId', '') LIKE '%-mock-%' AS mock,
                 COALESCE(
                   CASE WHEN n.related_entity_type = 'invoice' THEN n.related_entity_id END,
                   CASE WHEN n.related_entity_type = 'match_run' THEN (
                     SELECT (ae.metadata ->> 'invoiceId')::uuid FROM activity_events ae
                     WHERE ae.restaurant_id = ${rid} AND ae.event_type = 'invoice_matched'
                       AND ae.entity_id = n.related_entity_id AND ae.metadata ->> 'invoiceId' ~ ${UUID_RE}
                     LIMIT 1) END,
                   CASE WHEN n.related_entity_type = 'match_run' THEN (
                     SELECT mr.invoice_id FROM match_runs mr WHERE mr.id = n.related_entity_id AND mr.restaurant_id = ${rid}) END,
                   CASE WHEN n.payload ->> 'invoiceId' ~ ${UUID_RE} THEN (n.payload ->> 'invoiceId')::uuid END
                 ) AS invoice_id,
                 CASE WHEN n.related_entity_type IN ('recovery_claim','claim') THEN n.related_entity_id END AS claim_id
          FROM w JOIN notifications_outbox n ON n.restaurant_id = ${rid} AND n.created_at >= w.lo AND n.created_at < w.hi
        ),
        oa AS (
          SELECT o.*,
            (o.sent_at IS NOT NULL AND (
              EXISTS (SELECT 1 FROM discrepancies d JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${rid}
                      WHERE d.restaurant_id = ${rid} AND mr.invoice_id = o.invoice_id AND d.resolved_by IS NOT NULL
                        AND d.resolved_at >= o.sent_at AND d.resolved_at <= o.sent_at + make_interval(hours => ${ACTED_WINDOW_HOURS}::int))
              OR EXISTS (SELECT 1 FROM audit_log a WHERE a.restaurant_id = ${rid} AND a.user_id IS NOT NULL
                      AND a.entity_id IN (o.invoice_id, o.claim_id)
                      AND a.at >= o.sent_at AND a.at <= o.sent_at + make_interval(hours => ${ACTED_WINDOW_HOURS}::int))
              OR EXISTS (SELECT 1 FROM recovery_events re JOIN recovery_claims rc ON rc.id = re.claim_id AND rc.restaurant_id = ${rid}
                      WHERE re.restaurant_id = ${rid} AND re.actor_id IS NOT NULL
                        AND (rc.invoice_id = o.invoice_id OR re.claim_id = o.claim_id)
                        AND re.created_at >= o.sent_at AND re.created_at <= o.sent_at + make_interval(hours => ${ACTED_WINDOW_HOURS}::int))
            )) AS acted
          FROM o
        )
        SELECT idx, event,
               COUNT(*) FILTER (WHERE status IN ('queued','sending')) AS queued,
               COUNT(*) FILTER (WHERE status = 'sent' AND NOT mock) AS sent,
               COUNT(*) FILTER (WHERE status = 'sent' AND mock) AS sent_mock,
               COUNT(*) FILTER (WHERE status = 'failed' AND last_error = 'skipped_no_provider') AS failed_no_provider,
               COUNT(*) FILTER (WHERE status = 'failed' AND last_error IS DISTINCT FROM 'skipped_no_provider') AS failed,
               COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               COUNT(*) FILTER (WHERE acted) AS acted
        FROM oa GROUP BY idx, event ORDER BY idx, event`),
      db.execute(sql`WITH ${W},
        f AS (${foundPerInvoiceSql(rid, sql`true`)})
        SELECT w.idx, COALESCE(SUM(f.leak_agorot), 0) AS found
        FROM w JOIN f ON f.dated >= w.lo AND f.dated < w.hi
        GROUP BY w.idx`),
      db.execute(sql`WITH ${W}
        SELECT w.idx, COALESCE(SUM(round(ABS(d.delta_amount) * 100)::bigint), 0) AS decided
        FROM w JOIN discrepancies d ON d.restaurant_id = ${rid} AND d.resolved_at >= w.lo AND d.resolved_at < w.hi
        WHERE d.resolution_status = 'accepted' AND ${LEAK_FILTER} AND d.type NOT IN ${neverClaimable}
        GROUP BY w.idx`),
      db.execute(sql`WITH ${W}
        SELECT w.idx,
          COALESCE(SUM(c.amount_agorot) FILTER (WHERE c.claimed_at >= w.lo AND c.claimed_at < w.hi), 0) AS claimed,
          COALESCE(SUM(c.amount_agorot) FILTER (WHERE c.letter_sent_at >= w.lo AND c.letter_sent_at < w.hi), 0) AS sent,
          COALESCE(SUM(c.credited_agorot) FILTER (WHERE c.credited_at >= w.lo AND c.credited_at < w.hi), 0) AS credited,
          COALESCE(SUM(c.credited_agorot) FILTER (WHERE c.recovered_at >= w.lo AND c.recovered_at < w.hi), 0) AS recovered
        FROM w JOIN recovery_claims c ON c.restaurant_id = ${rid}
        GROUP BY w.idx`),
      db.execute(sql`WITH ${W}
        SELECT w.idx,
          COALESCE(SUM(c.amount_agorot), 0) AS claimed,
          COALESCE(SUM(c.amount_agorot) FILTER (WHERE c.letter_sent_at IS NOT NULL), 0) AS sent,
          COALESCE(SUM(c.credited_agorot) FILTER (WHERE c.credited_at IS NOT NULL), 0) AS credited,
          COALESCE(SUM(c.credited_agorot) FILTER (WHERE c.recovered_at IS NOT NULL), 0) AS recovered
        FROM w JOIN recovery_claims c ON c.restaurant_id = ${rid} AND c.claimed_at >= w.lo AND c.claimed_at < w.hi
        GROUP BY w.idx`),
      db.execute(sql`WITH ${W},
        ev AS (
          SELECT a.after ->> 'automationId' AS aid, a.at AS at FROM audit_log a
          WHERE a.restaurant_id = ${rid} AND a.after ->> 'automationId' ~ ${AUTOMATION_ID_RE}
          UNION ALL
          SELECT ae.metadata ->> 'automationId', ae.created_at FROM activity_events ae
          WHERE ae.restaurant_id = ${rid} AND ae.metadata ->> 'automationId' ~ ${AUTOMATION_ID_RE}
        )
        SELECT w.idx, ev.aid, COUNT(*) AS n
        FROM w JOIN ev ON ev.at >= w.lo AND ev.at < w.hi
        GROUP BY w.idx, ev.aid`),
      db.execute(sql`
        SELECT LEAST(
          (SELECT MIN(created_at) FROM invoices WHERE restaurant_id = ${rid}),
          (SELECT MIN(created_at) FROM activity_events WHERE restaurant_id = ${rid})
        ) AS since`),
    ]);

  const byIdx = new Map<number, AutomationWeek>();
  let timezone = 'Asia/Jerusalem';
  const ordered: AutomationWeek[] = [];
  for (const r of rowsOf(weekRows)) {
    timezone = String(r.tz ?? timezone);
    const wk = emptyWeek(r.lo, r.hi);
    byIdx.set(num(r.idx), wk);
    ordered.push(wk);
  }
  const at = (r: Row): AutomationWeek | undefined => byIdx.get(num(r.idx));

  for (const r of rowsOf(docRows)) {
    const wk = at(r);
    if (!wk) continue;
    const n = num(r.n);
    wk.docsIn += n;
    wk.docsBySource[String(r.source)] = n;
    wk.duplicateCopies += num(r.dup);
  }
  for (const r of rowsOf(inboxRows)) {
    const wk = at(r);
    if (wk) wk.inboxDocs = num(r.n);
  }
  for (const r of rowsOf(matchRows)) {
    const wk = at(r);
    if (!wk) continue;
    const denom = num(r.denom);
    wk.zeroTouchDenominator = denom;
    wk.zeroTouchTouched = num(r.touched);
    wk.zeroTouchPct = pct(denom - wk.zeroTouchTouched, denom);
    wk.zeroTouchExcluded = {
      consolidated: num(r.ex_consolidated),
      pendingLink: num(r.ex_pending),
      duplicate: num(r.ex_duplicate),
    };
    wk.exceptionPct = pct(num(r.exceptions), denom);
    wk.arrivalToMatchedHoursP50 = numOrNull(r.p50);
    wk.arrivalToMatchedHoursP90 = numOrNull(r.p90);
  }
  for (const r of rowsOf(decisionRows)) {
    const wk = at(r);
    if (!wk) continue;
    wk.decisionAgeHoursP50 = numOrNull(r.p50);
    wk.decisionsResolved = num(r.n);
  }
  for (const r of rowsOf(alertRows)) {
    const wk = at(r);
    if (!wk) continue;
    wk.alerts.push({
      event: String(r.event),
      queued: num(r.queued),
      sent: num(r.sent),
      sentMock: num(r.sent_mock),
      failedNoProvider: num(r.failed_no_provider),
      failed: num(r.failed),
      cancelled: num(r.cancelled),
      opened: null,
      actedWithin48h: num(r.acted),
    });
  }
  for (const r of rowsOf(foundRows)) {
    const wk = at(r);
    if (wk) wk.funnelAgorot.found = num(r.found);
  }
  for (const r of rowsOf(decidedRows)) {
    const wk = at(r);
    if (wk) wk.funnelAgorot.decided = num(r.decided);
  }
  for (const r of rowsOf(claimRows)) {
    const wk = at(r);
    if (!wk) continue;
    wk.funnelAgorot.claimed = num(r.claimed);
    wk.funnelAgorot.sent = num(r.sent);
    wk.funnelAgorot.credited = num(r.credited);
    wk.funnelAgorot.recovered = num(r.recovered);
  }
  for (const r of rowsOf(cohortRows)) {
    const wk = at(r);
    if (!wk) continue;
    wk.cohortAgorot = {
      claimed: num(r.claimed),
      sent: num(r.sent),
      credited: num(r.credited),
      recovered: num(r.recovered),
    };
  }
  for (const r of rowsOf(runRows)) {
    const wk = at(r);
    if (wk) wk.automationRuns[String(r.aid)] = num(r.n);
  }

  const sinceRaw = rowsOf(sinceRows)[0]?.since;
  const dataSince = sinceRaw == null ? null : iso(sinceRaw);
  for (const wk of ordered) {
    wk.hasData = dataSince != null && wk.weekEnd > dataSince;
  }

  return {
    restaurantId,
    timezone,
    weeks: ordered,
    dataSince,
    openDecisionsOver24h: num(rowsOf(openRows)[0]?.n),
    touchActions: [...TOUCH_ACTIONS],
    timeLedger: computeTimeLedger(ordered, {
      rates: options.rates,
      bookkeeperFeeIls: options.bookkeeperFeeIls,
    }),
  };
}

const roundIls = (v: number) => Math.round(v * 100) / 100;

/**
 * Hours-₪ estimate: Σ per role (documents × minutes-saved range × loaded rate).
 * The bookkeeper's part is capped at her fee prorated to the window (weeks × 12/52),
 * because her time turns into money only if the fee goes down.
 */
export function computeTimeLedger(
  weeks: ReadonlyArray<Pick<AutomationWeek, 'docsIn' | 'zeroTouchDenominator' | 'zeroTouchTouched' | 'hasData'>>,
  options: { rates?: Partial<Record<AutomationRole, number>>; bookkeeperFeeIls?: number } = {},
): AutomationTimeLedger {
  const rates: Record<AutomationRole, number> = { ...AUTOMATION_RATE_DEFAULTS };
  for (const role of AUTOMATION_ROLES) {
    const v = options.rates?.[role];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) rates[role] = v;
  }
  const fee = options.bookkeeperFeeIls ?? BOOKKEEPER_FEE_DEFAULT_ILS;
  const docs = weeks.reduce((s, w) => s + w.docsIn, 0);
  const zeroTouch = weeks.reduce((s, w) => s + Math.max(0, w.zeroTouchDenominator - w.zeroTouchTouched), 0);
  const weekCount = weeks.filter((w) => w.hasData).length;
  const feeCap = roundIls((fee * 12 * weekCount) / 52);

  const m = AUTOMATION_MINUTES;
  const receiver = {
    lowIls: roundIls((docs * m.receiverPerDoc.low * rates.receiver) / 60),
    highIls: roundIls((docs * m.receiverPerDoc.high * rates.receiver) / 60),
  };
  const bkLow = (zeroTouch * m.bookkeeperPerZeroTouch.low * rates.bookkeeper) / 60;
  const bkHigh = (zeroTouch * m.bookkeeperPerZeroTouch.high * rates.bookkeeper) / 60;
  const bookkeeperCapped = bkHigh > feeCap;
  const bookkeeper = { lowIls: roundIls(Math.min(bkLow, feeCap)), highIls: roundIls(Math.min(bkHigh, feeCap)) };

  return {
    lowIls: roundIls(receiver.lowIls + bookkeeper.lowIls),
    highIls: roundIls(receiver.highIls + bookkeeper.highIls),
    bookkeeperCapped,
    byRole: [
      { role: 'receiver', ...receiver },
      { role: 'bookkeeper', ...bookkeeper },
    ],
    assumptions: [
      ...AUTOMATION_ROLES.map((role) => ({ key: `rate.${role}`, value: rates[role], unit: 'ils_per_hour' as const })),
      { key: 'minutes.receiverPerDoc.low', value: m.receiverPerDoc.low, unit: 'minutes' },
      { key: 'minutes.receiverPerDoc.high', value: m.receiverPerDoc.high, unit: 'minutes' },
      { key: 'minutes.bookkeeperPerZeroTouch.low', value: m.bookkeeperPerZeroTouch.low, unit: 'minutes' },
      { key: 'minutes.bookkeeperPerZeroTouch.high', value: m.bookkeeperPerZeroTouch.high, unit: 'minutes' },
      { key: 'bookkeeperFeeMonthly', value: fee, unit: 'ils_per_month' },
      { key: 'docs', value: docs, unit: 'count' },
      { key: 'zeroTouchInvoices', value: zeroTouch, unit: 'count' },
    ],
  };
}
