/**
 * The one shortcut registry (W3-04; DS3-02 adds the side-menu keys of sidebar
 * SPEC §8). Every app-wide shortcut is listed here, and the `?` cheat sheet
 * renders from `HOTKEYS`, so a shortcut that is not in this file does not
 * exist. Keys are bound by `KeyboardEvent.code` (the physical key), so they
 * work on a Hebrew layout: ⌘K is `KeyK` whether the key types k or ל. Pure, no
 * React; the palette hook wires it to `window`.
 *
 * Rules:
 * - nothing fires while the user types (input / textarea / select /
 *   contenteditable), except Ctrl/⌘K, which opens the palette from anywhere;
 * - a G-chord is G then a letter within `CHORD_MS`. A pending G is resolved
 *   before `/` and `?`: on the Hebrew layout KeyQ types "/", and G Q must
 *   reach לטיפולי, never the palette;
 * - `?` yields on approvals routes, where the W2-04 desk keymap owns `?`;
 * - `[` yields on the invoice cockpit, where W2-02's `[` / `]` step through
 *   the register tab (Ctrl/⌘B still toggles the menu there);
 * - the single-key bindings (`/`, `?`, `[`, G-chords) obey the user's
 *   "קיצורים בתו אחד" switch (`singleKeys`, WCAG 2.1.4); Ctrl/⌘ combinations
 *   always stay on;
 * - Alt held alone shows the hint badges; releasing it hides them.
 * Desk list keys (J/K/X/Enter…) stay in `components/desk/keys.ts`; they are
 * scoped to a focused list and do not collide with these.
 */
import { isTypingTarget, type KeyLike } from './components/desk/keys';
import { QUEUE_HREF } from './nav/queue';

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

/**
 * G-chord destinations, in the order of sidebar SPEC §8 (H Q A I P C L O R S
 * B), then M. Role visibility is applied by the caller (`canGo`). G Q reuses
 * the shell's `QUEUE_HREF`, so the chord follows לטיפולי when it moves to its
 * own page (phase 2) and the menu's chord chip, keyed by href, keeps matching.
 */
const GO: ReadonlyArray<[letter: string, href: string, he: string, en: string]> = [
  ['H', '/dashboard', 'בית', 'Home'],
  ['Q', QUEUE_HREF, 'לטיפולי', 'My queue'],
  ['A', '/dashboard/approvals', 'אישורים', 'Approvals'],
  ['I', '/dashboard/invoices', 'חשבוניות', 'Invoices'],
  ['P', '/dashboard/approvals/pay-run', 'תשלומים', 'Payments'],
  ['C', '/dashboard/recovery', 'בקשות זיכוי', 'Credit requests'],
  ['L', '/dashboard/leaks', 'דליפה', 'Leak'],
  ['O', '/dashboard/orders', 'הזמנות', 'Orders'],
  ['R', '/dashboard/receiving', 'קבלת סחורה', 'Receiving'],
  ['S', '/dashboard/suppliers', 'ספקים', 'Suppliers'],
  ['B', '/dashboard/chain', 'רשת', 'Chain'],
  ['M', '/dashboard/recipes', 'מתכונים', 'Recipes'],
];

/** The side-menu toggle (§7.1): collapse / expand, or the overlay at 1024–1279. */
const RAIL_LABEL = { he: 'כיווץ והרחבה של התפריט', en: 'Collapse or expand the menu' };

export const HOTKEYS: readonly HotkeyDef[] = [
  {
    id: 'palette',
    group: 'general',
    keys: ['Mod', 'K'],
    label: { he: 'חיפוש ופקודות', en: 'Search and commands' },
  },
  { id: 'paletteSlash', group: 'general', keys: ['/'], label: { he: 'חיפוש', en: 'Search' } },
  { id: 'rail', group: 'general', keys: ['Mod', 'B'], label: RAIL_LABEL },
  { id: 'railBracket', group: 'general', keys: ['['], label: RAIL_LABEL },
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

/**
 * Routes whose own keymap owns `[` (W2-02 invoice cockpit, `/dashboard/invoices/<id>`:
 * `[` / `]` step through the register tab). Without the yield one press would
 * open the previous invoice and also flip, and persist, the side menu.
 */
export function yieldsBracket(pathname: string): boolean {
  return pathname.startsWith('/dashboard/invoices/');
}

export type HotkeyAction =
  | { type: 'palette' }
  | { type: 'cheatSheet' }
  | { type: 'go'; href: string }
  | { type: 'hints'; on: boolean }
  | { type: 'chordStart' }
  | { type: 'rail' };

export interface ChordState {
  /** When G was pressed (ms), or null when no chord is pending. */
  gAt: number | null;
}

export const IDLE: ChordState = { gAt: null };

/** A letter key (`KeyA`…`KeyZ`): the character it types depends on the layout. */
const LETTER_CODE = /^Key[A-Z]$/;

/**
 * `/` on any layout: the Slash key unshifted (US; on Hebrew it types "."), or
 * any non-letter key that types "/" (German Shift+7). A letter key that types
 * "/" (Hebrew KeyQ) is that letter, so it can finish a G-chord and never opens
 * the palette.
 */
function isSlash(e: KeyLike): boolean {
  if (e.code === 'Slash') return !e.shiftKey;
  return e.key === '/' && !LETTER_CODE.test(e.code);
}

/**
 * Resolve one keydown to an action plus the next chord state. `now` is the
 * event time in ms; `singleKeys: false` turns off `/`, `?`, `[` and the
 * G-chords (default on). Returns `action: null` when the key is not ours.
 */
export function matchKeydown(
  e: KeyLike,
  state: ChordState,
  ctx: { pathname: string; now: number; singleKeys?: boolean },
): { action: HotkeyAction | null; state: ChordState } {
  const mod = Boolean(e.ctrlKey || e.metaKey);
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyK')
    return { action: { type: 'palette' }, state: IDLE };
  if (isTypingTarget(e.target)) return { action: null, state: IDLE };
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyB')
    return { action: { type: 'rail' }, state: IDLE };
  if (e.code === 'AltLeft' || e.code === 'AltRight')
    return { action: { type: 'hints', on: true }, state };
  if (mod || e.altKey) return { action: null, state: IDLE };
  if (ctx.singleKeys === false) return { action: null, state: IDLE };

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
  if (isSlash(e)) return { action: { type: 'palette' }, state: IDLE };
  if (e.code === 'BracketLeft' && !e.shiftKey) {
    return { action: yieldsBracket(ctx.pathname) ? null : { type: 'rail' }, state: IDLE };
  }
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
