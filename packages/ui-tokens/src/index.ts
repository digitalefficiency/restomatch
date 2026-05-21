export const colors = {
  background: '#0a0a0a',
  surface: '#171717',
  primary: '#2b397c',
  primaryHover: '#374599',
  accent: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  textPrimary: '#fafafa',
  textSecondary: '#a3a3a3',
  border: '#262626',
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
    sans: '"Heebo", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"JetBrains Mono", monospace',
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
  },
} as const;
