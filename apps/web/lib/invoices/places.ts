import type { GapRole, GapSeverity, InvoiceListRow, InvoiceState, PlaceId, PlaceSummary } from './types';

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

/** The place cards a view stands for (the pressed cards); null = the whole month. Old tab ids resolve to the places they covered. */
export function viewPlaces(view: ViewParam | null): PlaceId[] | null {
  void view;
  return null; // slice 4
}

/** What a row needs for the views and the order. */
export type PlaceRowInput = Pick<InvoiceListRow, 'id' | 'place' | 'tab' | 'state' | 'invoiceDate' | 'holding'>;

/** Is the row in the view? A place id matches its place; an old tab id keeps its old meaning (`tab`). */
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

/** The states a place can hold (documentation, and a check in the tests). */
export const PLACE_STATES: Readonly<Record<PlaceId, readonly InvoiceState[]>> = {
  'r-owner': ['flagged_open', 'held_duplicate'],
  'r-manager': ['flagged_open', 'held_duplicate'],
  'r-bookkeeper': ['flagged_open', 'held_duplicate'],
  wait: ['in_ocr', 'awaiting_count', 'awaiting_link'],
  dup: ['held_duplicate'],
  alloc: ['clean', 'claim_open', 'approved'],
  ok: ['clean', 'claim_open', 'approved'],
  paid: ['paid'],
};
