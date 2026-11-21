import type { UserRole } from '@restomatch/db';
import { MAX_FAVOURITES } from './favourites';
import { GROUP_ORDER } from './groups';
import type { GroupKey } from './types';

/**
 * Per-device nav preferences (sidebar spec §7.1, §13). The rail lives in a
 * cookie so the server renders the sidebar at its final width (no shift), and
 * localStorage mirrors it. Group state and favourites are localStorage only:
 * server-side pins would be a schema change. Density, text size and the
 * single-key switch are display preferences: DS3-06's store (`@/lib/prefs`).
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
