// RestoMatch design tokens — "Command Center for Money" (חדר בקרה לכסף).
// Light identity: calm off-white canvas, white cards, deep money-green primary,
// gold for money recovered, danger-red for leaks. Every text/background pair is
// WCAG AA. See docs/DESIGN-BRIEF.md. Mirrored into apps/web (CSS variables in
// app/globals.css, semantic Tailwind names in tailwind.config.ts) — keep in sync.

export const colors = {
  // Canvas / surfaces
  bg: '#F6F8F7', // off-white canvas
  surface: '#FFFFFF', // cards
  surface2: '#EEF3F0', // raised / hover / inputs
  line: '#D3DDD7', // dividers (decorative)
  lineStrong: '#7A8B82', // control borders (≥3:1)

  // Text
  ink: '#0F1F17', // primary text
  muted: '#4A5D53', // secondary text
  subtle: '#5A6A62', // tertiary / placeholder

  // Brand + semantics
  primary: '#066B4A', // deep money-green (primary action, positive, clean-match)
  onPrimary: '#FFFFFF', // text ON primary
  gold: '#8A5300', // savings / money recovered / positive ₪
  danger: '#B80F2A', // leak / loss / block
  warn: '#9A4405', // warning severity
  info: '#1A5BC7', // informational

  // --- Legacy aliases (consumed by apps/mobile) — mapped onto the same palette. ---
  background: '#F6F8F7', // → bg
  primaryHover: '#055A3E', // darker money-green for pressed states
  accent: '#8A5300', // → gold (savings accent)
  warning: '#9A4405', // → warn
  textPrimary: '#0F1F17', // → ink
  textSecondary: '#4A5D53', // → muted
  border: '#D3DDD7', // → line
} as const;

/** Emphasis tints (1px rings / soft washes) on the light canvas. */
export const glows = {
  primary: 'rgba(6,107,74,.28)',
  danger: 'rgba(184,15,42,.30)',
  gold: 'rgba(138,83,0,.28)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
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
    // Heebo drives Hebrew text + display; heavy weights (700/800) for big numbers.
    sans: '"Heebo", "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    // Mono stack for money figures / KPIs — terminal / command-center feel.
    mono: 'ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace',
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
