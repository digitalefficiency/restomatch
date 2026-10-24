// RestoMatch design tokens — "Command Center for Money" (חדר בקרה לכסף).
//
// Two palettes during the light-theme transition (see docs/DESIGN-BRIEF.md):
// - `webColors` — the LIGHT identity of apps/web (the source of truth there is
//   the CSS variables in apps/web/app/globals.css; keep the two in sync).
// - `colors` — the previous dark palette, still consumed by apps/mobile through
//   its legacy aliases. Unchanged on purpose until mobile gets its own pass.

export const webColors = {
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

/** Glow + soft-shadow recipes for the dark canvas (soft borders + glows, not heavy drop shadows). */
export const glows = {
  primary: 'rgba(34,211,154,.22)',
  danger: 'rgba(255,92,122,.20)',
  gold: 'rgba(224,179,65,.18)',
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
