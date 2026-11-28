import type { Locale } from '@/lib/i18n/config';
import type { GapRole, GapSeverity, InvoiceListRow, InvoiceState, PlaceId, PlaceSummary, QueueRow } from './types';

/**
 * INV-00 · the places of an invoice in the month (SPEC §3.4), their order for the viewer, the
 * aliases of the old `view` tab ids, the order of rows, and the list the keys `[` and `]`
 * walk. One module, used by the invoices list and by the invoice screen. The place of each
 * row and the sums of each place come from the server (`invoices.list` rows' `place`, its
 * `places[]`); this module only orders and resolves them. Pure.
 */

/** Every place id, in the server's order (`packages/api/src/invoices/holding.ts` PLACE_IDS). */
export const PLACE_IDS = [
  'r-owner',
  'r-manager',
  'r-bookkeeper',
  'wait',
  'dup',
  'alloc',
  'ok',
  'paid',
] as const satisfies ReadonlyArray<PlaceId>;
// Compile-time parity with the server's union: a new place id fails here until it is listed.
type MissingPlace = Exclude<PlaceId, (typeof PLACE_IDS)[number]>;
const placesComplete: MissingPlace extends never ? true : never = true;
void placesComplete;

/** Today's register tab ids, still accepted in `?view=` (old links keep working). */
export const OLD_VIEWS = ['review', 'lines', 'awaiting', 'matched', 'held', 'paid', 'noAllocation', 'intake'] as const;
export type OldView = (typeof OLD_VIEWS)[number];

/** What `?view=` may hold: a place id or an old tab id. */
export type ViewParam = PlaceId | OldView;

/** The role place of a role: 'r-owner', 'r-manager', 'r-bookkeeper'. */
export function rolePlace(role: GapRole): PlaceId {
  return `r-${role}`;
}

/** The role of a role place, or null for any other place. */
export function roleOfPlace(id: PlaceId): GapRole | null {
  return id === 'r-owner' ? 'owner' : id === 'r-manager' ? 'manager' : id === 'r-bookkeeper' ? 'bookkeeper' : null;
}

const OTHER_ROLES: Readonly<Record<GapRole, readonly GapRole[]>> = {
  owner: ['manager', 'bookkeeper'],
  manager: ['owner', 'bookkeeper'],
  bookkeeper: ['owner', 'manager'],
};

/**
 * The order of the places for the viewer: the viewer's own ("אצלכם"); the other roles'
 * (owner, manager, bookkeeper); waiting; the held duplicate's; missing an allocation number;
 * no open gap; paid.
 */
export function placeOrder(viewer: GapRole): PlaceId[] {
  return [
    rolePlace(viewer),
    ...OTHER_ROLES[viewer].map(rolePlace),
    'wait',
    'dup',
    'alloc',
    'ok',
    'paid',
  ];
}

/**
 * The places a screen draws, in the viewer's order: only a place that holds an invoice (SPEC
 * §3.4: a role's card, "כפולה אפשרית", "חסר מספר הקצאה", and "שולמו" only when the month has a
 * paid invoice). "כל החודש" is the screen's own card, always drawn.
 */
export function placesToDraw(places: readonly PlaceSummary[], viewer: GapRole): PlaceSummary[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  return placeOrder(viewer)
    .map((id) => byId.get(id))
    .filter((p): p is PlaceSummary => p !== undefined && p.count > 0);
}

/**
 * A place's name (SPEC §3.4): a role place through `withWhom` ("אצלכם" for the viewer's own,
 * "אצל הבעלים", …), the others "ממתינות לשיוך", "כפולה אפשרית" (the frozen
 * `state.held_duplicate`), "חסר מספר הקצאה", "בלי פער פתוח", "שולמו".
 */
export function placeName(id: PlaceId, viewer: GapRole, locale: Locale): string {
  void id;
  void viewer;
  void locale;
  return ''; // slice 4
}

/** The dot before a place's name: red when one of its gaps blocks payment, amber when it waits for a person, else none. */
export function placeDot(place: Pick<PlaceSummary, 'id' | 'worstSeverity' | 'count'>): Exclude<GapSeverity, 'info'> | null {
  void place;
  return null; // slice 4
}

/** `?view=` as a place id or an old tab id; anything else is null (the whole month). */
export function parseView(view: string | null | undefined): ViewParam | null {
  if (!view) return null;
  return (PLACE_IDS as readonly string[]).includes(view) || (OLD_VIEWS as readonly string[]).includes(view)
    ? (view as ViewParam)
    : null;
}

/**
 * The place cards a view stands for (the pressed cards); null = the whole month. An old tab id
 * resolves to the places it covered (`review` → the role places, `awaiting` → `wait`,
 * `matched` → `ok` and `alloc`, `held` → `dup`, `paid` → `paid`); `noAllocation`, `lines` and
 * `intake` stand for no card (see `inView`).
 */
export function viewPlaces(view: ViewParam | null): PlaceId[] | null {
  void view;
  return null; // slice 4
}

/** What a row needs for the views and the order. */
export type PlaceRowInput = Pick<
  InvoiceListRow,
  'id' | 'place' | 'tab' | 'state' | 'invoiceDate' | 'holding' | 'hasAllocation' | 'allocationMissing'
>;

/**
 * Is the row in the view? A place id matches its place. An old tab id keeps the set it had:
 * `review`, `awaiting`, `matched`, `held` and `paid` their places (`viewPlaces`);
 * `noAllocation` its old set, every invoice with no number that is not being read
 * (`!hasAllocation && state !== 'in_ocr'`, the set `counts.noAllocation` counts); `lines` and
 * `intake` match no list row, so `walk` falls back to the whole month.
 */
export function inView(row: PlaceRowInput, view: ViewParam | null): boolean {
  void row;
  void view;
  return true; // slice 4
}

/**
 * The order of rows (not a sort the person picks): the viewer's gaps, then others' (blocking
 * before warning, the longest wait first); then waiting; then a copy held as a duplicate; then
 * missing an allocation number; then no open gap; then paid; newest first inside each.
 */
export function orderRows<R extends PlaceRowInput>(rows: readonly R[], viewer: GapRole): R[] {
  void viewer;
  return [...rows]; // slice 4
}

/**
 * The order of gaps (the invoice screen's cards, the desk's rows inside a group): the viewer's
 * own routing first (`waitingOn` equal to the viewer's role), then blocking before warning,
 * then the longest wait (`since`), then the oldest row, then the id: the server's `byUrgency`
 * (`packages/api/src/invoices/holding.ts`), so the first card is the server's leading gap.
 */
export function compareGaps(
  a: Pick<QueueRow, 'id' | 'severity' | 'since' | 'createdAt'>,
  b: Pick<QueueRow, 'id' | 'severity' | 'since' | 'createdAt'>,
): number {
  void a;
  void b;
  return 0; // slice 4
}

/** Gaps in the shared order for `viewer` (own routing first, then `compareGaps`). */
export function orderGaps<R extends Pick<QueueRow, 'id' | 'severity' | 'since' | 'createdAt' | 'waitingOn'>>(
  rows: readonly R[],
  viewer: GapRole,
): R[] {
  void viewer;
  return [...rows]; // slice 4
}

/**
 * The first gap the viewer may decide across the given rows (the list's "להחלטה"): rows whose
 * `holding.canAct`, own routing first, then the leading gap's level and wait; its
 * `holding.decideGapId`. Null when the viewer may decide none.
 */
export function firstToDecide(rows: readonly PlaceRowInput[], viewer: GapRole): { invoiceId: string; gapId: string } | null {
  void rows;
  void viewer;
  return null; // slice 4
}

/** Where an invoice stands among the rows the keys walk, and its neighbours. */
export interface WalkPosition {
  /** 0-based index of the current invoice in the walked list, or -1. */
  index: number;
  /** How many invoices the keys walk. */
  total: number;
  prevId: string | null;
  nextId: string | null;
}

/**
 * The list `[` and `]` walk on the invoice screen: the rows of the view the person came from,
 * in the list's order; the whole month when the current invoice is not in that view.
 */
export function walk(rows: readonly PlaceRowInput[], viewer: GapRole, view: ViewParam | null, currentId: string): WalkPosition {
  void rows;
  void viewer;
  void view;
  void currentId;
  return { index: -1, total: 0, prevId: null, nextId: null }; // slice 4
}

/**
 * The states a place can hold (documentation, and a check in the tests). A role place holds any
 * state but paid and the waiting ones: an open gap of the desk's row set stays with its role
 * even when the canonical state does not count it as a leak.
 */
export const PLACE_STATES: Readonly<Record<PlaceId, readonly InvoiceState[]>> = {
  'r-owner': ['flagged_open', 'held_duplicate', 'clean', 'claim_open', 'approved'],
  'r-manager': ['flagged_open', 'held_duplicate', 'clean', 'claim_open', 'approved'],
  'r-bookkeeper': ['flagged_open', 'held_duplicate', 'clean', 'claim_open', 'approved'],
  wait: ['in_ocr', 'awaiting_count', 'awaiting_link'],
  dup: ['held_duplicate'],
  alloc: ['clean', 'claim_open', 'approved'],
  ok: ['clean', 'claim_open', 'approved'],
  paid: ['paid'],
};
