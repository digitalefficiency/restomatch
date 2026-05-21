import type { Config } from 'tailwindcss';
import { colors, typography } from '@restomatch/ui-tokens';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: colors.background,
        surface: colors.surface,
        primary: colors.primary,
        'primary-hover': colors.primaryHover,
        accent: colors.accent,
        warning: colors.warning,
        danger: colors.danger,
      },
      fontFamily: {
        sans: typography.fontFamily.sans.split(',').map((s) => s.trim().replace(/"/g, '')),
      },
    },
  },
  plugins: [],
};

export default config;
