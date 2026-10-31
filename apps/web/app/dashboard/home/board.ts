/**
 * Receiving board (W1-05): the pure state machine behind the receiver's "Today"
 * home and /dashboard/receiving. One state per truck, one verb per state:
 *
 *   not started → "התחל קבלה" · open receipt → "המשך קבלה" (neutral, never a
 *   warning) · closed → "התקבל ✓" (read-only) · late → past its window, or a
 *   past-day PO still not received.
 *
 * Groups, in the order the receiver reads them: next truck (enlarged), באיחור,
 * עכשיו / הבא, בהמשך היום, ללא תאריך, התקבלו.
 */

/** The fields of `receiving.todayExpectations` the board reads. */
export interface BoardExpectation {
  poId: string;
  supplierName: string;
  supplierNameEn: string | null;
  expectedAt: string;
  hasDeliveryDate: boolean;
  lineCount: number;
  receiptId: string | null;
  receiptStatus: string | null;
  /** Dated before today and still not received (server, `includeLate`). */
  late: boolean;
  closedAt: string | null;
}

export type TruckState = 'notStarted' | 'inProgress' | 'received' | 'receivedPartial';

export interface BoardItem extends BoardExpectation {
  state: TruckState;
  /** Past its delivery window (+ grace) without a closed receipt. */
  isLate: boolean;
}

export interface Board {
  /** The one truck to act on now (enlarged card with the 56 px CTA), or null. */
  next: BoardItem | null;
  late: BoardItem[];
  now: BoardItem[];
  later: BoardItem[];
  undated: BoardItem[];
  received: BoardItem[];
  summary: { total: number; received: number; late: number };
}

/** A truck is "late" this long after its expected time (RCV-13: window end + 30 min). */
export const LATE_GRACE_MS = 30 * 60_000;
/** "עכשיו / הבא": a not-started truck due within this window counts as now. */
export const NOW_WINDOW_MS = 90 * 60_000;

export function truckState(e: Pick<BoardExpectation, 'receiptStatus'>): TruckState {
  if (e.receiptStatus === 'completed') return 'received';
  // A rejected receipt (the truck was turned away) is closed too — never "late".
  if (e.receiptStatus === 'partial' || e.receiptStatus === 'rejected') return 'receivedPartial';
  if (e.receiptStatus === 'pending') return 'inProgress';
  return 'notStarted';
}

/** The calendar day on the restaurant's wall clock (Israel, like the rest of the web app). */
function localDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function isClosed(state: TruckState): boolean {
  return state === 'received' || state === 'receivedPartial';
}

const byTime = (a: BoardItem, b: BoardItem) => Date.parse(a.expectedAt) - Date.parse(b.expectedAt);

/** The wall-clock HH:MM of an instant in Israel. */
function localHm(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/**
 * Past its delivery window (+ grace)? A PO with a day but no hour is stored at the
 * day's local 00:00 (deriveExpectedDelivery / the wizard's date): its window is the
 * whole day, so it is never late from the board's own clock — only once the day is
 * over (the server's `late`, a past-day PO still not received). Pilot fix: a PO
 * dated today used to show "באיחור" from 00:30.
 */
export function isOverdue(r: Pick<BoardExpectation, 'expectedAt' | 'hasDeliveryDate'>, now: Date): boolean {
  if (!r.hasDeliveryDate) return false;
  const expected = new Date(r.expectedAt);
  if (localHm(expected) === '00:00') return false;
  return expected.getTime() + LATE_GRACE_MS < now.getTime();
}

export function buildBoard(rows: readonly BoardExpectation[], now: Date = new Date()): Board {
  const items: BoardItem[] = rows.map((r) => {
    const state = truckState(r);
    const overdue = isOverdue(r, now);
    // An open receipt is being received — not late, even past its window (in a past day it is).
    const isLate = !isClosed(state) && (r.late || (state === 'notStarted' && overdue));
    return { ...r, state, isLate };
  });

  // "Received" is today's: a receipt closed on an earlier day (an undated PO listed for
  // its 14-day lookback) is history, not part of today's board.
  const today = localDay(now);
  const received = items
    .filter((i) => isClosed(i.state) && localDay(new Date(i.closedAt ?? i.expectedAt)) === today)
    .sort((a, b) => Date.parse(b.closedAt ?? b.expectedAt) - Date.parse(a.closedAt ?? a.expectedAt));
  const open = items.filter((i) => !isClosed(i.state));
  const late = open.filter((i) => i.isLate).sort(byTime);
  const undated = open.filter((i) => !i.isLate && !i.hasDeliveryDate);
  const dated = open.filter((i) => !i.isLate && i.hasDeliveryDate).sort(byTime);
  const inProgress = dated.filter((i) => i.state === 'inProgress');
  const upcoming = dated.filter((i) => i.state === 'notStarted');

  // The next action: finish what is open, then the oldest late truck, then the next one due.
  const next = inProgress[0] ?? late[0] ?? upcoming[0] ?? undated.find((i) => i.state === 'inProgress') ?? undated[0] ?? null;
  const without = (list: BoardItem[]) => list.filter((i) => i !== next);

  const soon = now.getTime() + NOW_WINDOW_MS;
  const nowGroup = dated.filter((i) => i.state === 'inProgress' || Date.parse(i.expectedAt) <= soon);
  const laterGroup = dated.filter((i) => !nowGroup.includes(i));

  return {
    next,
    late: without(late),
    now: without(nowGroup),
    later: without(laterGroup),
    undated: without(undated),
    received,
    summary: {
      // Today's trucks (+ the late ones carried over) and whatever was received today;
      // an open undated PO is not a "delivery today". received ≤ total by construction.
      total: open.filter((i) => i.hasDeliveryDate).length + received.length,
      received: received.length,
      late: late.length,
    },
  };
}

/** Where a truck's card leads: the wizard while open, the read-only view once closed. */
export function truckHref(item: Pick<BoardItem, 'poId' | 'state'>): string {
  return isClosed(item.state) ? `/dashboard/receiving?receipt=${item.poId}` : `/dashboard/receiving/${item.poId}`;
}
