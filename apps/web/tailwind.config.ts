import type { Config } from 'tailwindcss';
import { typography } from '@restomatch/ui-tokens';

// RestoMatch web — "Command Center for Money" (חדר בקרה לכסף) design language.
// Light identity (see docs/DESIGN-BRIEF.md): a calm off-white canvas, white
// cards, deep money-green primary, gold for money recovered, danger-red for
// leaks, soft shadows. Every colour is a CSS variable (RGB channels, values in
// app/globals.css :root) so `/opacity` modifiers keep working. Mirrors
// packages/ui-tokens.
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Canvas / surfaces
        bg: v('bg'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        line: v('line'),
        // Input / control borders (≥3:1 against surfaces, WCAG 1.4.11).
        'line-strong': v('line-strong'),
        // Text
        ink: v('ink'),
        muted: v('muted'),
        subtle: v('subtle'),
        // Brand + semantics
        primary: v('primary'),
        'on-primary': v('on-primary'),
        gold: v('gold'),
        danger: v('danger'),
        warn: v('warn'),
        info: v('info'),
      },
      // Tints used across the app (bg-danger/12, bg-warn/8 …) that the default
      // opacity scale lacks — without these Tailwind emits no rule at all.
      opacity: {
        8: '0.08',
        12: '0.12',
      },
      fontFamily: {
        // Heebo via next/font CSS var, then the static stack as fallback.
        sans: ['var(--font-heebo)', ...typography.fontFamily.sans.split(',').map((s) => s.trim().replace(/"/g, ''))],
        mono: ['var(--font-mono)', ...typography.fontFamily.mono.split(',').map((s) => s.trim().replace(/"/g, ''))],
      },
      boxShadow: {
        // Soft card depth on the light canvas.
        card: '0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(15,31,23,0.12)',
        // Emphasis shadows (names kept from the dark "glow" era so pages don't churn):
        // a tinted 1px ring + the soft card shadow.
        'glow-primary': '0 0 0 1px rgb(var(--c-primary) / 0.28), 0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(15,31,23,0.14)',
        'glow-danger': '0 0 0 1px rgb(var(--c-danger) / 0.30), 0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(184,15,42,0.16)',
        'glow-gold': '0 0 0 1px rgb(var(--c-gold) / 0.28), 0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(15,31,23,0.14)',
      },
      dropShadow: {
        // No neon text glows on a light canvas.
        'glow-primary': '0 0 0 transparent',
        'glow-danger': '0 0 0 transparent',
        'glow-gold': '0 0 0 transparent',
      },
    },
  },
  plugins: [],
};

export default config;
