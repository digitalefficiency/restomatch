// Token build: one source → the web's CSS variables (a generated block at the top
// of apps/web/app/globals.css) and the Tailwind preset (apps/web/tailwind.config.ts).
// Regenerate with `pnpm --filter @restomatch/ui-tokens tokens:css`; a unit test
// fails when the committed block drifts from this output.

import { focus, status, surfaces, text, dataViz, type StatusFamily } from './semantic';
import {
  containers,
  density,
  elevation,
  legacyDuration,
  legacyEasing,
  legacyFontSize,
  legacyRadius,
  legacyShadow,
  motion,
  radiusRoles,
  scrim,
  typeRoles,
  zIndex,
} from './scale';

/** '#066B4A' → '6 107 74' (channels, so Tailwind's `/opacity` modifiers keep working). */
export function channels(hex: string): string {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
}

const FAMILIES: StatusFamily[] = ['primary', 'danger', 'warn', 'gold', 'info', 'neutral'];

/** Every colour variable, by name (without the `--c-` prefix). */
export function colorVars(): Record<string, string> {
  const vars: Record<string, string> = {
    // v1 names — unchanged values, still consumed by every page.
    bg: surfaces.canvas,
    surface: surfaces.surface,
    'surface-2': surfaces.sunken,
    line: surfaces.line,
    'line-strong': surfaces.lineStrong,
    ink: text.ink,
    muted: text.muted,
    subtle: text.subtle,
    primary: status.primary.text,
    'on-primary': text.onBold,
    gold: status.gold.text,
    danger: status.danger.text,
    warn: status.warn.text,
    info: status.info.text,
    // v2 roles.
    'surface-sunken': surfaces.sunken,
    'line-field': surfaces.lineField,
    'on-bold': text.onBold,
    neutral: status.neutral.text,
    focus,
  };
  for (const f of FAMILIES) {
    const r = status[f];
    vars[`${f}-bold`] = r.bgBold;
    vars[`${f}-bold-hover`] = r.bgBoldHover;
    vars[`${f}-subtle`] = r.bgSubtle;
    vars[`${f}-subtle-hover`] = r.bgSubtleHover;
    vars[`${f}-border-subtle`] = r.borderSubtle;
  }
  dataViz.categorical.forEach((hex, i) => (vars[`viz-${i + 1}`] = hex));
  dataViz.creep.forEach((step, i) => {
    vars[`creep-${i + 1}`] = step.bg;
    vars[`on-creep-${i + 1}`] = step.text;
  });
  return vars;
}

export const TOKENS_START = '/* @tokens:start — GENERATED from packages/ui-tokens; do not edit by hand.';
export const TOKENS_END = '/* @tokens:end */';

/** The generated CSS variables (the token block of globals.css, markers included). */
export function cssVariables(): string {
  const lines: string[] = [
    TOKENS_START,
    '   Regenerate: pnpm --filter @restomatch/ui-tokens tokens:css */',
    ':root {',
  ];
  for (const [name, hex] of Object.entries(colorVars())) lines.push(`  --c-${name}: ${channels(hex)}; /* ${hex} */`);
  lines.push(`  --scrim: ${scrim};`);
  for (const [k, v] of Object.entries(motion.duration)) lines.push(`  --dur-${k}: ${v};`);
  for (const [k, v] of Object.entries(motion.easing)) lines.push(`  --ease-${k}: ${v};`);
  for (const [k, v] of Object.entries(elevation)) lines.push(`  --shadow-${k}: ${v};`);
  for (const [k, v] of Object.entries(radiusRoles)) lines.push(`  --radius-${k}: ${v};`);
  for (const [k, v] of Object.entries(zIndex)) lines.push(`  --z-${k}: ${v};`);
  for (const [k, v] of Object.entries(containers)) lines.push(`  --container-${k}: ${v};`);
  lines.push(
    '  --focus-width: 2px;',
    '  --focus-offset: 2px;',
    '  --fs-caption: 0.75rem;',
    '  --lh-caption: 1rem;',
    '  --fs-metric-hero: 2.5rem;',
    '  --lh-metric-hero: 2.75rem;',
    `  --row-h: ${density.default.row}px;`,
    `  --control-h: ${density.default.control}px;`,
    `  --cell-inline: ${density.default.cellInline}px;`,
    '}',
    '@media (min-width: 768px) {',
    '  :root {',
    '    --fs-metric-hero: 3.5rem;',
    '    --lh-metric-hero: 3.75rem;',
    '  }',
    '}',
  );
  for (const [mode, d] of Object.entries(density)) {
    lines.push(
      `[data-density='${mode}'] {`,
      `  --row-h: ${d.row}px;`,
      `  --control-h: ${d.control}px;`,
      `  --cell-inline: ${d.cellInline}px;`,
      '}',
    );
  }
  lines.push(
    '/* Touch is the floor on coarse pointers, whatever density a region asks for. */',
    '@media (pointer: coarse) {',
    `  :root, [data-density] {`,
    `    --row-h: ${density.touch.row}px;`,
    `    --control-h: ${density.touch.control}px;`,
    '  }',
    '}',
    '/* Field mode (lens-mobile-field §3.6): bigger floor, stronger borders, 3 px focus. */',
    "[data-mode='field'] {",
    '  --fs-caption: 0.875rem;',
    '  --lh-caption: 1.25rem;',
    `  --c-line-strong: ${channels(surfaces.lineField)};`,
    '  --focus-width: 3px;',
    `  --control-h: ${density.touch.control}px;`,
    '}',
    '@media (prefers-contrast: more) {',
    '  :root {',
    `    --c-muted: ${channels(text.ink)};`,
    `    --c-subtle: ${channels(text.ink)};`,
    `    --c-line-strong: ${channels(text.ink)};`,
    '  }',
    '}',
    TOKENS_END,
  );
  return lines.join('\n');
}

/** The token block currently in a stylesheet (markers included), or null. */
export function tokenBlockOf(css: string): string | null {
  const start = css.indexOf(TOKENS_START);
  const end = css.indexOf(TOKENS_END);
  return start < 0 || end < start ? null : css.slice(start, end + TOKENS_END.length);
}

/** `css` with its token block replaced by (or, if absent, prefixed with) the generated one. */
export function withTokenBlock(css: string): string {
  const current = tokenBlockOf(css);
  return current ? css.replace(current, cssVariables()) : `${cssVariables()}\n\n${css}`;
}

const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

function family(f: StatusFamily) {
  return {
    DEFAULT: v(f),
    bold: v(`${f}-bold`),
    'bold-hover': v(`${f}-bold-hover`),
    subtle: v(`${f}-subtle`),
    'subtle-hover': v(`${f}-subtle-hover`),
  };
}

/**
 * Tailwind preset. `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration`
 * and `transitionTimingFunction` are REPLACED (roles + deprecated v1 keys);
 * colours, layers and containers extend Tailwind's defaults.
 */
export const tailwindPreset = {
  theme: {
    fontSize: { ...legacyFontSize, ...typeRoles },
    borderRadius: { ...legacyRadius, ...radiusRoles },
    boxShadow: { ...legacyShadow, ...elevation },
    transitionDuration: { ...legacyDuration, ...motion.duration },
    transitionTimingFunction: { ...legacyEasing, ...motion.easing },
    extend: {
      colors: {
        bg: v('bg'),
        surface: { DEFAULT: v('surface'), sunken: v('surface-sunken') },
        'surface-2': v('surface-2'),
        line: { DEFAULT: v('line'), strong: v('line-strong'), field: v('line-field') },
        ink: v('ink'),
        muted: v('muted'),
        subtle: v('subtle'),
        'on-primary': v('on-primary'),
        'on-bold': v('on-bold'),
        focus: v('focus'),
        primary: family('primary'),
        danger: family('danger'),
        warn: family('warn'),
        gold: family('gold'),
        info: family('info'),
        neutral: family('neutral'),
        ...Object.fromEntries(dataViz.categorical.map((_, i) => [`viz-${i + 1}`, v(`viz-${i + 1}`)])),
        ...Object.fromEntries(dataViz.creep.map((_, i) => [`creep-${i + 1}`, v(`creep-${i + 1}`)])),
        ...Object.fromEntries(dataViz.creep.map((_, i) => [`on-creep-${i + 1}`, v(`on-creep-${i + 1}`)])),
      },
      // `border-danger-subtle` is the decorative border role, not the subtle fill.
      borderColor: Object.fromEntries(
        FAMILIES.map((f) => [f, { subtle: v(`${f}-border-subtle`) }]),
      ),
      // Tints used across v1 pages (bg-danger/12, bg-warn/8 …) — deprecated, kept for rendering.
      opacity: { 8: '0.08', 12: '0.12' },
      zIndex: Object.fromEntries(Object.entries(zIndex).map(([k, n]) => [k, String(n)])),
      maxWidth: { app: containers.app, form: containers.form, auth: containers.auth, marketing: containers.marketing },
    },
  },
};
