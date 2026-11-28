'use client';

import { deskActionOf, type DeskAction, type KeyLike } from '@/lib/components/desk/keys';
import { singleKeysEnabled } from '@/lib/prefs';
import type { DeskController, DeskMode } from './desk-types';

/** What a desk keydown handler reads (a React KeyboardEvent satisfies it). */
export interface DeskKeyEvent extends KeyLike {
  readonly target: EventTarget | null;
  /** The element the handler sits on: a key that reached it from outside (a portal) is not the region's. */
  readonly currentTarget: EventTarget | null;
  readonly defaultPrevented: boolean;
  readonly nativeEvent: { readonly isComposing?: boolean };
  preventDefault(): void;
}

export interface DeskKeysOptions {
  mode: DeskMode;
  wide: boolean;
}

/** The DOM reads the handlers need — an Element (structural, so the pure core runs in node with plain objects). */
type El = Pick<Element, 'closest' | 'querySelector' | 'getAttribute'>;

function elementOf(t: EventTarget | null): El | null {
  return t != null && typeof (t as Partial<El>).closest === 'function' ? (t as unknown as El) : null;
}

/** The key came from inside the handler's own element. React bubbles a keydown through portals along the React
 *  tree, so a sheet rendered as a portal inside the region would otherwise drive the desk. */
function fromOwnRegion(e: DeskKeyEvent): boolean {
  const own = e.currentTarget as { contains?: (node: unknown) => boolean } | null;
  return typeof own?.contains !== 'function' || own.contains(e.target);
}

/** The row id of a key's target: its summary cell, or (from the checkbox cell) the summary cell of the same row. */
function rowIdOf(target: El): string | null {
  const cell = target.closest('[data-row-id]') ?? target.closest('[role="row"]')?.querySelector('[data-row-id]') ?? null;
  return cell?.getAttribute('data-row-id') ?? null;
}

function directionOf(row: Element): string {
  if (typeof getComputedStyle === 'function') return getComputedStyle(row).direction;
  return row.closest('[dir]')?.getAttribute('dir') ?? 'ltr';
}

/** ←/→ inside a row, by the physical key: the checkbox cell sits at the row's start (the right in RTL, the left in
 *  LTR), the summary cell after it. No (enabled) checkbox → focus stays. */
function moveCell(target: El, action: 'cellLeft' | 'cellRight'): void {
  const row = target.closest('[role="row"]');
  if (!row) return;
  const toStart = (action === 'cellRight') === (directionOf(row) === 'rtl');
  if (toStart) {
    const check = row.querySelector<HTMLInputElement>('[data-row-check]');
    if (check && !check.disabled) check.focus();
  } else {
    row.querySelector<HTMLElement>('[data-row-id]')?.focus();
  }
}

/**
 * `onRowsKeyDown`'s pure core, on `[data-desk-rows]` (desk mode): acts only on a row's summary cell or checkbox.
 * The single-key preference is DS3-06's store, asked once per keydown (R1). A decision key (1 / 2 / 3) acts only on
 * the CURRENT row's cell: a key on another row's cell or checkbox (a click focuses a tabIndex −1 element) never
 * decides the current gap; J/K/↑/↓ step from the row that has focus.
 */
export function rowsKeyDown(e: DeskKeyEvent, c: DeskController, o: DeskKeysOptions): void {
  if (o.mode !== 'desk' || e.defaultPrevented || e.nativeEvent.isComposing) return;
  if (!fromOwnRegion(e) || c.escalateFor != null || c.keysOpen) return; // a sheet is open: its keys are its own
  const target = elementOf(e.target);
  if (!target || (!target.closest('[data-row-id]') && !target.closest('[data-row-check]'))) return;
  const action: DeskAction | null = deskActionOf(e, {
    singleKeys: singleKeysEnabled(),
    asking: c.asking != null,
    region: 'rows',
  });
  const id = rowIdOf(target);
  const onCurrent = id != null && id === c.current?.id;
  switch (action) {
    case 'next':
    case 'prev':
      c.move(action === 'next' ? 1 : -1, 'key', 'key', id != null && !onCurrent ? id : undefined);
      break;
    case 'cellLeft':
    case 'cellRight':
      moveCell(target, action);
      break;
    case 'claim':
      if (!onCurrent) return;
      c.claim('key', 'queue');
      break;
    case 'pay':
      if (!onCurrent) return;
      c.openReasons('key', 'queue');
      break;
    case 'escalate':
      if (!onCurrent) return;
      c.requestEscalate('queue');
      break;
    case 'undo':
      if (!c.undo || c.undo.failed) return;
      c.undoLast('key');
      break;
    case 'select':
      if (!id) return;
      c.toggleChecked(id);
      break;
    case 'open':
      // The heading of that gap, through the controller's focus chain (§5.2 {to:'heading'}).
      if (!c.focusHeading) return;
      c.focusHeading(id ?? undefined);
      break;
    case 'help':
      c.setKeysOpen(true);
      break;
    case 'escape':
      if (c.asking) c.closeReasons();
      else if (c.selection.ids.size > 0) c.clearChecked();
      else return;
      break;
    default:
      return;
  }
  e.preventDefault();
}

/**
 * `onEvidenceKeyDown`'s pure core, on `[data-desk-evidence]`: on narrow and on the landing, anywhere in the evidence
 * (arrows and Enter stay native there); at the desk (wide), every action from inside the decision bar (its caps act,
 * R15) and, elsewhere in the evidence, only undo (Z) and Escape. The evidence shows the current gap, so its keys act
 * on it. The single-key preference is asked once per keydown (R1).
 */
export function evidenceKeyDown(e: DeskKeyEvent, c: DeskController, o: DeskKeysOptions): void {
  if (e.defaultPrevented || e.nativeEvent.isComposing) return;
  if (!fromOwnRegion(e) || c.escalateFor != null || c.keysOpen) return; // a sheet is open: its keys are its own
  const target = elementOf(e.target);
  const action: DeskAction | null = deskActionOf(e, {
    singleKeys: singleKeysEnabled(),
    asking: c.asking != null,
    region: 'evidence',
  });
  if (!action) return;
  const deskWide = o.mode === 'desk' && o.wide;
  const onBar = target?.closest('[data-testid="decision-bar"]') != null;
  if (deskWide && !onBar && action !== 'undo' && action !== 'escape') return;
  switch (action) {
    case 'next':
    case 'prev':
      c.move(action === 'next' ? 1 : -1, 'key', 'key');
      break;
    case 'claim':
      c.claim('key', 'bar');
      break;
    case 'pay':
      c.openReasons('key', 'bar');
      break;
    case 'escalate':
      c.requestEscalate('bar');
      break;
    case 'undo':
      if (!c.undo || c.undo.failed) return;
      c.undoLast('key');
      break;
    case 'help':
      c.setKeysOpen(true);
      break;
    case 'escape':
      if (c.asking) c.closeReasons();
      else if (deskWide) c.focusQueue();
      else return;
      break;
    default:
      return; // cellLeft / cellRight / select / open never come from the evidence region
  }
  e.preventDefault();
}

/**
 * The desk's keys (DS3-04 spec §2.7, §5.2). `deskActionOf` (S1, pure) maps a keydown; `rowsKeyDown` /
 * `evidenceKeyDown` wire the action to the controller. The single-key preference is DS3-06's store:
 * `singleKeysEnabled()` is asked inside every handler, at every keydown — never cached in a ref or state, never a raw
 * storage key or cookie (R1).
 *
 * - `onRowsKeyDown` on `[data-desk-rows]` (desk mode): acts only on a row's summary cell or checkbox.
 * - `onEvidenceKeyDown` on `[data-desk-evidence]`: on narrow and on the landing, anywhere in the evidence; at the desk
 *   (wide), every action from inside the decision bar and, elsewhere in the evidence, only undo (Z) and Escape.
 * Every handled action calls `preventDefault()`. Neither acts on a key from outside its own element or while a sheet
 * (escalate, keys help) is open.
 */
export function useDeskKeys(
  c: DeskController,
  o: DeskKeysOptions,
): {
  onRowsKeyDown: React.KeyboardEventHandler<HTMLElement>;
  onEvidenceKeyDown: React.KeyboardEventHandler<HTMLElement>;
} {
  return {
    onRowsKeyDown: (e) => rowsKeyDown(e, c, o),
    onEvidenceKeyDown: (e) => evidenceKeyDown(e, c, o),
  };
}
