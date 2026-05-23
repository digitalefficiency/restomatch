import type { Config } from 'tailwindcss';
import { typography } from '@restomatch/ui-tokens';

// RestoMatch web — light theme (white + blue).
// Brand colors below override the dark tokens from @restomatch/ui-tokens
// for the web app only. Mobile (RN) still uses the dark tokens directly.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#FFFFFF',
        'bg-alt': '#F8FAFC',
        surface: '#FFFFFF',
        'surface-alt': '#F1F5F9',
        primary: '#2563EB',
        'primary-hover': '#1D4ED8',
        accent: '#059669',
        warning: '#D97706',
        danger: '#DC2626',
      },
      fontFamily: {
        sans: typography.fontFamily.sans.split(',').map((s) => s.trim().replace(/"/g, '')),
      },
    },
  },
  plugins: [],
};

export default config;
