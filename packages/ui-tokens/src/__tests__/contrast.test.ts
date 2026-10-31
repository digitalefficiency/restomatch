import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, cssVariables, dataViz, focus, status, surfaces, text, tokenBlockOf, withTokenBlock, type StatusFamily } from '../index';

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
