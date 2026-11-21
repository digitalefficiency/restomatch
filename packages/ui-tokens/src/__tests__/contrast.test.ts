import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { action, border, contrastRatio, cssVariables, dataViz, dataVizV2, emphasis, focus, status, surfaceV2, surfaces, text, textV2, tokenBlockOf, withTokenBlock, type StatusFamily } from '../index';

/** AA 4.5:1 for text plus a 0.1 safety margin (a11y-21). */
const TEXT_MIN = 4.6;
/** Non-text UI (focus ring, control boundaries): WCAG 1.4.11. */
const UI_MIN = 3;

const FAMILIES: StatusFamily[] = ['primary', 'danger', 'warn', 'gold', 'info', 'neutral'];
const SURFACES = { canvas: surfaces.canvas, surface: surfaces.surface, sunken: surfaces.sunken };

/** Every text/background role pair the system allows. */
function textPairs(): Array<[string, string, string]> {
  const pairs: Array<[string, string, string]> = [];
  for (const [bgName, bg] of Object.entries(SURFACES)) {
    pairs.push([`ink on ${bgName}`, text.ink, bg]);
    pairs.push([`muted on ${bgName}`, text.muted, bg]);
    pairs.push([`subtle on ${bgName}`, text.subtle, bg]);
    for (const f of FAMILIES) pairs.push([`${f} text on ${bgName}`, status[f].text, bg]);
  }
  for (const f of FAMILIES) {
    const r = status[f];
    pairs.push([`${f} text on ${f} subtle`, r.text, r.bgSubtle]);
    pairs.push([`${f} text on ${f} subtle-hover`, r.text, r.bgSubtleHover]);
    pairs.push([`ink on ${f} subtle`, text.ink, r.bgSubtle]);
    pairs.push([`on-bold on ${f} bold`, r.onBold, r.bgBold]);
    pairs.push([`on-bold on ${f} bold-hover`, r.onBold, r.bgBoldHover]);
  }
  dataViz.creep.forEach((s, i) => pairs.push([`text on creep-${i + 1}`, s.text, s.bg]));
  return pairs;
}

describe('token contrast', () => {
  it.each(textPairs())('%s ≥ 4.6:1', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it.each(Object.entries(SURFACES))('focus ring on %s ≥ 3:1', (_name, bg) => {
    expect(contrastRatio(focus, bg)).toBeGreaterThanOrEqual(UI_MIN);
  });

  it('control borders ≥ 3:1 on surface; field borders ≥ 4.5:1', () => {
    expect(contrastRatio(surfaces.lineStrong, surfaces.surface)).toBeGreaterThanOrEqual(UI_MIN);
    expect(contrastRatio(surfaces.lineField, surfaces.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('categorical data-viz hues are ≥ 3:1 on white', () => {
    for (const hex of dataViz.categorical) expect(contrastRatio(hex, '#FFFFFF')).toBeGreaterThanOrEqual(UI_MIN);
  });

  it('the checker itself matches known values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio(focus, '#FFFFFF')).toBeCloseTo(6.24, 1);
  });
});

describe('generated CSS', () => {
  it('the token block of apps/web/app/globals.css matches the source (run `pnpm --filter @restomatch/ui-tokens tokens:css`)', () => {
    const file = fileURLToPath(new URL('../../../../apps/web/app/globals.css', import.meta.url));
    expect(tokenBlockOf(readFileSync(file, 'utf8'))).toBe(cssVariables());
  });

  it('regenerating replaces the block in place and is idempotent', () => {
    const once = withTokenBlock('a {}\n');
    expect(once.startsWith(cssVariables())).toBe(true);
    expect(withTokenBlock(once)).toBe(once);
  });

  it('keeps every v1 variable name the pages already use', () => {
    const css = cssVariables();
    for (const name of ['bg', 'surface', 'surface-2', 'line', 'line-strong', 'ink', 'muted', 'subtle', 'primary', 'on-primary', 'gold', 'danger', 'warn', 'info']) {
      expect(css).toContain(`--c-${name}: `);
    }
    expect(css).toContain('--c-focus: 26 91 199;');
  });
});

describe('DS2 v2 contrast (every mode, direction A)', () => {
  const v2Surfaces = {
    canvas: surfaceV2.canvas,
    default: surfaceV2.default,
    sunken: surfaceV2.sunken,
    raised: surfaceV2.raised,
    overlay: surfaceV2.overlay,
    selected: surfaceV2.selected,
  };
  const modes = {
    desk: { primary: textV2.primary, secondary: textV2.secondary, tertiary: textV2.tertiary as string | null, min: TEXT_MIN },
    // C6 / F6: field body text ≥7:1, tertiary not allowed.
    field: { primary: textV2.primary, secondary: textV2.secondaryField, tertiary: null, min: 7 },
    contrast: { primary: textV2.primary, secondary: textV2.primary, tertiary: textV2.primary as string | null, min: 7 },
  };
  const pairs: Array<[string, string, string, number]> = [];
  for (const [mode, m] of Object.entries(modes)) {
    for (const [bgName, bg] of Object.entries(v2Surfaces)) {
      pairs.push([`${mode}: text.primary on ${bgName}`, m.primary, bg, m.min]);
      pairs.push([`${mode}: text.secondary on ${bgName}`, m.secondary, bg, m.min]);
      if (m.tertiary) pairs.push([`${mode}: text.tertiary on ${bgName}`, m.tertiary, bg, TEXT_MIN]);
    }
  }
  pairs.push(['field secondary ≥8.2:1 on surface', textV2.secondaryField, surfaceV2.default, 8.2]);
  pairs.push(['action.primary fg on bg', action.primary.fg, action.primary.bg, TEXT_MIN]);
  pairs.push(['action.primary fg on hover', action.primary.fg, action.primary.bgHover, TEXT_MIN]);
  pairs.push(['action.secondary fg on bg', action.secondary.fg, action.secondary.bg, TEXT_MIN]);
  pairs.push(['action.secondary fg on hover', action.secondary.fg, action.secondary.bgHover, TEXT_MIN]);
  pairs.push(['action.quiet fg on hover', action.quiet.fg, action.quiet.bgHover, TEXT_MIN]);
  pairs.push(['action.danger fg on bg', action.danger.fg, action.danger.bg, TEXT_MIN]);
  pairs.push(['action.danger fg on hover', action.danger.fg, action.danger.bgHover, TEXT_MIN]);
  pairs.push(['text.link on surface', textV2.link, surfaceV2.default, TEXT_MIN]);

  it.each(pairs)('%s', (_name, fg, bg, min) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it('control, field and focus borders ≥3:1 on every v2 surface (WCAG 1.4.11)', () => {
    for (const bg of Object.values(v2Surfaces)) {
      expect(contrastRatio(border.control, bg)).toBeGreaterThanOrEqual(UI_MIN);
      expect(contrastRatio(border.field, bg)).toBeGreaterThanOrEqual(UI_MIN);
      expect(contrastRatio(border.focus, bg)).toBeGreaterThanOrEqual(UI_MIN);
    }
  });

  it('field borders ≥4.5:1 on the opaque surfaces field mode puts controls on', () => {
    // Field surfaces are opaque white or canvas (C6). On sunken / selected the
    // field border is 4.3:1, so field inputs never sit on those (phase 3 rule).
    for (const bg of [surfaceV2.canvas, surfaceV2.default, surfaceV2.raised, surfaceV2.overlay]) {
      expect(contrastRatio(border.field, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('v2 categorical viz hues are ≥4.6:1 on white and carry no money colour', () => {
    for (const hex of dataVizV2.categorical) expect(contrastRatio(hex, '#FFFFFF')).toBeGreaterThanOrEqual(TEXT_MIN);
    for (const money of [status.primary.text, status.danger.text, status.warn.text]) expect(dataVizV2.categorical).not.toContain(money);
  });

  it('rails and the leak series stay danger/warn', () => {
    expect(emphasis.t1Rail).toBe(status.danger.text);
    expect(dataVizV2.leak).toBe(status.danger.text);
  });
});
