import type { UserRole } from '@restomatch/db';

/**
 * Personal display preferences (DS3-06): density, text size and single-key
 * shortcuts. They belong to the DEVICE, not the account (owner decision 6,
 * 14.11.2026: "preferences are per device, as today"), so they live in one
 * first-party cookie that the server reads to render the final look in the
 * first HTML: no flash, no inline script. No schema, nothing in packages/db.
 *
 * Pure and isomorphic: the server (PrefsRoot), the client store and the tests
 * all go through these functions. The storage contract is in ./README.md.
 */

/** The one cookie. Its value is `key=value` pairs joined by `&`, fixed tokens only. */
export const DISPLAY_COOKIE = 'rm_display';
/** One year, like the locale and the side-menu cookies. */
export const DISPLAY_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

export const DENSITIES = ['regular', 'compact'] as const;
/** "רגיל / צפוף" (decision D4, 7.11.2026). */
export type Density = (typeof DENSITIES)[number];

export const TEXT_SIZES = ['regular', 'large'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** What this device stored: explicit choices only. A missing key means "the default". */
export interface DisplayChoices {
  density?: Density;
  textSize?: TextSize;
  singleKeys?: boolean;
}

/** The values in force for a role on this device. */
export interface DisplayPrefs {
  density: Density;
  textSize: TextSize;
  /** Single-key shortcuts (J, K, 1, 2, Z, /, ?, G…). Combinations with Ctrl/⌘ always work. */
  singleKeys: boolean;
}

export const DEFAULT_TEXT_SIZE: TextSize = 'regular';
export const DEFAULT_SINGLE_KEYS = true;

/**
 * Decision D4 (OWNER-DECISIONS-0711): "Density by role: owner and manager
 * 'רגיל', bookkeeper 'צפוף', field mode fixed. Each user gets a saved toggle."
 * Receiver and chef work in field mode, where density is fixed by the screen;
 * at a desk they start at 'רגיל'.
 */
export function roleDefaultDensity(role: UserRole | null | undefined): Density {
  return role === 'bookkeeper' ? 'compact' : 'regular';
}

/** The defaults for a role: what "חזרה לברירת המחדל" gives. */
export function defaultPrefs(role: UserRole | null | undefined): DisplayPrefs {
  return { density: roleDefaultDensity(role), textSize: DEFAULT_TEXT_SIZE, singleKeys: DEFAULT_SINGLE_KEYS };
}

export function resolvePrefs(choices: DisplayChoices, role: UserRole | null | undefined): DisplayPrefs {
  const d = defaultPrefs(role);
  return {
    density: choices.density ?? d.density,
    textSize: choices.textSize ?? d.textSize,
    singleKeys: choices.singleKeys ?? d.singleKeys,
  };
}

/**
 * Store a choice only when it differs from the default for this role, so a
 * shared device still gives the next person their own role's default (D4) and
 * the cookie stays absent until someone actually changes something.
 */
export function withChoice<K extends keyof DisplayPrefs>(
  choices: DisplayChoices,
  role: UserRole | null | undefined,
  key: K,
  value: DisplayPrefs[K],
): DisplayChoices {
  const next: DisplayChoices = { ...choices };
  if (value === defaultPrefs(role)[key]) delete next[key];
  else (next as Record<string, unknown>)[key] = value;
  return next;
}

/** Choices → the cookie value ('' when nothing is chosen). Order is fixed so equal choices give equal strings. */
export function serializeDisplayChoices(c: DisplayChoices): string {
  const parts: string[] = [];
  if (c.density) parts.push(`density=${c.density}`);
  if (c.textSize) parts.push(`text=${c.textSize}`);
  if (c.singleKeys !== undefined) parts.push(`keys=${c.singleKeys ? 'on' : 'off'}`);
  return parts.join('&');
}

/** The cookie value → choices. Unknown keys and values are ignored, so an old or edited cookie never breaks a page. */
export function parseDisplayChoices(raw: string | null | undefined): DisplayChoices {
  if (!raw) return {};
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    /* a malformed escape: read the raw text */
  }
  const out: DisplayChoices = {};
  for (const pair of value.split('&')) {
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (k === 'density' && (v === 'regular' || v === 'compact')) out.density = v;
    else if (k === 'text' && (v === 'regular' || v === 'large')) out.textSize = v;
    else if (k === 'keys' && (v === 'on' || v === 'off')) out.singleKeys = v === 'on';
  }
  return out;
}

/** Read the choices from a `document.cookie` / `Cookie:` header string. */
export function choicesFromCookieHeader(header: string | null | undefined): DisplayChoices {
  if (!header) return {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === DISPLAY_COOKIE) return parseDisplayChoices(part.slice(i + 1).trim());
  }
  return {};
}

/** The `document.cookie` assignment for these choices (a deletion when there are none). */
export function displayCookieAssignment(c: DisplayChoices, secure: boolean): string {
  const value = serializeDisplayChoices(c);
  const flags = `; path=/; samesite=lax${secure ? '; secure' : ''}`;
  return value
    ? `${DISPLAY_COOKIE}=${value}; max-age=${DISPLAY_COOKIE_MAX_AGE_SEC}${flags}`
    : `${DISPLAY_COOKIE}=; max-age=0${flags}`;
}

/**
 * Root font size for each text size. "גדול" matches the reference's 1.1 zoom
 * (reference/src/product.css `[data-text="large"]`); scaling the root size grows
 * every rem-based size (all text tokens), never below the 12 px floor.
 * Promote to shared: a text-size step token in packages/ui-tokens (DS3-00).
 */
export const TEXT_SCALE: Record<TextSize, string> = { regular: '100%', large: '110%' };

/** The DS2 token density mode (`[data-density]` in globals.css) a choice selects. */
export function tokenDensity(d: Density): 'default' | 'compact' {
  return d === 'compact' ? 'compact' : 'default';
}

/** The views toolbar's vocabulary (lib/components/views/state.ts `DENSITIES`). */
export function viewDensity(d: Density): 'comfortable' | 'compact' {
  return d === 'compact' ? 'compact' : 'comfortable';
}

/** DataTable's vocabulary (lib/components/table/types.ts `Density`). */
export function tableDensity(d: Density): 'default' | 'compact' {
  return tokenDensity(d);
}
