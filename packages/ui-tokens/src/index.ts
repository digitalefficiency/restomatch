// RestoMatch design tokens — "Command Center for Money" (חדר בקרה לכסף).
// Locked dark fintech palette: near-black green-ink canvas, neon money-green
// primary, gold for money recovered, danger-rose for leaks. See
// docs/DESIGN-BRIEF.md. These tokens are mirrored into apps/web/tailwind.config.ts
// (semantic Tailwind names) — keep the two in sync.

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
