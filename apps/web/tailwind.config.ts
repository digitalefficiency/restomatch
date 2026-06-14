import type { Config } from 'tailwindcss';
import { typography } from '@restomatch/ui-tokens';

// RestoMatch web — "Command Center for Money" (חדר בקרה לכסף) design language.
// Locked dark fintech identity (see docs/DESIGN-BRIEF.md):
// near-black green-ink canvas, neon money-green primary, gold for money
// recovered, danger-rose for leaks, soft 1px borders + glows (not heavy
// shadows), money-flow signature motif. Mirrors packages/ui-tokens.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Canvas / surfaces
        bg: '#0E1512',
        surface: '#16201B',
        'surface-2': '#1C2A23',
        line: '#2A3A31',
        // Text
        ink: '#ECF5EF',
        muted: '#9DB2A6',
        subtle: '#6B8478',
        // Brand + semantics
        primary: '#22D39A',
        'on-primary': '#07120D',
        gold: '#E0B341',
        danger: '#FF5C7A',
        warn: '#F0A33E',
        info: '#5BB0FF',
      },
      fontFamily: {
        // Heebo via next/font CSS var, then the static stack as fallback.
        sans: ['var(--font-heebo)', ...typography.fontFamily.sans.split(',').map((s) => s.trim().replace(/"/g, ''))],
        mono: ['var(--font-mono)', ...typography.fontFamily.mono.split(',').map((s) => s.trim().replace(/"/g, ''))],
      },
      boxShadow: {
        // Soft card depth for the dark canvas (subtle, not heavy drop shadows).
        card: '0 1px 0 0 rgba(255,255,255,0.02) inset, 0 14px 34px -18px rgba(0,0,0,0.66)',
        // Signature glows — used on KPIs, heatmap cells, primary CTAs.
        'glow-primary': '0 0 0 1px rgba(34,211,154,0.22), 0 12px 36px -10px rgba(34,211,154,0.22)',
        'glow-danger': '0 0 0 1px rgba(255,92,122,0.20), 0 12px 36px -10px rgba(255,92,122,0.20)',
        'glow-gold': '0 0 0 1px rgba(224,179,65,0.18), 0 12px 36px -10px rgba(224,179,65,0.18)',
      },
      dropShadow: {
        'glow-primary': '0 0 10px rgba(34,211,154,0.45)',
        'glow-danger': '0 0 10px rgba(255,92,122,0.45)',
        'glow-gold': '0 0 10px rgba(224,179,65,0.4)',
      },
    },
  },
  plugins: [],
};

export default config;
