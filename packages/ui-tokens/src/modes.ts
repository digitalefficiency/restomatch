// DS2 variables and their mode overrides (docs/ux/ds2/DS2-SPEC.md §2.8, §5.5).
//
// Everything here is NEW: no block re-binds a variable that a v1 page reads.
// build.ts emits these after the v1 block, inside the same generated region,
// so the region only grows (DS2 §5.6 contract rule 2).

import { cellPx, dials, gutterPage, rowConstants, type DialMode } from './components';
import { activeFonts } from './fonts';
import { chrome, radiusRolesV2, typeScaleV2, type TypeStep } from './scale';
import { action, border, dataVizV2, emphasis, moneyMarker, surfaceV2, text, textV2 } from './semantic';

export interface VarBlock {
  comment?: string;
  /** Wraps the rule in `@media (…)`. */
  media?: string;
  selector: string;
  vars: Record<string, string>;
}

/** The v2 colour roles, by name without the `--c-` prefix (hex values). */
export function colorVarsV2(): Record<string, string> {
  return {
    'surface-canvas': surfaceV2.canvas,
    'surface-default': surfaceV2.default,
    'surface-raised': surfaceV2.raised,
    'surface-overlay': surfaceV2.overlay,
    'surface-selected': surfaceV2.selected,
    'text-primary': textV2.primary,
    'text-secondary': textV2.secondary,
    'text-tertiary': textV2.tertiary,
    'text-link': textV2.link,
    'border-subtle': border.subtle,
    'border-rule': border.rule,
    'border-control': border.control,
    'border-field': border.field,
    'border-focus': border.focus,
    'action-primary-bg': action.primary.bg,
    'action-primary-bg-hover': action.primary.bgHover,
    'action-primary-fg': action.primary.fg,
    'action-secondary-border': action.secondary.border,
    'action-secondary-bg': action.secondary.bg,
    'action-secondary-bg-hover': action.secondary.bgHover,
    'action-secondary-fg': action.secondary.fg,
    'action-quiet-fg': action.quiet.fg,
    'action-quiet-fg-hover': action.quiet.fgHover,
    'action-quiet-bg-hover': action.quiet.bgHover,
    'action-danger-bg': action.danger.bg,
    'action-danger-bg-hover': action.danger.bgHover,
    'action-danger-fg': action.danger.fg,
    'emphasis-t1-rail': emphasis.t1Rail,
    'emphasis-t2-rail': emphasis.t2Rail,
    'money-marker': moneyMarker,
    ...Object.fromEntries(dataVizV2.categorical.map((hex, i) => [`viz-cat-${i + 1}`, hex])),
    'viz-up': dataVizV2.up,
    'viz-down': dataVizV2.down,
    'viz-prev': dataVizV2.prev,
    'viz-leak': dataVizV2.leak,
    'viz-grid': dataVizV2.grid,
  };
}

function hexChannels(hex: string): string {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
}

const px = (n: number) => `${n}px`;

function typeVars(pick: (role: string) => TypeStep | undefined, withStatic = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [role, r] of Object.entries(typeScaleV2)) {
    const step = pick(role);
    if (step) {
      out[`--fs-${role}`] = step.fs;
      out[`--lh-${role}`] = step.lh;
    }
    if (withStatic) {
      out[`--fw-${role}`] = String(r.fw);
      out[`--ls-${role}`] = r.ls;
    }
  }
  return out;
}

function dialVars(mode: DialMode, fallbackToDefault: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, byMode] of Object.entries(dials)) {
    const v = byMode[mode] ?? (fallbackToDefault ? byMode.default : undefined);
    if (v !== undefined) out[`--${name}`] = px(v);
  }
  return out;
}

/** Every v2 variable block, in emission order. */
export function v2Blocks(): VarBlock[] {
  const rows = rowConstants();
  const cell = cellPx();
  const root: Record<string, string> = {};
  for (const [name, hex] of Object.entries(colorVarsV2())) root[`--c-${name}`] = hexChannels(hex);
  Object.assign(root, {
    '--font-ui-faces': activeFonts.uiFaces,
    '--font-ui': activeFonts.ui,
    '--font-num': activeFonts.num,
    '--font-id': activeFonts.id,
    '--font-display': activeFonts.display,
    // D11: the family token W3-08's `.report-display` reads (report cover + print header only, never ₪).
    '--font-report-display': 'var(--font-display)',
    '--font-features-ui': activeFonts.featuresUi,
    '--font-features-num': activeFonts.featuresNum,
  });
  // Mobile first: roles with a phone step start there and grow at md.
  Object.assign(root, typeVars((role) => typeScaleV2[role]!.phone ?? typeScaleV2[role]!.base, true));
  Object.assign(root, dialVars('default', true));
  Object.assign(root, {
    '--row-compact': px(rows.compact),
    '--row-default': px(rows.default),
    '--row-touch': px(rows.touch),
    '--cell-px': px(cell.default),
    '--radius-xs': radiusRolesV2.xs,
    '--radius-chip': radiusRolesV2.chip,
    '--ring-selected': 'inset 0 0 0 2px rgb(var(--c-action-primary-bg))',
    '--gutter-page': px(gutterPage.base),
  });
  for (const [k, v] of Object.entries(chrome)) root[`--chrome-${k}`] = v;

  const starred = (role: string) => typeScaleV2[role]!.compact;
  const base = (role: string) => (typeScaleV2[role]!.compact ? typeScaleV2[role]!.base : undefined);

  return [
    { comment: 'DS2 phase 1: new roles only. No v1 variable is re-bound below.', selector: ':root', vars: root },
    {
      media: '(min-width: 768px)',
      selector: ':root',
      vars: { ...typeVars((role) => (typeScaleV2[role]!.phone ? typeScaleV2[role]!.base : undefined)), '--gutter-page': px(gutterPage.md) },
    },
    { media: '(min-width: 1024px)', selector: ':root', vars: { '--gutter-page': px(gutterPage.lg) } },
    { selector: "[data-density='compact']", vars: { ...typeVars(starred), ...dialVars('compact', false), '--cell-px': px(cell.compact) } },
    { selector: "[data-density='default']", vars: { ...typeVars(base), ...dialVars('default', false), '--cell-px': px(cell.default) } },
    { selector: "[data-density='touch']", vars: { ...typeVars(base), ...dialVars('touch', false), '--cell-px': px(cell.touch) } },
    {
      comment: 'DS2 field mode (C6): field type steps, ≥8.2:1 secondary text, no tertiary, field borders.',
      selector: "[data-mode='field']",
      vars: {
        ...typeVars((role) => typeScaleV2[role]!.field),
        ...dialVars('field', false),
        '--c-text-secondary': hexChannels(textV2.secondaryField),
        '--c-text-tertiary': hexChannels(textV2.secondaryField),
        '--c-border-control': hexChannels(border.field),
      },
    },
    {
      media: '(prefers-contrast: more)',
      selector: ':root',
      vars: {
        '--c-text-secondary': hexChannels(text.ink),
        '--c-text-tertiary': hexChannels(text.ink),
        '--c-border-control': hexChannels(text.ink),
      },
    },
  ];
}

/** CSS text for the v2 blocks (2-space indent, one declaration per line). */
export function v2Css(): string {
  const out: string[] = [];
  for (const b of v2Blocks()) {
    if (Object.keys(b.vars).length === 0) continue;
    if (b.comment) out.push(`/* ${b.comment} */`);
    const pad = b.media ? '    ' : '  ';
    if (b.media) out.push(`@media ${b.media} {`, `  ${b.selector} {`);
    else out.push(`${b.selector} {`);
    for (const [k, v] of Object.entries(b.vars)) out.push(`${pad}${k}: ${v};`);
    out.push(b.media ? '  }' : '}');
    if (b.media) out.push('}');
  }
  return out.join('\n');
}
