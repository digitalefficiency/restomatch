import {
  choicesFromCookieHeader,
  displayCookieAssignment,
  serializeDisplayChoices,
  type DisplayChoices,
} from './schema';

/**
 * The client side of the display preferences: one module-level store over the
 * `rm_display` cookie. React reads it through `usePrefs()`
 * (useSyncExternalStore); key handlers that live outside React read
 * `singleKeysEnabled()`. Other tabs follow through a BroadcastChannel, and a
 * tab that comes back into view re-reads the cookie (browsers without the
 * channel). Server-safe: without `document` it is an empty, inert store.
 *
 * Safari and every iOS browser cap a cookie written by script at 7 days
 * (WebKit ITP), so the first reader on each page load writes the stored
 * choices back with a fresh lifetime: a choice lasts while the device keeps
 * opening the app at least once a week (a year elsewhere).
 */

type Listener = () => void;

const CHANNEL = 'rm-display';
const EMPTY: DisplayChoices = Object.freeze({}) as DisplayChoices;

let current: DisplayChoices | null = null;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
let wired = false;

function readCookie(): DisplayChoices {
  if (typeof document === 'undefined') return EMPTY;
  try {
    return choicesFromCookieHeader(document.cookie);
  } catch {
    return EMPTY;
  }
}

function writeCookie(c: DisplayChoices): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = displayCookieAssignment(
      c,
      typeof window !== 'undefined' && window.location?.protocol === 'https:',
    );
  } catch {
    /* cookies blocked: the choice lasts for this page only */
  }
}

function same(a: DisplayChoices, b: DisplayChoices): boolean {
  return a.density === b.density && a.textSize === b.textSize && a.singleKeys === b.singleKeys;
}

function emit() {
  for (const fn of [...listeners]) fn();
}

/** Re-read the cookie (another tab, or a tab coming back into view); notify only on a change. */
function refresh() {
  const next = readCookie();
  if (current && same(current, next)) return;
  current = next;
  emit();
}

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = () => refresh();
    }
  } catch {
    channel = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  // Renew the cookie's lifetime once per page load (WebKit ITP, see the header).
  const stored = readCookie();
  if (serializeDisplayChoices(stored)) writeCookie(stored);
}

/** The choices stored on this device (stable reference until they change). */
export function getDisplayChoices(): DisplayChoices {
  if (!current) current = readCookie();
  return current;
}

/** Store new choices: write the cookie, re-render readers, tell the other tabs. */
export function setDisplayChoices(next: DisplayChoices): void {
  const prev = getDisplayChoices();
  if (same(prev, next)) return;
  current = { ...next };
  writeCookie(current);
  emit();
  try {
    channel?.postMessage('changed');
  } catch {
    /* a closed channel: other tabs catch up when they come into view */
  }
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
 * single-key shortcuts on for this device? Reads the cookie on every call (a
 * short string), so a handler on a screen without the provider, or in a tab
 * that missed the broadcast, never acts on a stale answer. Ctrl/⌘
 * combinations are never affected. Without importing this module, read the
 * same cookie (README "Reading defensively").
 */
export function singleKeysEnabled(): boolean {
  return readCookie().singleKeys !== false;
}

/** Tests only: forget the cached choices and listeners. */
export function __resetDisplayStoreForTests(): void {
  current = null;
  listeners.clear();
  try {
    channel?.close();
  } catch {
    /* already closed */
  }
  channel = null;
  wired = false;
}
