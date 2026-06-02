import type { Config } from 'tailwindcss';
import { typography } from '@restomatch/ui-tokens';

// RestoMatch web — "Ledger" design language.
// Bold/fresh fintech-for-restaurants identity (see docs/DESIGN-BRIEF.md):
// warm-paper canvas, ink text, deep emerald-teal brand, lime savings accent,
// rose alerts, warm-amber warnings, stone neutrals, money-flow signature motif.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F7F6F2',
        'bg-alt': '#EFEDE6',
        surface: '#FFFFFF',
        'surface-alt': '#FBFAF7',
        ink: '#15201A',
        primary: '#0B5E4A',
        'primary-hover': '#094C3C',
        accent: '#15A34A',
        'accent-glow': '#4ADE80',
        warning: '#C2680B',
        danger: '#E11D48',
      },
      fontFamily: {
        sans: typography.fontFamily.sans.split(',').map((s) => s.trim().replace(/"/g, '')),
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,32,26,0.04), 0 12px 28px -12px rgba(20,32,26,0.10)',
      },
    },
  },
  plugins: [],
};

export default config;
