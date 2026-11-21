'use client';

import { deskActionOf, type DeskAction } from '@/lib/components/desk/keys';
import { singleKeysEnabled } from '@/lib/prefs';
import type { DeskController, DeskMode } from './desk-types';

/** The row id of a key's target: its summary cell, or (from the checkbox cell) the summary cell of the same row. */
function rowIdOf(target: Element): string | null {
  const cell =
    target.closest<HTMLElement>('[data-row-id]') ??
    target.closest('[role="row"]')?.querySelector<HTMLElement>('[data-row-id]') ??
    null;
  return cell?.dataset.rowId ?? null;
}

/** ←/→ inside a row, by the physical key: the checkbox cell sits at the row's start (the right in RTL, the left in
 *  LTR), the summary cell after it. No (enabled) checkbox → focus stays. */
function moveCell(target: Element, action: 'cellLeft' | 'cellRight'): void {
  const row = target.closest<HTMLElement>('[role="row"]');
  if (!row) return;
  const rtl = getComputedStyle(row).direction === 'rtl';
  const toStart = (action === 'cellRight') === rtl;
  if (toStart) {
    const check = row.querySelector<HTMLInputElement>('[data-row-check]');
    if (check && !check.disabled) check.focus();
  } else {
    row.querySelector<HTMLElement>('[data-row-id]')?.focus();
  }
}

/** Enter / O on a row cell: the evidence heading of that gap (§5.3). A row that is not current is selected first; its
 *  heading renders on the next frame. */
function openEvidence(c: DeskController, target: Element): void {
  const id = rowIdOf(target);
  const desk = target.closest('[data-desk]') ?? document;
  const focusHeading = () => desk.querySelector<HTMLElement>('[data-desk-heading]')?.focus();
  if (id && c.current?.id !== id) {
    c.select(id);
    requestAnimationFrame(focusHeading);
  } else {
    focusHeading();
  }
}

/**
 * The desk's keys (DS3-04 spec §2.7, §5.2). `deskActionOf` (S1, pure) maps a keydown; this wires the action to the
 * controller. The single-key preference is DS3-06's store: `singleKeysEnabled()` is asked inside every handler, at
 * every keydown — never cached in a ref or state, never a raw storage key or cookie (R1).
 *
 * - `onRowsKeyDown` on `[data-desk-rows]` (desk mode): acts only on a row's summary cell or checkbox.
 * - `onEvidenceKeyDown` on `[data-desk-evidence]`: on narrow and on the landing, anywhere in the evidence (arrows and
 *   Enter stay native there); at the desk (wide), every action from inside the decision bar (its caps act, R15) and,
 *   elsewhere in the evidence, only undo (Z) and Escape.
 * Every handled action calls `preventDefault()`.
 */
export function useDeskKeys(
  c: DeskController,
  o: { mode: DeskMode; wide: boolean },
): {
  onRowsKeyDown: React.KeyboardEventHandler<HTMLElement>;
  onEvidenceKeyDown: React.KeyboardEventHandler<HTMLElement>;
} {
  const deskWide = o.mode === 'desk' && o.wide;

  const onRowsKeyDown: React.KeyboardEventHandler<HTMLElement> = (e) => {
    if (o.mode !== 'desk' || e.defaultPrevented || e.nativeEvent.isComposing) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || (!target.closest('[data-row-id]') && !target.closest('[data-row-check]'))) return;
    const action: DeskAction | null = deskActionOf(e, {
      singleKeys: singleKeysEnabled(),
      asking: c.asking != null,
      region: 'rows',
    });
    switch (action) {
      case 'next':
      case 'prev':
        c.move(action === 'next' ? 1 : -1, 'key', 'key');
        break;
      case 'cellLeft':
      case 'cellRight':
        moveCell(target, action);
        break;
      case 'claim':
        c.claim('key', 'queue');
        break;
      case 'pay':
        c.openReasons('key', 'queue');
        break;
      case 'escalate':
        c.requestEscalate('queue');
        break;
      case 'undo':
        if (!c.undo || c.undo.failed) return;
        c.undoLast('key');
        break;
      case 'select': {
        const id = rowIdOf(target);
        if (!id) return;
        c.toggleChecked(id);
        break;
      }
      case 'open':
        openEvidence(c, target);
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
  };

  const onEvidenceKeyDown: React.KeyboardEventHandler<HTMLElement> = (e) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    const target = e.target instanceof Element ? e.target : null;
    const action: DeskAction | null = deskActionOf(e, {
      singleKeys: singleKeysEnabled(),
      asking: c.asking != null,
      region: 'evidence',
    });
    if (!action) return;
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
  };

  return { onRowsKeyDown, onEvidenceKeyDown };
}
