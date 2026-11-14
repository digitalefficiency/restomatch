// Scales — type roles, radius, elevation, motion, density, layers, containers and
// the chrome variables (lens-design-system §3.3–3.8, lens-mobile-field §3.2).
//
// The Tailwind preset REPLACES `fontSize`, `borderRadius`, `boxShadow`,
// `transitionDuration` and `transitionTimingFunction` with these. Tailwind's
// default keys survive as `legacy*` entries so existing call sites render
// unchanged until their area migrates (waves 2–3); new code uses the roles.

type FontSize = [string, { lineHeight: string; fontWeight?: string; letterSpacing?: string }];

/**
 * Closed type scale (R-15). Sizes are rem so they follow the browser's font
 * size (a11y-16). `caption` and `metric-hero` read CSS variables: field mode
 * raises caption to 14/20 and the hero drops to 40/44 below md (the generated block of globals.css).
 */
export const typeRoles: Record<string, FontSize> = {
  caption: ['var(--fs-caption)', { lineHeight: 'var(--lh-caption)' }], // 12/16 · 14/20 in field mode
  'body-sm': ['0.875rem', { lineHeight: '1.25rem' }], // 14/20
  body: ['1rem', { lineHeight: '1.5rem' }], // 16/24 — every input
  'heading-sm': ['1rem', { lineHeight: '1.5rem', fontWeight: '600' }], // 16/24 card titles
  'heading-md': ['1.25rem', { lineHeight: '1.75rem', fontWeight: '700' }], // 20/28 section h2
  'heading-lg': ['1.5rem', { lineHeight: '2rem', fontWeight: '700' }], // 24/32 page h1
  'metric-sm': ['1rem', { lineHeight: '1.5rem', fontWeight: '600' }], // 16/24 inline ₪, totals
  'metric-md': ['1.5rem', { lineHeight: '2rem', fontWeight: '700' }], // 24/32 T2 amount; field ₪ floor
  'metric-lg': ['2rem', { lineHeight: '2.5rem', fontWeight: '700', letterSpacing: '-0.01em' }], // 32/40 tiles
  'metric-hero': ['var(--fs-metric-hero)', { lineHeight: 'var(--lh-metric-hero)', fontWeight: '800', letterSpacing: '-0.02em' }], // 56/60 · 40/44 mobile
};

/** Tailwind's default `fontSize` — deprecated, kept so v1 call sites render unchanged. */
export const legacyFontSize: Record<string, [string, { lineHeight: string }]> = {
  xs: ['0.75rem', { lineHeight: '1rem' }],
  sm: ['0.875rem', { lineHeight: '1.25rem' }],
  base: ['1rem', { lineHeight: '1.5rem' }],
  lg: ['1.125rem', { lineHeight: '1.75rem' }],
  xl: ['1.25rem', { lineHeight: '1.75rem' }],
  '2xl': ['1.5rem', { lineHeight: '2rem' }],
  '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
  '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
  '5xl': ['3rem', { lineHeight: '1' }],
  '6xl': ['3.75rem', { lineHeight: '1' }],
  '7xl': ['4.5rem', { lineHeight: '1' }],
  '8xl': ['6rem', { lineHeight: '1' }],
  '9xl': ['8rem', { lineHeight: '1' }],
};

/** Radius by meaning: control 8 · card 12 · overlay 16 (dialogs, sheets, the T1 hero) · pill. */
export const radiusRoles = {
  control: '0.5rem',
  card: '0.75rem',
  overlay: '1rem',
  pill: '9999px',
} as const;

export const legacyRadius = {
  none: '0px',
  sm: '0.125rem',
  DEFAULT: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
} as const;

/** Shadows are tinted with the ink (`text.ink` #121C17; a unit test keeps the two equal). */
export const SHADOW_INK = '18 28 23';

/** DS3 (SPEC §4): one resting shadow (a card: white, 1 px `line` border, this) … */
const SH1 = `0 1px 2px rgb(${SHADOW_INK} / .05)`;
/** … and one floating shadow (toast, sheet, flyout, palette, dialog), with no border. */
const SH2 = `0 2px 6px rgb(${SHADOW_INK} / .06), 0 12px 28px -10px rgb(${SHADOW_INK} / .18)`;
const CARD_SHADOW = SH1;

/** Elevation: e0 = border only (no shadow) · e1 resting card · e2 floating layer · e3 modal (e2's shadow over the scrim). */
export const elevation = {
  e0: 'none',
  e1: CARD_SHADOW,
  e2: SH2,
  e3: SH2,
} as const;

/** Scrim behind e3 surfaces. */
export const scrim = `rgb(${SHADOW_INK} / .48)`;

/**
 * v1 shadows — deprecated. `card` = e1; the `glow-*` names are the dark-era
 * emphasis rings, kept verbatim so v1 call sites render unchanged.
 */
export const legacyShadow = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  none: 'none',
  card: CARD_SHADOW,
  // The glows keep their v1 geometry; their colours now read the roles (no literal colour).
  'glow-primary': `0 0 0 1px rgb(var(--c-primary) / 0.28), 0 1px 2px rgb(${SHADOW_INK} / 0.06), 0 8px 24px -12px rgb(${SHADOW_INK} / 0.14)`,
  'glow-danger': `0 0 0 1px rgb(var(--c-danger) / 0.30), 0 1px 2px rgb(${SHADOW_INK} / 0.06), 0 8px 24px -12px rgb(var(--c-danger) / 0.16)`,
  'glow-gold': `0 0 0 1px rgb(var(--c-gold) / 0.28), 0 1px 2px rgb(${SHADOW_INK} / 0.06), 0 8px 24px -12px rgb(${SHADOW_INK} / 0.14)`,
} as const;

/** Motion (R-10). Exits run at 0.5–0.7× the entrance. `transition-all` is deprecated. */
export const motion = {
  duration: { micro: '100ms', short: '150ms', medium: '240ms', long: '400ms' },
  easing: {
    standard: 'cubic-bezier(0.2,0,0.38,0.9)',
    enter: 'cubic-bezier(0,0,0.38,0.9)',
    exit: 'cubic-bezier(0.2,0,1,0.9)',
  },
} as const;

export const legacyDuration = {
  0: '0s',
  75: '75ms',
  100: '100ms',
  150: '150ms',
  200: '200ms',
  300: '300ms',
  500: '500ms',
  700: '700ms',
  1000: '1000ms',
  DEFAULT: '150ms',
} as const;

export const legacyEasing = {
  DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
  linear: 'linear',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

export type Density = 'compact' | 'default' | 'touch';

/** Row and control heights per density (px). `touch` is the floor on coarse pointers. */
export const density: Record<Density, { row: number; control: number; cellInline: number }> = {
  compact: { row: 32, control: 32, cellInline: 12 },
  default: { row: 48, control: 40, cellInline: 16 },
  touch: { row: 56, control: 48, cellInline: 16 },
};

/** Button / control heights: sm 32 · md 40 · lg 48 · xl 56 (field primary). */
export const controlHeight = { sm: 32, md: 40, lg: 48, xl: 56 } as const;

/** Layers (lens-mobile-field §3.2). Snackbars/toasts sit above the consent card. */
export const zIndex = {
  content: 0,
  'sticky-header': 10,
  'action-bar': 30,
  'top-bar': 40,
  'bottom-bar': 40,
  consent: 45,
  scrim: 50,
  sheet: 51,
  snackbar: 60,
  'skip-link': 70,
} as const;

export const containers = {
  app: '1600px',
  form: '720px',
  prose: '70ch',
  marketing: '1280px',
  auth: '440px',
} as const;

/**
 * Chrome measurements published at runtime as CSS variables on <html> by the
 * shell and the action bars (each consumer supplies its own fallback). Used by
 * `scroll-padding` (WCAG 2.4.11) and by the toast offset.
 */
export const chromeVars = ['--rm-header-h', '--rm-bottomnav-h', '--rm-actionbar-h', '--consent-h'] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

// ── DS2 scales (docs/ux/ds2/DS2-SPEC.md §2.1.2, §2.3, §2.4, §5.3) ──────────
// Added beside the v1 roles above. `heading-*` and `metric-*` keep their old
// values as aliases; new code uses `title-*` and `money-*`. The roles that
// already exist (`caption`, `body-sm`, `body`) are not re-valued before phase 3.

/** One type role: size / line-height in rem, weight, tracking. */
export interface TypeStep {
  fs: string;
  lh: string;
}
export interface TypeRoleV2 {
  base: TypeStep;
  /** ★ roles only: the compact density value. */
  compact?: TypeStep;
  /** Field mode (phone at the dock, count, supplier link). */
  field?: TypeStep;
  /** Below md (phone): the hero and the marketing display roles step down. */
  phone?: TypeStep;
  fw: number;
  ls: string;
}

const t = (fs: number, lh: number): TypeStep => ({ fs: `${fs / 16}rem`, lh: `${lh / 16}rem` });

/**
 * The closed v2 scale, direction A values (DS2 §6.1: line-heights one step
 * looser than the base because Plex's Hebrew is tall; titles at 600 so the ₪
 * carries the weight; the hero at 700, Plex has no 800). `id` is Plex Sans 500
 * with `tnum` (D3), never a mono face.
 */
export const typeScaleV2: Record<string, TypeRoleV2> = {
  cell: { base: t(14, 22), compact: t(13, 20), field: t(16, 24), fw: 400, ls: '0' },
  'title-sm': { base: t(16, 24), field: t(18, 26), fw: 600, ls: '0' },
  // DS3 SPEC §7: in compact density a screen title is 20/26 (★ from DS3; nothing reads these roles yet).
  'title-md': { base: t(20, 28), compact: t(20, 26), field: t(20, 28), fw: 600, ls: '0' },
  'title-lg': { base: t(24, 32), compact: t(20, 26), field: t(22, 30), fw: 600, ls: '0' },
  'money-dense': { base: t(14, 22), compact: t(13, 20), field: t(16, 24), fw: 400, ls: '0' },
  'money-row': { base: t(16, 24), compact: t(14, 20), field: t(18, 26), fw: 600, ls: '0' },
  'money-card': { base: t(28, 36), compact: t(24, 32), field: t(28, 36), fw: 700, ls: '-0.01em' },
  'money-hero': { base: t(56, 64), phone: t(40, 48), field: t(40, 48), fw: 700, ls: '-0.01em' },
  'qty-field': { base: t(20, 28), fw: 700, ls: '0' },
  id: { base: t(13, 20), compact: t(12, 16), field: t(14, 20), fw: 500, ls: '0' },
  // DS3 SPEC §3/§7: a queue row's title and amount (14/20 → 14/18 compact) and its sub-line
  // (13/18 → 12/16 compact). No DS2 role has these steps; nothing reads them yet.
  'row-title': { base: t(14, 20), compact: t(14, 18), field: t(16, 24), fw: 500, ls: '0' },
  'row-sub': { base: t(13, 18), compact: t(12, 16), field: t(14, 20), fw: 400, ls: '0' },
  kbd: { base: t(12, 16), fw: 500, ls: '0' },
  'display-sm': { base: t(36, 44), phone: t(32, 40), fw: 700, ls: '-0.02em' },
  'display-md': { base: t(48, 56), phone: t(40, 48), fw: 700, ls: '-0.02em' },
  'display-lg': { base: t(64, 72), phone: t(44, 52), fw: 700, ls: '-0.02em' },
};

/** Tailwind `fontSize` entries for the v2 roles: every dial reads a variable. */
export const typeRolesV2: Record<string, FontSize> = Object.fromEntries(
  Object.keys(typeScaleV2).map((role) => [
    role,
    [`var(--fs-${role})`, { lineHeight: `var(--lh-${role})`, fontWeight: `var(--fw-${role})`, letterSpacing: `var(--ls-${role})` }],
  ]),
);

/** Radius roles DS2 adds (D6 keeps control 8 · card 12 · overlay 16 above). */
export const radiusRolesV2 = { xs: '0.25rem', chip: '9999px' } as const;

/** Semantic spacing aliases (DS2 §2.3). Values that change by mode read a variable. */
export const spaceRoles = {
  'inset-chip': '0.5rem',
  'inset-control': 'var(--inset-control)',
  'inset-cell': 'var(--cell-px)',
  'inset-card': '1rem',
  'stack-xs': '0.25rem',
  'stack-sm': '0.5rem',
  'stack-md': '0.75rem',
  'stack-lg': '1rem',
  'stack-xl': '1.5rem',
  'stack-2xl': '2rem',
  'gutter-page': 'var(--gutter-page)',
} as const;

/** Chrome sizes (replace `h-[55px]`, `max-w-[1600px]` in phase 5). */
export const chrome = {
  'header-h': '56px',
  'sidebar-w': '248px',
  'rail-w': '64px',
  'bottombar-h': '64px',
} as const;
