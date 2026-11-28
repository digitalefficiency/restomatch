/**
 * Desk keyboard map (RUBRIC R-9, lens-exec-desktop §3.9). Keys are bound by
 * `KeyboardEvent.code`, the physical key, so they work on a Hebrew layout
 * (ח = KeyJ, ל = KeyK, ס = KeyX). The handlers that use this sit on the list
 * element, so the keys only fire while the list has focus (WCAG 2.1.4), and
 * never while the user is typing.
 */

export type DeskKey = 'next' | 'prev' | 'peek' | 'open' | 'openTab' | 'select' | 'escape';

export interface KeyLike {
  code: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** A held key's auto-repeat (KeyboardEvent.repeat): read by deskActionOf only. */
  repeat?: boolean;
  target?: EventTarget | null;
}

export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; isContentEditable?: boolean; type?: string };
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  // A checkbox inside a row is not "typing": J/K still move from it.
  return !['checkbox', 'radio', 'button', 'submit'].includes((el.type ?? 'text').toLowerCase());
}

export function deskKeyOf(e: KeyLike): DeskKey | null {
  if (isTypingTarget(e.target)) return null;
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') return mod ? 'openTab' : 'open';
  if (mod) return null;
  switch (e.code) {
    case 'KeyJ':
    case 'ArrowDown':
      return 'next';
    case 'KeyK':
    case 'ArrowUp':
      return 'prev';
    case 'Space':
      return 'peek';
    case 'KeyX':
      return 'select';
    case 'Escape':
      return 'escape';
    default:
      return null;
  }
}

/** The next index for a J/K move, clamped to the list (no wrap: the end is the end). */
export function moveIndex(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.min(length - 1, Math.max(0, current + delta));
}

/* ───────────────────────── DS3-04 · the approvals desk's decision keys ───────────────────────── */

export type DeskAction =
  | 'next'
  | 'prev'
  | 'cellLeft'
  | 'cellRight'
  | 'claim'
  | 'pay'
  | 'escalate'
  | 'undo'
  | 'select'
  | 'open'
  | 'help'
  | 'escape';

export interface DeskActionOptions {
  /** The handler passes singleKeysEnabled() from '@/lib/prefs', read AT KEYDOWN (never a cached value, never a raw
   *  storage key): off → only Escape, plus ArrowUp/Down/Left/Right and Enter in the 'rows' region. */
  singleKeys: boolean;
  /** The reasons row is open: only Escape acts. */
  asking: boolean;
  /** 'rows' = the desk's queue grid; 'evidence' = the narrow / landing evidence region and, at the desk, the
   *  decision bar (arrows and Enter stay native there; X and O mean nothing). */
  region: 'rows' | 'evidence';
}

/** Bound by KeyboardEvent.code (ח = KeyJ, ל = KeyK on a Hebrew layout). Pure. Rules in order:
 *  1 typing target (isTypingTarget) → null · 2 ctrl/meta/alt → null
 *  3 shift → (code 'Slash' && singleKeys && !asking && !repeat) ? 'help' : null
 *  4 asking → code 'Escape' && !repeat ? 'escape' : null
 *  5 'Escape' → repeat ? null : 'escape'
 *  6 region 'rows': ArrowDown 'next', ArrowUp 'prev', ArrowLeft 'cellLeft', ArrowRight 'cellRight' (repeat allowed);
 *    Enter/NumpadEnter → repeat ? null : 'open'. region 'evidence': these return null.
 *  7 !singleKeys → null
 *  8 KeyJ 'next', KeyK 'prev' (repeat allowed)
 *  9 repeat → null (a held key decides once)
 * 10 Digit1/Numpad1 'claim', Digit2/Numpad2 'pay', Digit3/Numpad3 'escalate', KeyZ 'undo',
 *    KeyX 'select' (rows only), KeyO 'open' (rows only); else null. */
export function deskActionOf(e: KeyLike, o: DeskActionOptions): DeskAction | null {
  if (isTypingTarget(e.target)) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.shiftKey) return e.code === 'Slash' && o.singleKeys && !o.asking && !e.repeat ? 'help' : null;
  if (o.asking) return e.code === 'Escape' && !e.repeat ? 'escape' : null;
  if (e.code === 'Escape') return e.repeat ? null : 'escape';
  const rows = o.region === 'rows';
  switch (e.code) {
    case 'ArrowDown':
      return rows ? 'next' : null;
    case 'ArrowUp':
      return rows ? 'prev' : null;
    case 'ArrowLeft':
      return rows ? 'cellLeft' : null;
    case 'ArrowRight':
      return rows ? 'cellRight' : null;
    case 'Enter':
    case 'NumpadEnter':
      return rows && !e.repeat ? 'open' : null;
  }
  if (!o.singleKeys) return null;
  if (e.code === 'KeyJ') return 'next';
  if (e.code === 'KeyK') return 'prev';
  if (e.repeat) return null;
  switch (e.code) {
    case 'Digit1':
    case 'Numpad1':
      return 'claim';
    case 'Digit2':
    case 'Numpad2':
      return 'pay';
    case 'Digit3':
    case 'Numpad3':
      return 'escalate';
    case 'KeyZ':
      return 'undo';
    case 'KeyX':
      return rows ? 'select' : null;
    case 'KeyO':
      return rows ? 'open' : null;
    default:
      return null;
  }
}
