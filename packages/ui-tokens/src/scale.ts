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
 * raises caption to 14/20 and the hero drops to 40/44 below md (tokens.css).
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

const CARD_SHADOW = '0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(15,31,23,0.12)';

/** Elevation: e0 = border only (no shadow) · e1 raised · e2 overlay · e3 modal (+ scrim). */
export const elevation = {
  e0: 'none',
  e1: CARD_SHADOW,
  e2: '0 8px 16px -4px rgba(15,31,23,.16), 0 0 1px rgba(15,31,23,.24)',
  e3: '0 20px 24px -8px rgba(15,31,23,.22), 0 0 1px rgba(15,31,23,.24)',
} as const;

/** Scrim behind e3 surfaces. */
export const scrim = 'rgba(15,31,23,.48)';

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
  'glow-primary': '0 0 0 1px rgb(var(--c-primary) / 0.28), 0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(15,31,23,0.14)',
  'glow-danger': '0 0 0 1px rgb(var(--c-danger) / 0.30), 0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(184,15,42,0.16)',
  'glow-gold': '0 0 0 1px rgb(var(--c-gold) / 0.28), 0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(15,31,23,0.14)',
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
