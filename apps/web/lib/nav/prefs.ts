import type { UserRole } from '@restomatch/db';
import { MAX_FAVOURITES } from './favourites';
import { GROUP_ORDER } from './groups';
import type { GroupKey } from './types';

/**
 * Per-device nav preferences (sidebar spec §7.1, §13). The rail lives in a
 * cookie so the server renders the sidebar at its final width (no shift), and
 * localStorage mirrors it. Group state, favourites and the single-key switch
 * are localStorage only: server-side pins would be a schema change.
 *
 * Storage access can throw (site data blocked, a full quota, some private
 * modes), and a nav preference must never break the page, so every storage
 * call here sits in try/catch and no function throws. `window` is read
 * only inside functions, never at import: `layout.tsx` imports this module on
 * the server.
 */

/** Rail on/off (`1` / `0`), read on the server in `layout.tsx` so the first paint has the right width. */
export const RAIL_COOKIE = 'rm_nav_rail';

/** localStorage mirror of the rail cookie. */
export const RAIL_STORAGE = 'rm:nav:rail';

/**
 * The pre-DS3 shell's role-less group state. Nothing reads or writes it any
 * more (group state now lives under `groupsStorageKey(role)`); the name stays
 * exported because devices that ran the old shell still hold the value and the
 * cookie policy page lists it. It is deliberately not migrated: the old shell
 * wrote every group's state on each toggle, with all main groups open, and
 * that would override the per-role defaults.
 */
export const GROUPS_STORAGE = 'rm:nav:groups';

/**
 * The "קיצורים בתו אחד" switch (`1` / `0`; missing = on). One of the personal
 * preferences whose names are fixed for every package (DS3 WORKPLAN, "Personal
 * preferences: one contract"): DS3-06's store wraps this key; until it lands
 * the shell reads and writes the raw key.
 */
export const SINGLE_KEYS_STORAGE = 'rm:keys:single';

/**
 * Density and text size, the contract's two cookies (values `regular` /
 * `compact` and `regular` / `large`; DS3-06 owns the stored values and mirrors
 * them in localStorage). The shell reads them on the server, like the rail, so
 * `data-density` and `data-text` are right in the first HTML.
 */
export const DENSITY_COOKIE = 'rm_density';
export const TEXT_COOKIE = 'rm_text';

/**
 * `data-density` for the shell from the cookie: `compact` selects the DS2
 * token density mode of that name, `regular` the `default` one. Anything else
 * (absent, an old or edited value) sets nothing, so the page keeps its
 * defaults.
 */
export function densityAttr(value: string | null | undefined): 'compact' | 'default' | undefined {
  return value === 'compact' ? 'compact' : value === 'regular' ? 'default' : undefined;
}

/** `data-text` for the shell from the cookie (`regular` / `large`); anything else sets nothing. */
export function textAttr(value: string | null | undefined): 'regular' | 'large' | undefined {
  return value === 'large' || value === 'regular' ? value : undefined;
}

/** Fired on `window` once `writeSingleKeys` has saved the switch, so mounted key handlers re-read it without a reload. */
export const SINGLE_KEYS_EVENT = 'rm:keys';

/** The rail cookie lives one year, in seconds (spec §13). */
export const RAIL_COOKIE_MAX_AGE = 31_536_000;

/**
 * Group state is per role: the defaults differ per role (§4.2), and one person
 * can hold a different role in each branch, so one role's toggles must not
 * reshape another's panel.
 */
export const groupsStorageKey = (role: UserRole) => `rm:nav:groups:${role}`;

/** Favourites are per role: a page starred as owner may not exist for the same person as manager. */
export const favouritesStorageKey = (role: UserRole) => `rm:nav:fav:${role}`;

/** The slice of `Storage` these helpers use, so tests and callers can pass their own. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * `window.localStorage`, or null on the server or when the browser refuses it.
 * Reading the property itself throws a SecurityError when site data is
 * blocked, so even the lookup sits in try/catch.
 */
export function safeStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}

/**
 * The user's own group toggles for `role`, or null when nothing usable is
 * stored (missing, unreadable, not JSON, not a JSON object). Unknown keys and
 * non-boolean values are dropped one by one, so a bad entry sends only its own
 * group back to the default instead of wiping every toggle.
 */
export function readGroupState(
  role: UserRole,
  storage: StorageLike | null = safeStorage(),
): Partial<Record<GroupKey, boolean>> | null {
  const parsed = readJson(storage, groupsStorageKey(role));
  return isRecord(parsed) ? groupBooleans(parsed) : null;
}

/** Persist `role`'s group toggles. Only known groups with boolean values are written, in `GROUP_ORDER`. */
export function writeGroupState(
  role: UserRole,
  state: Partial<Record<GroupKey, boolean>>,
  storage: StorageLike | null = safeStorage(),
): void {
  safeSet(storage, groupsStorageKey(role), JSON.stringify(groupBooleans(state)));
}

/**
 * `role`'s starred pages: strings only, de-duplicated, at most
 * `MAX_FAVOURITES`, in the user's order. Anything unreadable reads as none.
 * Whether this viewer may still open each page is the caller's check
 * (`sanitizeFavourites`), since storage outlives role and flag changes.
 */
export function readFavourites(role: UserRole, storage: StorageLike | null = safeStorage()): string[] {
  const parsed = readJson(storage, favouritesStorageKey(role));
  return Array.isArray(parsed) ? cleanKeys(parsed) : [];
}

/** Persist `role`'s starred pages, cleaned the same way `readFavourites` reads them. */
export function writeFavourites(role: UserRole, keys: readonly string[], storage: StorageLike | null = safeStorage()): void {
  safeSet(storage, favouritesStorageKey(role), JSON.stringify(cleanKeys(keys)));
}

/**
 * Whether single-character shortcuts (`/`, `?`, `[`, the G chords) are on. On
 * unless the user turned them off (`0`): WCAG 2.1.4 asks for a way to turn
 * them off, because speech-input users trigger them by accident.
 */
export function readSingleKeys(storage: StorageLike | null = safeStorage()): boolean {
  return safeGet(storage, SINGLE_KEYS_STORAGE) !== '0';
}

/**
 * Persist the single-key switch (`1` / `0`), then, in a browser, fire
 * `SINGLE_KEYS_EVENT` on `window` so key handlers already mounted re-read it.
 * The event fires only after the write has landed. Listeners re-read storage,
 * so an event after a refused write (blocked site data, a full quota) would
 * hand them the old value and undo the switch the caller just applied in
 * memory: single-key shortcuts could then never be turned off on that device,
 * which is the off switch WCAG 2.1.4 asks for. With no event, the caller's
 * in-memory value holds for this page.
 */
export function writeSingleKeys(on: boolean, storage: StorageLike | null = safeStorage()): void {
  if (!safeSet(storage, SINGLE_KEYS_STORAGE, on ? '1' : '0')) return;
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(SINGLE_KEYS_EVENT));
    }
  } catch {
    /* no event support (odd embeds): handlers pick the value up on the next read */
  }
}

/**
 * The `document.cookie` assignment for the rail state: one year, path `/` (the
 * layout reads it on every dashboard page) and SameSite=Lax. Pass `secure` on
 * https so the cookie never travels in clear text.
 */
export function railCookie(on: boolean, secure = false): string {
  return `${RAIL_COOKIE}=${on ? '1' : '0'}; path=/; max-age=${RAIL_COOKIE_MAX_AGE}; samesite=lax${secure ? '; secure' : ''}`;
}

function safeGet(storage: StorageLike | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Write `value` at `key`; true only when the write landed. */
function safeSet(storage: StorageLike | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    /* quota, private mode or blocked storage: the preference lasts for this page only */
    return false;
  }
}

/** The parsed JSON at `key`, or undefined when it is missing, unreadable or not JSON. */
function readJson(storage: StorageLike | null, key: string): unknown {
  const raw = safeGet(storage, key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own, known group keys with boolean values only (also keeps `__proto__` and friends out). */
function groupBooleans(source: Readonly<Record<string, unknown>>): Partial<Record<GroupKey, boolean>> {
  const out: Partial<Record<GroupKey, boolean>> = {};
  for (const g of GROUP_ORDER) {
    const value = Object.hasOwn(source, g) ? source[g] : undefined;
    if (typeof value === 'boolean') out[g] = value;
  }
  return out;
}

/** Non-empty strings, first occurrence kept, at most `MAX_FAVOURITES`. */
function cleanKeys(list: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const key of list) {
    if (out.length >= MAX_FAVOURITES) break;
    if (typeof key === 'string' && key !== '' && !out.includes(key)) out.push(key);
  }
  return out;
}
