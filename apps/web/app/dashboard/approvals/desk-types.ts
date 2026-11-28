/**
 * The approvals desk's controller ↔ view types (DS3-04 spec §2.5). Data and view stay apart: the controller
 * (`use-desk.ts` + `use-gap-document.ts`) hands the views exactly these shapes, so a role view stacked on the desk
 * later replaces `desk-view.tsx` and keeps the controller. Types only: nothing here runs.
 */
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api'; // type-only (G-16 client-api-value-import safe)
import type { WaiveReason } from './vocab';
import type { Tier } from './desk-facts';

export type QueueItem = inferRouterOutputs<AppRouter>['approvals']['myQueue'][number];
export type QueueSummary = inferRouterOutputs<AppRouter>['approvals']['queueSummary'];
/** The view filters the server page was rendered with (URL → myQueue input). Moved from list.tsx, unchanged. */
export interface QueueFilters {
  types?: QueueItem['type'][];
  severities?: QueueItem['severity'][];
  supplierIds?: string[];
  /** The notification landing: one invoice's rows (`?invoice=<id>`). */
  invoiceIds?: string[];
}
export type DeskMode = 'desk' | 'single'; // single = /approvals/[invoiceId]: the narrow view at every width
export type DeskDensity = 'regular' | 'compact';
/** pointer click (event.detail ≥ 1) · keyboard-activated button (detail === 0) · a desk shortcut key. */
export type How = 'pointer' | 'keyboard' | 'key';
/** Where a decision or the reasons row started: the queue (keys 1/2/3 in rows) or the decision bar. */
export type Origin = 'queue' | 'bar';
export type RowState = 'open' | 'done' | 'elsewhere';
export type Motion = 'next' | 'prev' | null; // set only by pointer actions (§4.10)

export interface QueueRowView {
  row: QueueItem;
  state: RowState;
  /** done: the decision's done label; elsewhere: resolutionLabel(status). Null when open. */
  result: string | null;
  current: boolean;
  checked: boolean;
  /** The one summary cell with tabIndex 0 across every tier grid. */
  roving: boolean;
}
export type RowNote =
  | { kind: 'amountChanged'; amountAgorot: number } // desk.amountChanged {amount, basis} · role="status"
  | { kind: 'escalatedToYou' } // desk.escalatedToYou · role="status"
  | { kind: 'error' } // card.error + card.retry · role="alert"
  | { kind: 'forbidden' } // card.forbidden · role="alert", no retry
  | { kind: 'batchError'; text: string }; // R11: a refused "approve the whole invoice" (desk.batchConflict |
//   batchError | batchUnknown) · role="alert", no retry button
export interface UndoView {
  text: string;
  sentAt: number;
  capAt: number;
  instant: boolean;
  failed: boolean;
  busy: boolean;
  ids: string[];
  bulk: boolean;
}
/** Every intent ends in the shared fallback chain when its target is missing or disabled (R10, §5.3):
 *  → the current row's cell (desk, wide) → [data-desk-empty] → [data-desk-heading] → `#main-content h1`
 *  (PAGE_H1_SELECTOR, tabindex -1 set if absent, as RouteFocus does). Focus never lands on body. */
export type FocusIntent =
  | { to: 'row'; id: string; onlyIfLost?: boolean } // desk: [data-row-id] cell; narrow/single → 'primary'
  | { to: 'primary' } // [data-desk-primary] → first enabled bar button → chain
  | { to: 'heading' } // [data-desk-heading] → chain
  | { to: 'firstChip' } // first [data-reason-chip]
  | { to: 'reject' } // [data-testid="decide-reject"]
  | { to: 'hide' } // [data-testid="row-hide"]
  | { to: 'empty' } // [data-desk-empty] → chain
  | { to: 'stay' } // keep focus if still connected inside [data-desk]; else chain
  | { to: 'navFallback'; from: 'prev' | 'next' }; // the pressed nav button if enabled, else the other, else chain

export interface DeskController {
  mode: DeskMode;
  rows: QueueRowView[]; // loaded, server order: open + done + elsewhere
  tiers: Array<{ tier: Tier; rows: QueueRowView[]; open: number | null }>;
  live: QueueItem[]; // open rows only
  current: QueueItem | null;
  currentState: RowState | null;
  next: QueueItem | null; // where a decision on current advances (prefetch, announcer)
  position: { index: number; total: number } | null; // 1-based in live; total = max(summary.count, live.length)
  canPrev: boolean;
  canNext: boolean; // false at the last live row unless hasMore
  summary: QueueSummary; // optimistic server totals
  hasMore: boolean;
  loadingMore: boolean;
  /** No current gap while the next page loads (the last loaded gap was decided or hidden and the server holds more):
   *  the queue is not empty, so the evidence shows loading, not DeskEmpty's "הכול מטופל". Optional for plain-object
   *  controllers; useDesk always sets it. */
  loadingNext?: boolean;
  siblings: QueueItem[]; // live rows of current's invoice (incl. current)
  note: RowNote | null;
  elsewhereText: string | null;
  /** The gap whose reasons row is open (R9): the row renders only while asking.id === current.id; select/move/nav
   *  close it first; pay() decides asking.id and nothing else. */
  asking: { id: string; origin: Origin } | null;
  undo: UndoView | null;
  announcement: string;
  selection: {
    ids: ReadonlySet<string>;
    rows: QueueItem[];
    sumAgorot: number;
    disabled: boolean;
    reason: string | null;
    note: string | null;
    busy: boolean;
  };
  escalateFor: { row: QueueItem; origin: Origin } | null;
  keysOpen: boolean;
  focus: FocusIntent | null;
  motion: Motion;

  select(id: string): void; // row click / focus adoption; replaces ?sel=; closes asking
  /** Closes asking first. `from` (optional): step from that row instead of the current one — a J/K pressed on another
   *  row's cell or checkbox moves from where focus is. */
  move(delta: 1 | -1, how: How, via: 'key' | 'nav', from?: string): void;
  /** The variant's primary: claim / hold copy / review; on a `link` row it opens /dashboard/invoices/{invoiceId}
   *  (router.push, no decision — key 1 does what it does today, P11a). Ignored while decisionBlockOf(current). */
  claim(how: How, origin: Origin): void;
  openReasons(how: How, origin: Origin): void; // ignored while decisionBlockOf(current) (P13)
  closeReasons(): void;
  pay(code: WaiveReason, reason: string, how: How): void; // decides asking.id only; no-op when not asking
  requestEscalate(origin: Origin): void;
  /** The Sheet's send. `how` (optional, default 'keyboard'): a pointer send moves focus to the next row (§5.3). */
  escalate(note: string | undefined, how?: How): void;
  closeEscalate(): void;
  undoLast(how: How): void;
  expireUndo(info: { hadFocus: boolean }): void;
  toggleChecked(id: string): void;
  clearChecked(): void;
  /** `how` (optional, default 'pointer'): the bulk undo toast slides in only after a pointer approve (§4.10). */
  approveChecked(how?: How): void;
  /** `how` as approveChecked. */
  approveInvoice(invoiceId: string, how?: How): void;
  hideElsewhere(): void;
  /** "נסו שוב". `how` (optional, default 'keyboard'): a pointer retry moves focus to the next row (§5.3). */
  retry(how?: How): void;
  loadMore(): void;
  setKeysOpen(open: boolean): void;
  focusQueue(): void; // emits { to:'row', id: current.id }
  /** Enter / O on a row cell: emits { to:'heading' } (→ the fallback chain), selecting that row first when it is open
   *  and not current. Optional for plain-object controllers; useDesk always sets it. */
  focusHeading?(id?: string): void;
  consumeFocus(): void;
}
/** `wide` = useMediaQuery('(min-width: 1280px)', true), computed once in list.tsx: the controller clears the bulk
 *  selection when it turns false (no BatchBar below 1280, R13/P3). */
export interface DeskControllerInput {
  initial: QueueItem[];
  initialSummary: QueueSummary;
  filters: QueueFilters;
  viewerRole: string | null;
  mode: DeskMode;
  wide: boolean;
}

/** Exact values (R8): every NUMERIC string goes through units4(); rendered with qtyText / <Money value={toNumber4()}> /
 *  <Money agorot={Number(totalAgorot)}> only. */
export interface PaperLine {
  id: string;
  name: string;
  qty4: bigint | null;
  unit: string | null;
  unitPrice4: bigint | null;
  totalAgorot: bigint | null;
  hit: boolean;
}
export type GapDocument =
  | { status: 'none' } // no invoiceId
  | { status: 'loading'; own: PaperLine | null } // the row's own line, from the row
  | { status: 'error'; own: PaperLine | null; retry: () => void }
  | {
      status: 'ready';
      lines: PaperLine[];
      more: number;
      hasImage: boolean;
      grId: string | null;
      grReceivedAt: Date | null;
      duplicateOf: string | null;
    };

export interface DeskViewProps {
  c: DeskController;
  doc: GapDocument;
  mode: DeskMode;
  density: DeskDensity;
  /** usePrefs().singleKeys — what is DRAWN (caps, legend, aria-keyshortcuts, #desk-keys-sr); handlers ask the store. */
  singleKeys: boolean;
  wide: boolean;
  filtered: boolean;
  filteredNote?: string;
  viewerRole: string | null;
}
