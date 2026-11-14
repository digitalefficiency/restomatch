/**
 * Pure rules the task sources share with the screens they summarise. Each one
 * mirrors a web rule to the agora, and `apps/web/app/dashboard/home/__tests__/
 * needs-rows.test.ts` pins the pair together, so a home row, a badge and the
 * page it lands on can never drift apart:
 * - `claimFollowUps`  ↔ `app/dashboard/recovery/logic.ts` `followUps` (W2-10);
 * - `deliverySummary` ↔ `app/dashboard/home/board.ts` `buildBoard().summary`;
 * - `todayCutoffs`    ↔ the manager's order windows (moved here from home/cutoffs.ts).
 */
import { CLAIM_ANSWER_DAYS } from '../../lib/claims';
import { daysBetween, israelDay } from '../rank';

export interface ClaimLike {
  status: string;
  outstandingAgorot: number;
  letterSentAt: string | null;
  claimedAt: string;
  supplierName?: string | null;
}

export interface FollowUps {
  unsent: { count: number; agorot: number; oldest: string | null };
  waiting: { count: number; agorot: number; oldest: string | null };
}

/**
 * Letters never sent (a decided gap, decision 18: undecided gaps are never
 * claims), and sent letters whose supplier's latest letter is past the
 * CLAIM_ANSWER_DAYS answer window. An acknowledged claim is answered.
 */
export function claimFollowUps(claims: readonly ClaimLike[], nowIso: string): FollowUps {
  const out: FollowUps = { unsent: { count: 0, agorot: 0, oldest: null }, waiting: { count: 0, agorot: 0, oldest: null } };
  const older = (a: string | null, b: string) => (a === null || b < a ? b : a);
  const sent = new Map<string, { latest: string; first: string; count: number; agorot: number }>();
  for (const c of claims) {
    if (c.outstandingAgorot <= 0) continue;
    if (c.status === 'claimed') {
      out.unsent.count += 1;
      out.unsent.agorot += c.outstandingAgorot;
      out.unsent.oldest = older(out.unsent.oldest, c.claimedAt);
    } else if (c.status === 'letter_sent' && c.letterSentAt) {
      const key = (c.supplierName ?? '').trim() || '—';
      const g = sent.get(key) ?? { latest: c.letterSentAt, first: c.letterSentAt, count: 0, agorot: 0 };
      g.count += 1;
      g.agorot += c.outstandingAgorot;
      if (c.letterSentAt > g.latest) g.latest = c.letterSentAt;
      if (c.letterSentAt < g.first) g.first = c.letterSentAt;
      sent.set(key, g);
    }
  }
  const today = israelDay(nowIso);
  for (const g of sent.values()) {
    if (daysBetween(today, israelDay(g.latest)) + CLAIM_ANSWER_DAYS < 0) {
      out.waiting.count += g.count;
      out.waiting.agorot += g.agorot;
      out.waiting.oldest = older(out.waiting.oldest, g.first);
    }
  }
  return out;
}

export interface ExpectationLike {
  expectedAt: string;
  hasDeliveryDate: boolean;
  receiptStatus: string | null;
  /** Dated before today and still not received (server, `includeLate`). */
  late: boolean;
  closedAt: string | null;
}

/** A truck is late this long after its expected time (= board.ts LATE_GRACE_MS). */
export const LATE_GRACE_MS = 30 * 60_000;

const hm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

/**
 * Today's trucks exactly as the receiving board counts them (board.ts
 * `buildBoard().summary`): open dated trucks + today's closed ones; late = an
 * open truck the server flagged late, or a not-started one past its window
 * (+ grace; a day-only PO stored at 00:00 is never late from the clock).
 */
export function deliverySummary(rows: readonly ExpectationLike[], now: Date): { total: number; received: number; late: number } {
  const today = israelDay(now);
  let openDated = 0;
  let received = 0;
  let late = 0;
  for (const e of rows) {
    const closed = e.receiptStatus === 'completed' || e.receiptStatus === 'partial' || e.receiptStatus === 'rejected';
    if (closed) {
      if (israelDay(e.closedAt ?? e.expectedAt) === today) received += 1;
      continue;
    }
    const notStarted = e.receiptStatus !== 'pending';
    const expected = new Date(e.expectedAt);
    const overdue = e.hasDeliveryDate && hm(expected) !== '00:00' && expected.getTime() + LATE_GRACE_MS < now.getTime();
    if (e.late || (notStarted && overdue)) late += 1;
    if (e.hasDeliveryDate) openDated += 1;
  }
  return { total: openDated + received, received, late };
}

export interface ScheduleLike {
  windows: { orderDays: number[]; cutoff: string }[];
  tz?: string;
}
export interface SupplierWithSchedule {
  id: string;
  name: string;
  nameEn?: string | null;
  orderSchedule?: ScheduleLike | null;
}
export interface TodayCutoff {
  supplierId: string;
  supplierName: string;
  supplierNameEn: string | null;
  /** 'HH:MM' local. */
  cutoff: string;
  /** Minutes from now until the cutoff (> 0). */
  minutesLeft: number;
}

function wallClock(now: Date, tz: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Which suppliers' order windows close later today, soonest first. Reads
 * `suppliers.order_schedule` (orderDays 0 = Sun … 6 = Sat, cutoff 'HH:MM' on
 * the restaurant's wall clock). Holidays are not modelled (a later wave).
 */
export function todayCutoffs(suppliers: readonly SupplierWithSchedule[], now: Date, restaurantTz = 'Asia/Jerusalem'): TodayCutoff[] {
  const out: TodayCutoff[] = [];
  for (const s of suppliers) {
    const schedule = s.orderSchedule;
    if (!schedule?.windows?.length) continue;
    const { weekday, minutes } = wallClock(now, schedule.tz ?? restaurantTz);
    let best: { cutoff: string; left: number } | null = null;
    for (const w of schedule.windows) {
      if (!w.orderDays.includes(weekday)) continue;
      const [h, m] = w.cutoff.split(':').map(Number);
      const left = (h ?? 0) * 60 + (m ?? 0) - minutes;
      if (left > 0 && (!best || left < best.left)) best = { cutoff: w.cutoff, left };
    }
    if (best) out.push({ supplierId: s.id, supplierName: s.name, supplierNameEn: s.nameEn ?? null, cutoff: best.cutoff, minutesLeft: best.left });
  }
  return out.sort((a, b) => a.minutesLeft - b.minutesLeft);
}
