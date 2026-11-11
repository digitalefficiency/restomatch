// DS2 phase 1 (train α): the change is ADDITIVE. Every v1 variable, mode block
// and Tailwind key renders exactly as before; only new names are added.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as tokens from '../index';
import { activeFonts, cellPx, cssVariables, DS2_PHASE, rowConstants, tailwindPreset, TOKENS_END, v2Css } from '../index';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const V1_BLOCK = fixture('v1-token-block.css').trimEnd();
const V1_PRESET = JSON.parse(fixture('v1-preset.json')) as Record<string, unknown>;

/** True when every key of `sub` exists in `full` with an equal value (recursively). */
function isSubset(sub: unknown, full: unknown, path = ''): string | null {
  if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
    if (!full || typeof full !== 'object') return path;
    for (const [k, v] of Object.entries(sub)) {
      const miss = isSubset(v, (full as Record<string, unknown>)[k], `${path}.${k}`);
      if (miss) return miss;
    }
    return null;
  }
  return JSON.stringify(sub) === JSON.stringify(full) ? null : path;
}

describe('DS2 α is additive (0 pixels change)', () => {
  it('runs in phase 1', () => {
    expect(DS2_PHASE).toBe(1);
  });

  it('the generated block starts with the v1 block, byte for byte', () => {
    const v1Body = V1_BLOCK.slice(0, V1_BLOCK.length - TOKENS_END.length);
    expect(cssVariables().startsWith(v1Body)).toBe(true);
  });

  it('the v2 blocks never declare a variable the v1 block declares', () => {
    const v1Names = new Set([...V1_BLOCK.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
    const v2Names = [...v2Css().matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]);
    expect(v2Names.filter((n) => v1Names.has(n))).toEqual([]);
  });

  it('every v1 Tailwind key keeps its value', () => {
    expect(isSubset(V1_PRESET, JSON.parse(JSON.stringify(tailwindPreset)))).toBeNull();
  });

  it('row constants and --cell-px equal the fallbacks DataTable renders today', () => {
    // apps/web/lib/components/table/DataTable.tsx: h-[var(--row-default,48px)], [--cell-px:16px] …
    expect(rowConstants()).toEqual({ compact: 32, default: 48, touch: 56 });
    expect(cellPx()).toEqual({ compact: 12, default: 16, touch: 16 });
  });

  it('fonts: Heebo stays the face until β; id is not consumed yet', () => {
    expect(activeFonts.ui.startsWith("'Heebo'")).toBe(true);
    expect(activeFonts.num).toBe('var(--font-ui)');
  });

  it('primitives stay private', () => {
    expect('ramp' in tokens).toBe(false);
    expect('radiusPx' in tokens).toBe(false);
  });

  it('the v1 `typography` export (apps/mobile) is untouched', () => {
    expect(tokens.typography.fontFamily.sans).toBe('"Heebo", "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif');
  });
});

describe('DS2 v2 names', () => {
  const css = cssVariables();
  it.each([
    '--c-surface-selected: 235 242 253;',
    '--c-text-primary: 15 31 23;',
    '--c-border-rule: 228 235 231;',
    '--c-action-primary-bg: 6 107 74;',
    '--row-default: 48px;',
    '--decision-row-h: 64px;',
    '--fs-money-hero: 2.5rem;',
    '--chrome-header-h: 56px;',
  ])('emits %s', (decl) => expect(css).toContain(decl));

  it('adds the v2 Tailwind keys', () => {
    const c = tailwindPreset.theme.extend.colors as Record<string, unknown>;
    for (const k of ['canvas', 'fg', 'action', 'viz-cat-1', 'viz-up', 'viz-down', 'viz-prev']) expect(c).toHaveProperty(k);
    expect(tailwindPreset.theme.fontSize).toHaveProperty('money-hero');
    expect(tailwindPreset.theme.fontSize).toHaveProperty('title-lg');
    expect(tailwindPreset.theme.borderRadius).toHaveProperty('chip');
  });

  it('has 14 v2 type roles; with caption, body-sm and body that is the closed 17', () => {
    expect(Object.keys(tokens.typeScaleV2)).toHaveLength(14);
  });
});
