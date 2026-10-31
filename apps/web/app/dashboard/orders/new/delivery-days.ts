/**
 * Delivery-day chips for the order wizard: the next valid delivery days from the
 * supplier's order schedule, each with the order-by moment that gets it ("הזמנה
 * עד 16:00 היום → אספקה מחר"). Pure and timezone-correct — all day math runs on
 * restaurant-local 'YYYY-MM-DD' keys, never the browser's clock zone. Mirrors the
 * server's deriveExpectedDelivery (packages/api/src/lib/deriveDelivery.ts): Fri/Sat
 * are never delivery days; a cutoff that has passed today skips today's order day.
 * The server still re-derives at createDraft, so this only ever proposes dates.
 */

export interface ScheduleWindowLike {
  orderDays: number[];
  cutoff: string;
  fulfillment: { kind: 'lead_days'; leadDays: number } | { kind: 'next_named_day'; deliversOnDay: number };
}

export interface DeliveryOption {
  /** Restaurant-local delivery day, 'YYYY-MM-DD'. */
  date: string;
  /** The last moment to order for this day, when the supplier has a schedule. */
  orderBy: { date: string; cutoff: string } | null;
}

const WEEKEND = new Set([5, 6]);
const LOOKAHEAD = 21;

/** 'YYYY-MM-DD' + HH:MM of `now` on the restaurant's wall clock. */
export function localNow(now: Date, tz: string): { date: string; hm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hm: `${get('hour')}:${get('minute')}` };
}

/** Calendar arithmetic on a date key (UTC noon keeps it off any DST edge). */
export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a date key. */
export function weekdayOf(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function nextDeliverable(key: string): string {
  let k = key;
  for (let i = 0; i < 7 && WEEKEND.has(weekdayOf(k)); i++) k = addDays(k, 1);
  return k;
}

function deliveryFor(w: ScheduleWindowLike, orderDay: string): string {
  if (w.fulfillment.kind === 'lead_days') return nextDeliverable(addDays(orderDay, w.fulfillment.leadDays));
  let k = orderDay;
  for (let i = 0; i < 7 && weekdayOf(k) !== w.fulfillment.deliversOnDay; i++) k = addDays(k, 1);
  return nextDeliverable(k);
}

/**
 * The next `n` delivery days. With a schedule: from each eligible order day (today
 * only while its cutoff hasn't passed). Without one: the next deliverable days from
 * tomorrow (the server's default for an unscheduled supplier is tomorrow, past Fri/Sat).
 */
export function nextDeliveryOptions(
  windows: ScheduleWindowLike[] | null | undefined,
  now: Date,
  tz: string,
  n = 3,
): DeliveryOption[] {
  const { date: today, hm } = localNow(now, tz);
  if (!windows || windows.length === 0) {
    const out: DeliveryOption[] = [];
    let k = nextDeliverable(addDays(today, 1));
    while (out.length < n) {
      out.push({ date: k, orderBy: null });
      k = nextDeliverable(addDays(k, 1));
    }
    return out;
  }
  const byDate = new Map<string, DeliveryOption>();
  for (let i = 0; i < LOOKAHEAD && byDate.size < n * 3; i++) {
    const orderDay = addDays(today, i);
    const wd = weekdayOf(orderDay);
    for (const w of windows) {
      if (!w.orderDays.includes(wd)) continue;
      if (i === 0 && hm >= w.cutoff) continue; // today's cutoff has passed
      const date = deliveryFor(w, orderDay);
      if (date < today) continue;
      const prev = byDate.get(date);
      // Keep the LATEST order-by for a day: that is the real deadline for it.
      if (!prev || (prev.orderBy && `${orderDay} ${w.cutoff}` > `${prev.orderBy.date} ${prev.orderBy.cutoff}`)) {
        byDate.set(date, { date, orderBy: { date: orderDay, cutoff: w.cutoff } });
      }
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, n);
}
