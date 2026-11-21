import {
  DENSITY_COOKIE,
  DENSITY_STORAGE,
  SINGLE_KEYS_EVENT,
  SINGLE_KEYS_STORAGE,
  TEXT_COOKIE,
  TEXT_STORAGE,
  cookieValue,
  pickDensity,
  pickSingleKeys,
  pickTextSize,
  prefCookieAssignment,
  type DisplayChoices,
} from './schema';

/**
 * The client side of the display preferences: one module-level store over the
 * contract's names (./schema.ts, README): `rm_density` and `rm_text` (cookies,
 * read on the server for the first HTML) mirrored in `rm:density` and
 * `rm:text` (localStorage), and `rm:keys:single` (localStorage only).
 *
 * React reads it through `usePrefs()` (useSyncExternalStore); key handlers
 * outside React call `singleKeysEnabled()`, which reads the key itself. Other
 * tabs follow through the `storage` event, this tab follows the shell's own
 * single-key switch through `rm:keys`, and a tab coming back into view re-reads
 * the cookies. Every storage access sits in try/catch: a preference never
 * breaks a page (blocked site data, a full quota, private modes).
 *
 * Safari and every iOS browser cap a cookie written by script at 7 days
 * (WebKit ITP), so the first reader on each page load writes the stored choices
 * back with a fresh lifetime, and a cookie the browser dropped is restored from
 * its localStorage mirror. Server-safe: without `document` it is an empty,
 * inert store.
 */

type Listener = () => void;

const EMPTY: DisplayChoices = Object.freeze({}) as DisplayChoices;

let current: DisplayChoices | null = null;
const listeners = new Set<Listener>();
let wired = false;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}

function getItem(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write or remove one key; true only when it landed. */
function putItem(key: string, value: string | null): boolean {
  const s = storage();
  if (!s) return false;
  try {
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function cookieHeader(): string {
  try {
    return typeof document === 'undefined' ? '' : document.cookie;
  } catch {
    return '';
  }
}

function writeCookie(name: typeof DENSITY_COOKIE | typeof TEXT_COOKIE, value: string | null) {
  if (typeof document === 'undefined') return;
  try {
    const secure = typeof window !== 'undefined' && window.location?.protocol === 'https:';
    document.cookie = prefCookieAssignment(
      name,
      name === DENSITY_COOKIE ? (pickDensity(value) ?? null) : (pickTextSize(value) ?? null),
      secure,
    );
  } catch {
    /* cookies blocked: the choice lasts for this page only */
  }
}

/** Everything stored on this device, each value picked from its own list (the cookie wins over its mirror). */
function readAll(): DisplayChoices {
  if (typeof document === 'undefined') return EMPTY;
  const header = cookieHeader();
  const out: DisplayChoices = {};
  const density =
    pickDensity(cookieValue(header, DENSITY_COOKIE)) ?? pickDensity(getItem(DENSITY_STORAGE));
  const textSize =
    pickTextSize(cookieValue(header, TEXT_COOKIE)) ?? pickTextSize(getItem(TEXT_STORAGE));
  const singleKeys = pickSingleKeys(getItem(SINGLE_KEYS_STORAGE));
  if (density) out.density = density;
  if (textSize) out.textSize = textSize;
  if (singleKeys !== undefined) out.singleKeys = singleKeys;
  return out;
}

function same(a: DisplayChoices, b: DisplayChoices): boolean {
  return a.density === b.density && a.textSize === b.textSize && a.singleKeys === b.singleKeys;
}

function emit() {
  for (const fn of [...listeners]) fn();
}

/** Re-read storage (another tab, the shell's switch, a tab coming back into view); notify only on a change. */
function refresh() {
  const next = readAll();
  if (current && same(current, next)) return;
  current = next;
  emit();
}

const WATCHED = new Set<string>([DENSITY_STORAGE, TEXT_STORAGE, SINGLE_KEYS_STORAGE]);

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  try {
    window.addEventListener('storage', (e) => {
      if (e.key === null || WATCHED.has(e.key)) refresh();
    });
    window.addEventListener(SINGLE_KEYS_EVENT, () => refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
  } catch {
    /* no event support (odd embeds): readers pick changes up on the next load */
  }
  // Renew the cookies' lifetime once per page load, and restore a cookie the
  // browser dropped from its mirror (WebKit ITP, see the header).
  const stored = readAll();
  if (stored.density) writeCookie(DENSITY_COOKIE, stored.density);
  if (stored.textSize) writeCookie(TEXT_COOKIE, stored.textSize);
}

/** The choices stored on this device (stable reference until they change). */
export function getDisplayChoices(): DisplayChoices {
  if (!current) current = readAll();
  return current;
}

/**
 * Store new choices: the cookies and their mirrors for density and text size,
 * the single-key key (then `rm:keys`, so mounted key handlers re-read it), and
 * re-render readers. Other tabs follow through the `storage` event.
 */
export function setDisplayChoices(next: DisplayChoices): void {
  const prev = getDisplayChoices();
  if (same(prev, next)) return;
  current = { ...next };
  if (prev.density !== next.density) {
    writeCookie(DENSITY_COOKIE, next.density ?? null);
    putItem(DENSITY_STORAGE, next.density ?? null);
  }
  if (prev.textSize !== next.textSize) {
    writeCookie(TEXT_COOKIE, next.textSize ?? null);
    putItem(TEXT_STORAGE, next.textSize ?? null);
  }
  if (prev.singleKeys !== next.singleKeys) {
    const value = next.singleKeys === undefined ? null : next.singleKeys ? '1' : '0';
    // The event only after the write landed: listeners re-read storage, and an event
    // after a refused write would hand them the old value (DS3-02's rule, lib/nav/prefs.ts).
    if (putItem(SINGLE_KEYS_STORAGE, value)) {
      try {
        window.dispatchEvent(new Event(SINGLE_KEYS_EVENT));
      } catch {
        /* no event support: handlers read the key on their next keystroke */
      }
    }
  }
  emit();
}

export function subscribeDisplay(fn: Listener): () => void {
  wire();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * For key handlers outside React (lib/hotkeys.ts, the desk keys): are
 * single-key shortcuts on for this device? Reads `rm:keys:single` on every
 * call, so a handler on a screen without the provider, or in a tab that missed
 * an event, never acts on a stale answer. Ctrl/⌘ combinations are never
 * affected. Without importing this module: `localStorage.getItem('rm:keys:single') !== '0'`.
 */
export function singleKeysEnabled(): boolean {
  return pickSingleKeys(getItem(SINGLE_KEYS_STORAGE)) !== false;
}

/** Tests only: forget the cached choices and listeners. */
export function __resetDisplayStoreForTests(): void {
  current = null;
  listeners.clear();
  wired = false;
}
