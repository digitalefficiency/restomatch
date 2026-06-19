/**
 * Derive the expected delivery date for a new purchase order from a supplier's
 * ACTIONABLE order cadence (OrderSchedule). Pure + timezone-correct: all
 * weekday / cutoff / calendar math anchors to the restaurant's wall clock via
 * the Wave-0 tz helpers — never the server's local time.
 *
 * Weekday convention everywhere: 0 = Sunday … 6 = Saturday (JS Date#getDay).
 *
 * Contract:
 *  - POs with no schedule → caller passes null and we return null (manual entry
 *    stays the source of truth; we never fabricate a date).
 *  - The result ALWAYS signals `missedCutoff` + `windowUsed` so the UI can say
 *    "too late for tomorrow — next delivery is X" instead of silently rolling.
 */

import type { OrderSchedule, OrderWindow } from '@restomatch/types';
import { addCalendarDaysInTz, startOfDayInTz } from './time';

export interface DerivedDelivery {
  /** UTC instant at the START of the local delivery day. */
  expectedDeliveryAt: Date;
  /** UTC instant of the cutoff that governed this derivation (local wall clock). */
  nextOrderCutoffAt: Date;
  /** The window whose orderDays/cutoff/fulfillment produced the result. */
  windowUsed: OrderWindow;
  /**
   * True when the order is being placed AFTER today's cutoff for an otherwise
   * eligible order day, so the order effectively rolls to the next order day.
   * The UI MUST surface this rather than silently shifting the date.
   */
  missedCutoff: boolean;
}

/** Weekend days we never deliver on (Fri = 5, Sat = 6 in IL). */
const WEEKEND = new Set([5, 6]);

/** Hard cap on the forward search so a pathological schedule can't loop forever. */
const MAX_LOOKAHEAD_DAYS = 60;

/**
 * The local weekday (0 = Sun … 6 = Sat) of the local day that CONTAINS `utc`
 * in `tz`. We read the start-of-local-day UTC instant and add 12h before asking
 * the zone for the day-of-week, so a DST edge near local midnight can't push us
 * onto the adjacent calendar day.
 */
function localWeekday(utc: Date, tz: string): number {
  const localMidnightUtc = startOfDayInTz(utc, tz);
  const safeMidday = new Date(localMidnightUtc.getTime() + 12 * 60 * 60 * 1000);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(safeMidday);
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return idx; // -1 only if Intl misbehaves; callers treat that as "no match".
}

/** 'YYYY-MM-DD' of the local day containing `utc` in `tz` — holiday-set key. */
function localDateKey(utc: Date, tz: string): string {
  const localMidnightUtc = startOfDayInTz(utc, tz);
  const safeMidday = new Date(localMidnightUtc.getTime() + 12 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(safeMidday);
}

/** UTC instant of the given 'HH:MM' local wall-clock cutoff on `utc`'s local day. */
function cutoffInstant(utc: Date, tz: string, cutoff: string): Date {
  const [hStr, mStr] = cutoff.split(':');
  const h = Number(hStr ?? 0);
  const m = Number(mStr ?? 0);
  const localMidnightUtc = startOfDayInTz(utc, tz);
  // startOfDayInTz gives local 00:00; adding wall-clock minutes is DST-safe
  // because we go via addCalendarDaysInTz(0) only for day shifts, not here —
  // the cutoff is within the same local day so a fixed ms add is correct.
  return new Date(localMidnightUtc.getTime() + (h * 60 + m) * 60 * 1000);
}

/**
 * Is `day` (0–6) deliverable? Skips IL weekend (Fri/Sat) and, if a holiday set
 * is supplied, any local date in it.
 *
 * TODO(later wave): the IL holiday JSON (chagim, erev-chag early cutoffs) is not
 * wired yet. Callers may pass an OPTIONAL Set<'YYYY-MM-DD'> of restaurant-local
 * non-delivery dates; until that data source exists this stays undefined and we
 * only skip the fixed weekend.
 */
function isDeliverable(dayUtc: Date, tz: string, holidays?: Set<string>): boolean {
  const wd = localWeekday(dayUtc, tz);
  if (WEEKEND.has(wd)) return false;
  if (holidays && holidays.has(localDateKey(dayUtc, tz))) return false;
  return true;
}

/** Advance to the next deliverable local day at/after `fromUtc` (inclusive). */
function nextDeliverableDay(fromUtc: Date, tz: string, holidays?: Set<string>): Date | null {
  let cursor = startOfDayInTz(fromUtc, tz);
  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    if (isDeliverable(cursor, tz, holidays)) return cursor;
    cursor = addCalendarDaysInTz(cursor, 1, tz);
  }
  return null;
}

/**
 * Resolve the delivery day for a single window given the EFFECTIVE order day
 * (the local day the order counts as placed on, after any cutoff roll).
 */
function deliveryForWindow(
  window: OrderWindow,
  orderDayUtc: Date,
  tz: string,
  holidays?: Set<string>,
): Date | null {
  const f = window.fulfillment;
  if (f.kind === 'lead_days') {
    const target = addCalendarDaysInTz(orderDayUtc, f.leadDays, tz);
    return nextDeliverableDay(target, tz, holidays);
  }
  // next_named_day: first occurrence of deliversOnDay at/after the order day.
  // If the order day itself is the named day, deliver that day (then weekend/
  // holiday skip can only ever push it forward, which nextDeliverableDay does).
  let cursor = startOfDayInTz(orderDayUtc, tz);
  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    if (localWeekday(cursor, tz) === f.deliversOnDay) {
      return nextDeliverableDay(cursor, tz, holidays);
    }
    cursor = addCalendarDaysInTz(cursor, 1, tz);
  }
  return null;
}

/**
 * Core derivation. Single-window happy path is the design target; multi-window
 * schedules are handled by picking the EARLIEST eligible order day across all
 * windows (so a richer schedule still produces the soonest sensible delivery).
 *
 * @param schedule the supplier's order cadence, or null for no schedule.
 * @param nowUtc   the instant the order is being placed (UTC).
 * @param tz       restaurant IANA timezone (caller resolves the default).
 * @param holidays OPTIONAL set of restaurant-local 'YYYY-MM-DD' non-delivery
 *                 dates (IL holiday JSON is a later wave — see isDeliverable).
 * @returns the derived delivery + cutoff signals, or null when no schedule.
 */
export function deriveExpectedDelivery(
  schedule: OrderSchedule | null | undefined,
  nowUtc: Date,
  tz: string,
  holidays?: Set<string>,
): DerivedDelivery | null {
  if (!schedule || schedule.windows.length === 0) return null;
  const zone = schedule.tz ?? tz;

  let best:
    | { delivery: Date; cutoff: Date; window: OrderWindow; missedCutoff: boolean }
    | null = null;

  for (const window of schedule.windows) {
    const orderDaySet = new Set(window.orderDays);
    const todayWeekday = localWeekday(nowUtc, zone);
    const todayCutoff = cutoffInstant(nowUtc, zone, window.cutoff);

    // Find the effective order day for this window: today if it's an order day
    // and we're at/before cutoff; otherwise the next order weekday (which also
    // covers the "missed today's cutoff" roll).
    let effectiveOrderDay: Date | null = null;
    let missedCutoff = false;
    let usedCutoff = todayCutoff;

    const onTimeToday = orderDaySet.has(todayWeekday) && nowUtc.getTime() <= todayCutoff.getTime();
    if (onTimeToday) {
      effectiveOrderDay = startOfDayInTz(nowUtc, zone);
    } else {
      // Roll forward to the next order weekday. If today WAS an order day, the
      // reason we're rolling is the cutoff — signal it.
      missedCutoff = orderDaySet.has(todayWeekday);
      let cursor = addCalendarDaysInTz(startOfDayInTz(nowUtc, zone), 1, zone);
      for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
        if (orderDaySet.has(localWeekday(cursor, zone))) {
          effectiveOrderDay = cursor;
          usedCutoff = cutoffInstant(cursor, zone, window.cutoff);
          break;
        }
        cursor = addCalendarDaysInTz(cursor, 1, zone);
      }
    }

    if (!effectiveOrderDay) continue;
    const delivery = deliveryForWindow(window, effectiveOrderDay, zone, holidays);
    if (!delivery) continue;

    if (!best || delivery.getTime() < best.delivery.getTime()) {
      best = { delivery, cutoff: usedCutoff, window, missedCutoff };
    }
  }

  if (!best) return null;
  return {
    expectedDeliveryAt: best.delivery,
    nextOrderCutoffAt: best.cutoff,
    windowUsed: best.window,
    missedCutoff: best.missedCutoff,
  };
}
