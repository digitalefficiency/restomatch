import type { Config } from 'tailwindcss';
import { tailwindPreset, typography } from '@restomatch/ui-tokens';

// RestoMatch web — "Command Center Light v2" (חדר בקרה לכסף).
// Every colour, type role, radius, shadow and duration comes from the
// @restomatch/ui-tokens preset; colours are CSS variables (RGB channels,
// generated into app/tokens.css) so `/opacity` modifiers keep working. Nothing
// here hard-codes a value — change the token source instead.

const config: Config = {
  presets: [tailwindPreset as Partial<Config>],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Heebo via the CSS var (with its metric-matched fallback), then the static stack.
        sans: ['var(--font-heebo)', ...typography.fontFamily.sans.split(',').map((s) => s.trim().replace(/"/g, ''))],
        mono: ['var(--font-mono)', ...typography.fontFamily.mono.split(',').map((s) => s.trim().replace(/"/g, ''))],
      },
      dropShadow: {
        // No neon text glows on a light canvas (v1 names kept so pages don't churn).
        'glow-primary': '0 0 0 transparent',
        'glow-danger': '0 0 0 transparent',
        'glow-gold': '0 0 0 transparent',
      },
    },
  },
  plugins: [],
};

export default config;
