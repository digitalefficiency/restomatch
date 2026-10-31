// RestoMatch design tokens — "Command Center Light v2" (חדר בקרה לכסף).
//
// Three tiers (docs/ux/review/lens-design-system.md §3.1):
// - `semantic.ts` — colour ROLES: surfaces, text, focus, six status families,
//   money states and data-viz. Components consume roles, never hex.
// - `scale.ts`    — type roles, radius, elevation, motion, density, layers.
// - `build.ts`    — emits the CSS-variable block of apps/web/app/globals.css
//   and the Tailwind preset. Web code never hand-copies a value from here.
//
// `colors`, `spacing` and `typography` below are the previous DARK palette,
// still consumed by apps/mobile (frozen — owner decision 12). Unchanged on purpose.

export * from './semantic';
export * from './scale';
export { channels, colorVars, cssVariables, tailwindPreset, tokenBlockOf, withTokenBlock, TOKENS_START, TOKENS_END } from './build';
export { contrastRatio } from './contrast';

import { focus, status, surfaces, text } from './semantic';

/**
 * @deprecated v1 mirror of the web palette — use the roles in `semantic.ts`.
 * Derived from them, so it can no longer drift.
 */
export const webColors = {
  bg: surfaces.canvas,
  surface: surfaces.surface,
  surface2: surfaces.sunken,
  line: surfaces.line,
  lineStrong: surfaces.lineStrong,
  ink: text.ink,
  muted: text.muted,
  subtle: text.subtle,
  primary: status.primary.text,
  onPrimary: text.onBold,
  gold: status.gold.text,
  danger: status.danger.text,
  warn: status.warn.text,
  info: status.info.text,
  focus,
} as const;

export const colors = {
  // Canvas / surfaces (dark, green-ink)
  bg: '#0E1512', // near-black green-ink canvas
  surface: '#16201B', // cards
  surface2: '#1C2A23', // raised / hover / inputs
  line: '#2A3A31', // borders / dividers

  // Text
  ink: '#ECF5EF', // primary text
  muted: '#9DB2A6', // secondary text
  subtle: '#6B8478', // tertiary / placeholder

  // Brand + semantics
  primary: '#22D39A', // neon money-green (primary action, positive, clean-match)
  onPrimary: '#07120D', // text ON primary
  gold: '#E0B341', // savings / money recovered / positive ₪
  danger: '#FF5C7A', // leak / loss / block
  warn: '#F0A33E', // warning severity
  info: '#5BB0FF', // informational

  // --- Legacy aliases (consumed by apps/mobile) — mapped onto the dark palette
  //     so native screens share the same "command center" identity. ---
  background: '#0E1512', // → bg
  primaryHover: '#1BB888', // darker money-green for pressed states
  accent: '#E0B341', // → gold (savings accent)
  warning: '#F0A33E', // → warn
  textPrimary: '#ECF5EF', // → ink
  textSecondary: '#9DB2A6', // → muted
  border: '#2A3A31', // → line
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const typography = {
  fontFamily: {
    // Heebo drives Hebrew text, display and money (tabular-nums lining-nums).
    sans: '"Heebo", "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    // Mono is for IDENTIFIERS only (invoice, PO, SKU numbers via <Token>) — never money:
    // the JetBrains Mono subset has no ₪ glyph (design-system-02). Safety net: Heebo
    // right after JetBrains Mono, so a stray mono ₪ still draws from Heebo.
    mono: '"JetBrains Mono", "Heebo", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  },
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 32,
    '4xl': 40,
  },
  fontWeight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
} as const;
