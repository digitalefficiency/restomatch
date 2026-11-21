import type { UserRole } from '@restomatch/db';

/**
 * Personal display preferences (DS3-06): density, text size and single-key
 * shortcuts. They belong to the DEVICE, not the account (owner decision 6,
 * 14.11.2026: "preferences are per device, as today"). No schema, nothing in
 * packages/db.
 *
 * The storage names are FIXED by the DS3 contract (docs/ux/ds3/WORKPLAN.md,
 * "Personal preferences: one contract"), because three other packages read
 * them: the shell (DS3-02) reads the two cookies on the server and sets
 * `data-density` / `data-text` before first paint, and writes the single-key
 * switch outside settings; the desk keys (DS3-04) and lib/hotkeys.ts read the
 * single-key key; the two density switches (DS3-01) default to the density.
 *
 * A value read from storage only ever PICKS one of these constants (a flag is
 * compared, a choice is matched against its list); nothing read from storage is
 * written into the page as is (DS3 CHANGES.md, third and fourth corrections).
 *
 * Pure and isomorphic: the server (PrefsRoot), the client store and the tests
 * all go through these functions. The contract is in ./README.md.
 */

/** Density: cookie (read on the server) mirrored in localStorage. Values `regular` / `compact`. */
export const DENSITY_COOKIE = 'rm_density';
export const DENSITY_STORAGE = 'rm:density';
/** Text size: cookie (read on the server) mirrored in localStorage. Values `regular` / `large`. */
export const TEXT_COOKIE = 'rm_text';
export const TEXT_STORAGE = 'rm:text';
/** Single-key shortcuts: localStorage only (sidebar spec §13). `1` / `0`; absent = on. */
export const SINGLE_KEYS_STORAGE = 'rm:keys:single';
/** Fired on `window` after the single-key key was written, so mounted key handlers re-read it (DS3-02's name). */
export const SINGLE_KEYS_EVENT = 'rm:keys';
/** One year, like the locale and the side-menu cookies (sidebar spec §13). */
export const PREF_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

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
  return {
    density: roleDefaultDensity(role),
    textSize: DEFAULT_TEXT_SIZE,
    singleKeys: DEFAULT_SINGLE_KEYS,
  };
}

export function resolvePrefs(
  choices: DisplayChoices,
  role: UserRole | null | undefined,
): DisplayPrefs {
  const d = defaultPrefs(role);
  return {
    density: choices.density ?? d.density,
    textSize: choices.textSize ?? d.textSize,
    singleKeys: choices.singleKeys ?? d.singleKeys,
  };
}

/**
 * Store a density or text choice only when it differs from the default for
 * this role, so a shared device still gives the next person their own role's
 * default (D4) and the cookie stays absent until someone changes something.
 * The single-key switch is always stored as the person set it (`1` / `0`), as
 * the shell's own switch does.
 */
export function withChoice<K extends keyof DisplayPrefs>(
  choices: DisplayChoices,
  role: UserRole | null | undefined,
  key: K,
  value: DisplayPrefs[K],
): DisplayChoices {
  const next: DisplayChoices = { ...choices };
  if (key !== 'singleKeys' && value === defaultPrefs(role)[key]) delete next[key];
  else (next as Record<string, unknown>)[key] = value;
  return next;
}

/* ── reading stored values: each one only picks a constant ─────────────────── */

/** A stored density → one of DENSITIES, else undefined (old, edited or foreign values read as "not chosen"). */
export function pickDensity(raw: string | null | undefined): Density | undefined {
  return DENSITIES.find((d) => d === raw);
}

/** A stored text size → one of TEXT_SIZES, else undefined. */
export function pickTextSize(raw: string | null | undefined): TextSize | undefined {
  return TEXT_SIZES.find((t) => t === raw);
}

/** The single-key flag: `'0'` → off, `'1'` → on, anything else → not chosen (on). */
export function pickSingleKeys(raw: string | null | undefined): boolean | undefined {
  return raw === '0' ? false : raw === '1' ? true : undefined;
}

/**
 * One cookie's value from a `document.cookie` / `Cookie:` header string, or
 * null. The same function on the server and in the browser, so both read the
 * same value (the first pair with that exact name).
 */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const raw = part.slice(i + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Density and text size from a cookie header (the single-key switch is not a cookie). */
export function choicesFromCookieHeader(header: string | null | undefined): DisplayChoices {
  const out: DisplayChoices = {};
  const density = pickDensity(cookieValue(header, DENSITY_COOKIE));
  const textSize = pickTextSize(cookieValue(header, TEXT_COOKIE));
  if (density) out.density = density;
  if (textSize) out.textSize = textSize;
  return out;
}

/** The `document.cookie` assignment for one preference cookie (a deletion for `null`). */
export function prefCookieAssignment(
  name: typeof DENSITY_COOKIE | typeof TEXT_COOKIE,
  value: Density | TextSize | null,
  secure: boolean,
): string {
  const flags = `; path=/; samesite=lax${secure ? '; secure' : ''}`;
  return value
    ? `${name}=${value}; max-age=${PREF_COOKIE_MAX_AGE_SEC}${flags}`
    : `${name}=; max-age=0${flags}`;
}

/* ── what the page shows ───────────────────────────────────────────────────── */

/**
 * "גדול" enlarges the page content by 1.1, as the reference does
 * (reference/src/product.css: `[data-text="large"] .rm-main{ zoom:1.1 }`): the
 * dashboard's content column (`#main-content`, app/dashboard/layout.tsx), on
 * screen only, so printed letters keep their size. The side menu, the top bar,
 * dialogs and toasts keep theirs: the side menu's fit rule is measured at
 * 100 % (docs/ux/sidebar/SPEC.md). The styles `data-text` drives belong to
 * DS3-00 / DS3-01; this rule is the interim one until they style it, and reads
 * the `--text-zoom-large` token when DS3-00 defines it (1 there switches it off).
 */
export const TEXT_ZOOM: Record<TextSize, number> = { regular: 1, large: 1.1 };
/** The box "גדול" enlarges: the content column's single child (its width container). */
export const CONTENT_SELECTOR = '#main-content > *';

/** The CSS a text size adds to the page (null for the regular size). */
export function textSizeRule(size: TextSize): string | null {
  return size === 'regular'
    ? null
    : `@media screen{${CONTENT_SELECTOR}{zoom:var(--text-zoom-${size},${TEXT_ZOOM[size]})}}`;
}

/**
 * Where a display setting does nothing, and is therefore absent (SPEC §10.5
 * "on a phone the settings that do nothing there are not shown"):
 *  • density is fixed on a touch pointer (SPEC §7): the regular size applies,
 *    whatever the choice, and the density setting is not offered;
 *  • the side menu exists from 1024 px (the shell's `lg`), so below that its
 *    setting is not offered;
 *  • single-key shortcuts need a keyboard: not offered on a phone (narrow and
 *    touch). An iPad with a keyboard at 1024 px or wider keeps the switch.
 */
export const COARSE_QUERY = '(pointer: coarse)';
export const NARROW_QUERY = '(max-width: 1023.98px)';
export const PHONE_QUERY = '(max-width: 1023.98px) and (pointer: coarse)';

/** What the server can tell about the requesting device (User-Agent), used only as the SSR snapshot. */
export interface DeviceHints {
  /** A phone or tablet browser: density renders at the regular size from the first HTML. */
  coarse: boolean;
  /** macOS or iOS: shortcuts are labelled with ⌘. */
  apple: boolean;
}
export const NO_DEVICE_HINTS: DeviceHints = Object.freeze({
  coarse: false,
  apple: false,
}) as DeviceHints;

/**
 * The `data-density` attribute for the density in force: only "compact" is
 * written; the regular density is the `:root` token values (an explicit
 * "default" would re-declare every token and cancel :root media rules).
 */
export function densityAttr(applied: Density): 'compact' | undefined {
  return applied === 'compact' ? 'compact' : undefined;
}

/** The `data-text` attribute for the text size in force: only "large" is written. */
export function textAttr(size: TextSize): 'large' | undefined {
  return size === 'large' ? 'large' : undefined;
}

/**
 * For the shell (DS3-02), on the server: the two attributes from the cookies
 * AND the role, so an absent cookie gives the role's default (D4: the
 * bookkeeper's tables start compact) and a phone renders the regular density.
 */
export function shellAttrs(
  header: string | null | undefined,
  role: UserRole | null | undefined,
  hints: DeviceHints = NO_DEVICE_HINTS,
): { density: 'compact' | undefined; text: 'large' | undefined } {
  const p = resolvePrefs(choicesFromCookieHeader(header), role);
  return { density: hints.coarse ? undefined : densityAttr(p.density), text: textAttr(p.textSize) };
}

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
