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
  if (e.receiptStatus === 'partial') return 'receivedPartial';
  if (e.receiptStatus === 'pending') return 'inProgress';
  return 'notStarted';
}

export function isClosed(state: TruckState): boolean {
  return state === 'received' || state === 'receivedPartial';
}

const byTime = (a: BoardItem, b: BoardItem) => Date.parse(a.expectedAt) - Date.parse(b.expectedAt);

export function buildBoard(rows: readonly BoardExpectation[], now: Date = new Date()): Board {
  const items: BoardItem[] = rows.map((r) => {
    const state = truckState(r);
    const overdue = r.hasDeliveryDate && Date.parse(r.expectedAt) + LATE_GRACE_MS < now.getTime();
    // An open receipt is being received — not late, even past its window (in a past day it is).
    const isLate = !isClosed(state) && (r.late || (state === 'notStarted' && overdue));
    return { ...r, state, isLate };
  });

  const received = items.filter((i) => isClosed(i.state)).sort((a, b) => Date.parse(b.closedAt ?? b.expectedAt) - Date.parse(a.closedAt ?? a.expectedAt));
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
      // Today's trucks + the late ones carried over; undated POs are not "deliveries today".
      total: items.filter((i) => i.hasDeliveryDate).length,
      received: received.length,
      late: late.length,
    },
  };
}

/** Where a truck's card leads: the wizard while open, the read-only view once closed. */
export function truckHref(item: Pick<BoardItem, 'poId' | 'state'>): string {
  return isClosed(item.state) ? `/dashboard/receiving?receipt=${item.poId}` : `/dashboard/receiving/${item.poId}`;
}
