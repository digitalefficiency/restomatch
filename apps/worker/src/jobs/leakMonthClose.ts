/**
 * leak-month-close (H-07ʰ) — the monthly leak close.
 *
 *  • A month M is CLOSED from 00:00 on the 5th of M+1 in the restaurant's own
 *    time zone (restaurants.timezone). Before that it is open: no snapshot.
 *  • Snapshot: version 1 per (restaurant, month), leak_agorot = the hero leak of
 *    that month TO THE AGORA (computeLeakHero; the job refuses to write when the
 *    per-invoice sum disagrees), reason NULL, created_by NULL (system). The
 *    payload keeps the leak per invoice as the baseline for corrections.
 *  • Catch-up: every run snapshots every closed month that has no snapshot yet,
 *    from the restaurant's first invoice month, at most CATCH_UP_MONTHS back.
 *    W3-γ deploys on Tue 5.1.2027, so the first run closes December on time.
 *  • A closed month never restates: the job never UPDATEs or DELETEs a snapshot
 *    (the 0072 append-only trigger is the backstop) and never writes version ≥ 2
 *    (a re-close is a human act with a reason). A later change to a closed month
 *    — a discrepancy rejected, an invoice matched, re-dated or deleted — becomes
 *    one dated leak_month_corrections row per invoice (signed delta, reason),
 *    against the latest snapshot version. Unchanged months write nothing.
 *  • Per restaurant: one transaction under an advisory lock; one restaurant's
 *    failure is reported and does not stop the others.
 *
 * Runs on the owner DATABASE_URL like every job (jobDb): the app role may only
 * read leak_month_* (H-03 rls.ts revokes its writes).
 *
 * Interim basis (owner decision M6): "caught before payment" in the payload is
 * the hero's `status <> 'paid'` until H-03's paid_at and G-14's partition land
 * (slice b). The frozen leak itself does not depend on it.
 */
import { computeLeakHero, computeMonthInvoiceLeaks, type LeakHero } from '@restomatch/charts';
import { sql, type Database } from '@restomatch/db';
import { jobDb } from '../db';
import { makeWorker, type WorkerJob } from '../queue';

export interface LeakMonthCloseJob {
  /** Only this restaurant (tests / a manual run). Default: every restaurant. */
  restaurantId?: string;
  /** Override "now" (ISO): tests / a manual re-run for a given day. */
  forDate?: string;
}

export interface LeakMonthCloseResult {
  restaurants: number;
  snapshots: number;
  corrections: number;
  failed: { restaurantId: string; error: string }[];
}

/** How far back the first run catches up (older months predate the product). */
export const CATCH_UP_MONTHS = 24;
/** The day of the next month on which a month closes (restaurant-local). */
export const CLOSE_DAY = 5;
export const PAYLOAD_SCHEMA = 'leak-month-close/v1';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const ymd = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const agorot = (ils: number): number => Math.round(ils * 100);

/** 'YYYY-MM-01' → months since year 0 (for offsets between local months). */
const monthIndex = (first: string): number => Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1;
const fromIndex = (i: number): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;

/**
 * The closed months to snapshot, oldest first: from max(firstMonth, lastClosed −
 * (CATCH_UP_MONTHS−1)) to lastClosed, minus those already snapshotted. Pure.
 */
export function monthsToClose(
  firstMonth: string | null,
  lastClosedMonth: string,
  snapshotted: ReadonlySet<string>,
): string[] {
  if (!firstMonth) return [];
  const last = monthIndex(lastClosedMonth);
  const first = Math.max(monthIndex(firstMonth), last - (CATCH_UP_MONTHS - 1));
  const out: string[] = [];
  for (let i = first; i <= last; i++) {
    const m = fromIndex(i);
    if (!snapshotted.has(m)) out.push(m);
  }
  return out;
}

/**
 * Per-invoice corrections against a frozen baseline: current − (baseline +
 * already corrected), for the union of invoices. Only non-zero deltas, sorted
 * by invoice id. Pure.
 */
export function correctionDeltas(
  baseline: Readonly<Record<string, number>>,
  corrected: ReadonlyMap<string, number>,
  current: ReadonlyMap<string, number>,
): { invoiceId: string; deltaAgorot: number }[] {
  const ids = new Set<string>([...Object.keys(baseline), ...corrected.keys(), ...current.keys()]);
  const out: { invoiceId: string; deltaAgorot: number }[] = [];
  for (const id of [...ids].sort()) {
    const known = (baseline[id] ?? 0) + (corrected.get(id) ?? 0);
    const delta = (current.get(id) ?? 0) - known;
    if (delta !== 0) out.push({ invoiceId: id, deltaAgorot: delta });
  }
  return out;
}

/** dd.mm.yyyy of `now` in `tz` (the date printed on a correction line). */
function localDate(now: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

export function correctionReason(now: Date, tz: string): string {
  return `שינוי אחרי סגירת החודש · חושב מחדש ב-${localDate(now, tz)}`;
}

function heroPayload(hero: LeakHero, invoices: Record<string, number>, tz: string, now: Date): Record<string, unknown> {
  return {
    schema: PAYLOAD_SCHEMA,
    tz,
    monthStart: hero.monthStart,
    monthEnd: hero.monthEnd,
    closedAt: now.toISOString(),
    basis: {
      leak: 'leak-hero: LEAK_FILTER, per-invoice cap at the invoice total',
      caughtBeforePayment: "interim: status <> 'paid' (until H-03 paid_at + G-14; owner decision M6)",
    },
    hero: {
      leakAgorot: agorot(hero.leakIls),
      spendAgorot: agorot(hero.spendIls),
      caughtBeforePaymentAgorot: agorot(hero.caughtBeforePaymentIls),
      recoveredAgorot: agorot(hero.recoveredIls),
      pendingLinkAgorot: agorot(hero.pendingLinkIls),
      awaitingCountAgorot: agorot(hero.awaitingCountIls),
      invoiceCount: hero.invoiceCount,
      matchedInvoiceCount: hero.matchedInvoiceCount,
      invoicesWithLeak: hero.invoicesWithLeak,
      pendingLinkCount: hero.pendingLinkCount,
      awaitingCountCount: hero.awaitingCountCount,
    },
    /** The leak per invoice at close (agorot; absent = 0): the correction baseline. */
    invoices,
  };
}

interface RestaurantClock {
  id: string;
  tz: string;
  currentMonth: string;
  lastClosedMonth: string;
  firstMonth: string | null;
}

async function restaurantClocks(db: Database, now: Date, restaurantId?: string): Promise<RestaurantClock[]> {
  const res = await db.execute(sql`
    WITH r AS (
      SELECT id, COALESCE(timezone, 'Asia/Jerusalem') AS tz,
             (${now.toISOString()}::timestamptz AT TIME ZONE COALESCE(timezone, 'Asia/Jerusalem')) AS lnow
      FROM restaurants
      ${restaurantId ? sql`WHERE id = ${restaurantId}::uuid` : sql``}
    )
    SELECT r.id, r.tz,
      date_trunc('month', r.lnow)::date AS current_month,
      (date_trunc('month', r.lnow)
        - CASE WHEN EXTRACT(DAY FROM r.lnow) >= ${CLOSE_DAY} THEN interval '1 month' ELSE interval '2 months' END)::date
        AS last_closed,
      (SELECT date_trunc('month', MIN(COALESCE(i.invoice_date, i.created_at)) AT TIME ZONE r.tz)::date
         FROM invoices i WHERE i.restaurant_id = r.id) AS first_month
    FROM r
    ORDER BY r.id
  `);
  return rowsOf(res).map((r) => ({
    id: String(r.id),
    tz: String(r.tz),
    currentMonth: ymd(r.current_month),
    lastClosedMonth: ymd(r.last_closed),
    firstMonth: r.first_month == null ? null : ymd(r.first_month),
  }));
}

/** Close one restaurant: catch-up snapshots, then dated corrections. One transaction. */
export async function closeRestaurantMonths(
  db: Database,
  clock: RestaurantClock,
  now: Date,
): Promise<{ snapshots: number; corrections: number }> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`leak-month-close:${clock.id}`}, 0))`);

    // The latest snapshot version per month (a human re-close is version n+1).
    const latest = rowsOf(
      await tx.execute(sql`
        SELECT DISTINCT ON (month) id, month, payload
        FROM leak_month_snapshots
        WHERE restaurant_id = ${clock.id}::uuid
        ORDER BY month, version DESC
      `),
    );
    const snapshotted = new Set(latest.map((s) => ymd(s.month)));
    const offsetOf = (month: string) => monthIndex(month) - monthIndex(clock.currentMonth);
    const currentLeaks = async (month: string) =>
      new Map(
        (await computeMonthInvoiceLeaks(tx, clock.id, { now, monthOffset: offsetOf(month) })).map((l) => [
          l.invoiceId,
          l.leakAgorot,
        ]),
      );

    // 1. Snapshots (catch-up included).
    let snapshots = 0;
    for (const month of monthsToClose(clock.firstMonth, clock.lastClosedMonth, snapshotted)) {
      const hero = await computeLeakHero(tx, clock.id, { now, monthOffset: offsetOf(month) });
      const perInvoice = await currentLeaks(month);
      const sum = [...perInvoice.values()].reduce((a, b) => a + b, 0);
      if (sum !== agorot(hero.leakIls)) {
        throw new Error(`leak parity failed for ${month}: Σ invoices ${sum} ≠ hero ${agorot(hero.leakIls)} agorot`);
      }
      const invoices = Object.fromEntries([...perInvoice.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
      const inserted = rowsOf(
        await tx.execute(sql`
          INSERT INTO leak_month_snapshots (restaurant_id, month, version, computed_at, leak_agorot, payload)
          VALUES (${clock.id}::uuid, ${month}::date, 1, ${now.toISOString()}::timestamptz, ${sum},
                  ${JSON.stringify(heroPayload(hero, invoices, clock.tz, now))}::jsonb)
          ON CONFLICT (restaurant_id, month, version) DO NOTHING
          RETURNING id
        `),
      );
      snapshots += inserted.length;
    }

    // 2. Dated corrections against months frozen BEFORE this run.
    let corrections = 0;
    const reason = correctionReason(now, clock.tz);
    for (const s of latest) {
      const month = ymd(s.month);
      if (monthIndex(month) > monthIndex(clock.lastClosedMonth)) continue; // never touch an open month
      const payload = (s.payload ?? {}) as { invoices?: Record<string, number> };
      const baseline = payload.invoices ?? {};
      const corrected = new Map(
        rowsOf(
          await tx.execute(sql`
            SELECT entity_id, SUM(delta_agorot)::bigint AS total
            FROM leak_month_corrections
            WHERE restaurant_id = ${clock.id}::uuid AND snapshot_id = ${String(s.id)}::uuid AND entity_type = 'invoice'
            GROUP BY entity_id
          `),
        ).map((r) => [String(r.entity_id), Number(r.total)]),
      );
      const deltas = correctionDeltas(baseline, corrected, await currentLeaks(month));
      for (const d of deltas) {
        await tx.execute(sql`
          INSERT INTO leak_month_corrections (restaurant_id, snapshot_id, delta_agorot, reason, entity_type, entity_id, created_at)
          VALUES (${clock.id}::uuid, ${String(s.id)}::uuid, ${d.deltaAgorot}, ${reason}, 'invoice', ${d.invoiceId}::uuid,
                  ${now.toISOString()}::timestamptz)
        `);
      }
      corrections += deltas.length;
    }
    return { snapshots, corrections };
  });
}

export async function runLeakMonthClose(
  db: Database,
  opts: { now?: Date; restaurantId?: string } = {},
): Promise<LeakMonthCloseResult> {
  const now = opts.now ?? new Date();
  const res: LeakMonthCloseResult = { restaurants: 0, snapshots: 0, corrections: 0, failed: [] };
  for (const clock of await restaurantClocks(db, now, opts.restaurantId)) {
    res.restaurants += 1;
    try {
      const r = await closeRestaurantMonths(db, clock, now);
      res.snapshots += r.snapshots;
      res.corrections += r.corrections;
    } catch (err) {
      res.failed.push({ restaurantId: clock.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return res;
}

export function startLeakMonthCloseWorker() {
  return makeWorker<LeakMonthCloseJob>('leak-month-close', processLeakMonthClose);
}

/** The leak-month-close job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processLeakMonthClose(job: WorkerJob<LeakMonthCloseJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const res = await runLeakMonthClose(jobDb(url), {
    restaurantId: job.data.restaurantId,
    now: job.data.forDate ? new Date(job.data.forDate) : new Date(),
  });
  console.log(
    `[leak-month-close] restaurants=${res.restaurants} snapshots=${res.snapshots} corrections=${res.corrections} failed=${res.failed.length}` +
      (res.failed.length ? ` (${res.failed.map((f) => `${f.restaurantId}: ${f.error}`).join('; ')})` : ''),
  );
  if (res.failed.length && res.failed.length === res.restaurants) {
    throw new Error(`leak-month-close failed for every restaurant (${res.failed.length})`);
  }
  return res;
}
