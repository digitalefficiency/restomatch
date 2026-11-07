/**
 * The one shortcut registry (W3-04). Every app-wide shortcut is listed here,
 * and the `?` cheat sheet renders from `HOTKEYS`, so a shortcut that is not in
 * this file does not exist. Keys are bound by `KeyboardEvent.code` (the
 * physical key), so they work on a Hebrew layout: ⌘K is `KeyK` whether the
 * key types k or ל. Pure, no React; the palette hook wires it to `window`.
 *
 * Rules:
 * - nothing fires while the user types (input / textarea / select /
 *   contenteditable), except Ctrl/⌘K, which opens the palette from anywhere;
 * - a G-chord is G then a letter within `CHORD_MS`;
 * - `?` yields on approvals routes, where the W2-04 desk keymap owns `?`;
 * - Alt held alone shows the hint badges; releasing it hides them.
 * Desk list keys (J/K/X/Enter…) stay in `components/desk/keys.ts`; they are
 * scoped to a focused list and do not collide with these.
 */
import { isTypingTarget, type KeyLike } from './components/desk/keys';

export const CHORD_MS = 1_000;

export type HotkeyGroup = 'general' | 'go';

export interface HotkeyDef {
  id: string;
  group: HotkeyGroup;
  /** Display keys, in order (a chord lists both). `Mod` renders ⌘ on Apple, Ctrl elsewhere. */
  keys: readonly string[];
  label: { he: string; en: string };
  /** G-chord second key (`KeyboardEvent.code`) and its destination. */
  chord?: { code: string; href: string };
}

/** G-chord destinations. Role visibility is applied by the caller (`canSeeRoute`). */
const GO: ReadonlyArray<[letter: string, href: string, he: string, en: string]> = [
  ['H', '/dashboard', 'בית', 'Home'],
  ['A', '/dashboard/approvals', 'אישורים', 'Approvals'],
  ['I', '/dashboard/invoices', 'חשבוניות', 'Invoices'],
  ['L', '/dashboard/leaks', 'דליפה', 'Leak'],
  ['C', '/dashboard/recovery', 'דרישות זיכוי', 'Credit claims'],
  ['S', '/dashboard/suppliers', 'ספקים', 'Suppliers'],
  ['O', '/dashboard/orders', 'הזמנות', 'Orders'],
  ['R', '/dashboard/receiving', 'קבלת סחורה', 'Receiving'],
  ['M', '/dashboard/recipes', 'מתכונים', 'Recipes'],
];

export const HOTKEYS: readonly HotkeyDef[] = [
  {
    id: 'palette',
    group: 'general',
    keys: ['Mod', 'K'],
    label: { he: 'חיפוש ופקודות', en: 'Search and commands' },
  },
  { id: 'paletteSlash', group: 'general', keys: ['/'], label: { he: 'חיפוש', en: 'Search' } },
  {
    id: 'cheatSheet',
    group: 'general',
    keys: ['?'],
    label: { he: 'קיצורי מקלדת', en: 'Keyboard shortcuts' },
  },
  {
    id: 'hints',
    group: 'general',
    keys: ['Alt'],
    label: { he: 'החזקה: הצגת קיצורים', en: 'Hold: show shortcut hints' },
  },
  ...GO.map(
    ([letter, href, he, en]): HotkeyDef => ({
      id: `go.${letter.toLowerCase()}`,
      group: 'go',
      keys: ['G', letter],
      label: { he, en },
      chord: { code: `Key${letter}`, href },
    }),
  ),
];

export function chordHref(code: string): string | null {
  return HOTKEYS.find((h) => h.chord?.code === code)?.chord?.href ?? null;
}

/** Routes whose own keymap owns `?` (W2-04 approvals desk). */
export function yieldsQuestionMark(pathname: string): boolean {
  return pathname === '/dashboard/approvals' || pathname.startsWith('/dashboard/approvals/');
}

export type HotkeyAction =
  | { type: 'palette' }
  | { type: 'cheatSheet' }
  | { type: 'go'; href: string }
  | { type: 'hints'; on: boolean }
  | { type: 'chordStart' };

export interface ChordState {
  /** When G was pressed (ms), or null when no chord is pending. */
  gAt: number | null;
}

export const IDLE: ChordState = { gAt: null };

/**
 * Resolve one keydown to an action plus the next chord state. `now` is the
 * event time in ms. Returns `action: null` when the key is not ours.
 */
export function matchKeydown(
  e: KeyLike,
  state: ChordState,
  ctx: { pathname: string; now: number },
): { action: HotkeyAction | null; state: ChordState } {
  const mod = Boolean(e.ctrlKey || e.metaKey);
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyK')
    return { action: { type: 'palette' }, state: IDLE };
  if (isTypingTarget(e.target)) return { action: null, state: IDLE };
  if (e.code === 'AltLeft' || e.code === 'AltRight')
    return { action: { type: 'hints', on: true }, state };
  if (mod || e.altKey) return { action: null, state: IDLE };

  const pending = state.gAt !== null && ctx.now - state.gAt <= CHORD_MS;
  if (pending && !e.shiftKey) {
    const href = chordHref(e.code);
    return { action: href ? { type: 'go', href } : null, state: IDLE };
  }
  if (e.code === 'Slash' && e.shiftKey) {
    return {
      action: yieldsQuestionMark(ctx.pathname) ? null : { type: 'cheatSheet' },
      state: IDLE,
    };
  }
  if (e.code === 'Slash' && !e.shiftKey) return { action: { type: 'palette' }, state: IDLE };
  if (e.code === 'KeyG' && !e.shiftKey)
    return { action: { type: 'chordStart' }, state: { gAt: ctx.now } };
  return { action: null, state: IDLE };
}

/** Alt released: hide the hints. */
export function matchKeyup(e: KeyLike): HotkeyAction | null {
  return e.code === 'AltLeft' || e.code === 'AltRight' ? { type: 'hints', on: false } : null;
}

/** Display a key for the platform (`Mod` → ⌘ / Ctrl). */
export function keyLabel(key: string, apple: boolean): string {
  if (key === 'Mod') return apple ? '⌘' : 'Ctrl';
  if (key === 'Alt') return apple ? '⌥' : 'Alt';
  return key;
}
