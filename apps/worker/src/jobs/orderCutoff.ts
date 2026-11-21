/**
 * order-cutoff — W3-09 / AU-11: the 2-hour-before-cut-off push, as a pure planner.
 *
 * The job has no slot time of its own (`WorkerJob` carries `data: {}`), so it
 * floors `now` to its 15-minute bucket (:00/:15/:30/:45, Asia/Jerusalem) and
 * picks the suppliers whose cut-off TODAY falls in the half-open window
 * [bucket + 2 h, bucket + 2 h 15 min). One rule, shared with H-05a §5.B:
 *  - IL wall time outside 06:00–21:59 → skip (no catch-up pushes at night);
 *  - a cut-off before 08:00 gets no intraday push (the previous day's 09:00
 *    prepared-draft message names it);
 *  - per supplier per IL day dedupe (`au:A16:cutoff:<rid>:<supplierId>:<day>`).
 *
 * Nothing enqueues this job yet: its slot `order-cutoff-15m` is registered by the
 * H-05a human PR (cron.ts is immutable). The send side (G-06 `notify()`) is wired
 * in W3-09 slice b. It never sends anything to a supplier.
 */
import type { OrderSchedule } from '@restomatch/db';
import { ilDateKey, ilWeekday, IL_TZ } from '../lib/notifyHelpers';

export const BUCKET_MIN = 15;
export const LEAD_MIN = 120;
export const ACTIVE_FROM_MIN = 6 * 60; // 06:00
export const ACTIVE_UNTIL_MIN = 22 * 60; // up to 21:59
export const EARLIEST_PUSHED_CUTOFF_MIN = 8 * 60; // 08:00

/** Minutes since IL midnight of `ref` (wall time). */
export function ilMinuteOfDay(ref: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ref);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/** 'HH:MM' → minutes since midnight, or null when malformed. */
export function parseCutoff(cutoff: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(cutoff ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function cutoffBucket(now: Date): number {
  const min = ilMinuteOfDay(now);
  return min - (min % BUCKET_MIN);
}

export interface CutoffSupplier {
  supplierId: string;
  active: boolean;
  orderSchedule: OrderSchedule | null;
  /** The supplier's order for today was already sent (or marked sent). */
  sentToday: boolean;
}

export interface CutoffPush {
  supplierId: string;
  cutoff: string;
  dedupeKey: string;
}

export type CutoffPlan = { skipped: 'quiet_hours'; pushes: [] } | { skipped: null; pushes: CutoffPush[] };

export function planCutoffPushes(restaurantId: string, suppliers: readonly CutoffSupplier[], now: Date): CutoffPlan {
  const bucket = cutoffBucket(now);
  if (bucket < ACTIVE_FROM_MIN || bucket >= ACTIVE_UNTIL_MIN) return { skipped: 'quiet_hours', pushes: [] };
  const from = bucket + LEAD_MIN;
  const to = from + BUCKET_MIN;
  const weekday = ilWeekday(now);
  const day = ilDateKey(now);
  const pushes: CutoffPush[] = [];
  for (const s of suppliers) {
    if (!s.active || s.sentToday) continue;
    const window = s.orderSchedule?.windows?.find((w) => w.orderDays.includes(weekday));
    const c = parseCutoff(window?.cutoff);
    if (c === null || c < EARLIEST_PUSHED_CUTOFF_MIN) continue;
    if (c >= from && c < to) {
      pushes.push({ supplierId: s.supplierId, cutoff: window!.cutoff, dedupeKey: `au:A16:cutoff:${restaurantId}:${s.supplierId}:${day}` });
    }
  }
  return { skipped: null, pushes };
}
