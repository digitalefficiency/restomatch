// DS3 · the clean finish (docs/ux/ds3/SPEC.md §2, §4, §8; WORKPLAN DS3-00). Pins every value the
// spec names to the DS2 role that carries it, the T3 move (recovered money is green), the contrast
// the reference holds, and the motion and radius scales DS3 confirms without duplicating.
import { describe, expect, it } from 'vitest';
import {
  action,
  border,
  channels,
  contrastRatio,
  cssVariables,
  elevation,
  focus,
  held,
  indicator,
  moneyStates,
  moneyMarker,
  motion,
  radiusRoles,
  scrim,
  SHADOW_INK,
  status,
  surfaceV2,
  surfaces,
  tailwindPreset,
  text,
  textV2,
  type MoneyState,
  type StatusFamily,
} from '../index';
import { legacyShadow } from '../scale';

/** SPEC §2: reference custom property → value → the DS2 roles that carry it. */
const SPEC_COLOURS: Array<[prop: string, hex: string, roles: Record<string, string>]> = [
  ['--canvas', '#F8FBF9', { 'surfaces.canvas': surfaces.canvas, 'surfaceV2.canvas': surfaceV2.canvas }],
  ['--surface', '#FFFFFF', { 'surfaces.surface': surfaces.surface, 'surfaceV2.default': surfaceV2.default, 'surfaceV2.raised': surfaceV2.raised, 'surfaceV2.overlay': surfaceV2.overlay }],
  ['--sunken', '#F1F5F3', { 'surfaces.sunken': surfaces.sunken, 'status.neutral.bgSubtle': status.neutral.bgSubtle, 'action.secondary.bgHover': action.secondary.bgHover }],
  ['--hover', '#EBF0ED', { 'surfaceV2.hover': surfaceV2.hover, 'status.neutral.bgSubtleHover': status.neutral.bgSubtleHover, 'action.quiet.bgHover': action.quiet.bgHover }],
  ['--rule', '#E2E8E5', { 'border.rule': border.rule }],
  ['--line', '#D4DBD8', { 'surfaces.line': surfaces.line, 'border.subtle': border.subtle, 'status.neutral.borderSubtle': status.neutral.borderSubtle }],
  ['--line-strong', '#808984', { 'surfaces.lineStrong': surfaces.lineStrong, 'border.control': border.control, 'action.secondary.border': action.secondary.border }],
  ['--fg', '#121C17', { 'text.ink': text.ink, 'textV2.primary': textV2.primary, 'action.secondary.fg': action.secondary.fg }],
  ['--fg2', '#49524E', { 'text.muted': text.muted, 'textV2.secondary': textV2.secondary, 'status.neutral.text': status.neutral.text, 'action.quiet.fg': action.quiet.fg }],
  ['--fg3', '#5D6561', { 'text.subtle': text.subtle, 'textV2.tertiary': textV2.tertiary }],
  ['--brand', '#00573B', { 'status.primary.text': status.primary.text, 'status.primary.bgBold': status.primary.bgBold, 'action.primary.bg': action.primary.bg, 'textV2.link': textV2.link }],
  ['--brand-h', '#00452D', { 'status.primary.bgBoldHover': status.primary.bgBoldHover, 'action.primary.bgHover': action.primary.bgHover }],
  ['--brand-sub', '#E0F9ED', { 'status.primary.bgSubtle': status.primary.bgSubtle }],
  ['--brand-bd', '#ADDEC7', { 'status.primary.borderSubtle': status.primary.borderSubtle }],
  ['--leak', '#B7191C', { 'status.danger.text': status.danger.text, 'status.danger.bgBold': status.danger.bgBold, 'action.danger.bg': action.danger.bg }],
  ['--leak-solid', '#DD2729', { 'indicator.danger': indicator.danger, moneyMarker }],
  ['--leak-sub', '#FFF0EE', { 'status.danger.bgSubtle': status.danger.bgSubtle }],
  ['--leak-bd', '#FACAC5', { 'status.danger.borderSubtle': status.danger.borderSubtle }],
  ['--warn', '#925000', { 'status.warn.text': status.warn.text, 'status.warn.bgBold': status.warn.bgBold }],
  ['--warn-solid', '#F2AB19', { 'indicator.warn': indicator.warn }],
  ['--warn-ring', '#B97500', { 'indicator.warnRing': indicator.warnRing }],
  ['--warn-sub', '#FFF6E1', { 'status.warn.bgSubtle': status.warn.bgSubtle }],
  ['--warn-bd', '#F5D79A', { 'status.warn.borderSubtle': status.warn.borderSubtle }],
  // T3: recovered money is green in the clean finish. The family keeps its v1 name (`gold`).
  ['--ok', '#00713E', { 'status.gold.text': status.gold.text, 'status.gold.bgBold': status.gold.bgBold }],
  ['--ok-solid', '#0EA053', { 'indicator.gold': indicator.gold }],
  ['--ok-sub', '#E2FBE9', { 'status.gold.bgSubtle': status.gold.bgSubtle }],
  ['--ok-bd', '#ADE3BF', { 'status.gold.borderSubtle': status.gold.borderSubtle }],
  ['--info / --focus', '#2256BB', { 'status.info.text': status.info.text, 'status.info.bgBold': status.info.bgBold, focus, 'border.focus': border.focus }],
  ['--info-sub', '#ECF4FF', { 'status.info.bgSubtle': status.info.bgSubtle, 'surfaceV2.selected': surfaceV2.selected }],
  ['--info-bd', '#BFD5FD', { 'status.info.borderSubtle': status.info.borderSubtle }],
];

/** Spec values held at today's value because a test outside packages/ui-tokens pins the literal. */
const HELD: Record<string, { today: string; spec: string }> = {
  '--canvas': { today: '#F6F8F7', spec: held.canvas.spec },
  '--line-strong': { today: '#7A8B82', spec: held.lineStrong.spec },
};

describe('DS3 · SPEC §2 colours land on the DS2 roles', () => {
  it.each(SPEC_COLOURS)('%s = %s', (prop, hex, roles) => {
    const want = HELD[prop] ? HELD[prop]!.today : hex;
    if (HELD[prop]) expect(HELD[prop]!.spec, `${prop}: the held role still names the spec value`).toBe(hex);
    for (const [role, value] of Object.entries(roles)) expect(value, role).toBe(want);
  });

  it('held values: exactly canvas and line-strong, each pinned by a named test outside the package', () => {
    expect(Object.keys(held).sort()).toEqual(['canvas', 'lineStrong']);
    expect(held.canvas.pinnedBy).toMatch(/price-creep-digest\.test\.ts:\d+$/);
    expect(held.lineStrong.pinnedBy).toMatch(/W1-09\.spec\.ts:\d+$/);
  });

  it('flipping a held value is safe: the spec value passes the same gates', () => {
    for (const fg of [text.ink, text.muted, text.subtle, status.primary.text, status.danger.text, status.warn.text, status.gold.text, status.info.text, focus]) {
      expect(contrastRatio(fg, held.canvas.spec)).toBeGreaterThanOrEqual(5);
    }
    for (const bg of [surfaces.surface, held.canvas.spec, surfaces.sunken, surfaceV2.hover, surfaceV2.selected]) {
      expect(contrastRatio(held.lineStrong.spec, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the generated block carries the clean values (channels)', () => {
    const css = cssVariables();
    for (const decl of ['--c-bg: 246 248 247;', '--c-ink: 18 28 23;', '--c-focus: 34 86 187;', '--c-gold: 0 113 62;', '--c-danger-dot: 221 39 41;', '--c-warn-dot-ring: 185 117 0;', '--c-surface-hover: 235 240 237;']) {
      expect(css).toContain(decl);
    }
  });

  it('the new roles are Tailwind keys (dots, the ring, the hover surface)', () => {
    const c = tailwindPreset.theme.extend.colors as unknown as Record<string, Record<string, string>>;
    expect(c.danger!.dot).toBe('rgb(var(--c-danger-dot) / <alpha-value>)');
    expect(c.warn!.dot).toBe('rgb(var(--c-warn-dot) / <alpha-value>)');
    expect(c.warn!['dot-ring']).toBe('rgb(var(--c-warn-dot-ring) / <alpha-value>)');
    expect(c.gold!.dot).toBe('rgb(var(--c-gold-dot) / <alpha-value>)');
    expect(c.neutral!.dot).toBe('rgb(var(--c-neutral-dot) / <alpha-value>)');
    expect(c.surface!.hover).toBe('rgb(var(--c-surface-hover) / <alpha-value>)');
  });
});

describe('DS3 · tiers keep their meaning (SPEC §2 rules)', () => {
  const T3: MoneyState[] = ['caught', 'claimed', 'credited', 'returned'];

  it('T3 (good news) is green: caught and returned read the T3 family (leaf), claimed and credited the brand (basil)', () => {
    for (const s of T3) expect(moneyStates[s].tier, s).toBe('T3');
    expect(moneyStates.caught.figure).toBe('gold');
    expect(moneyStates.returned.figure).toBe('gold');
    // Held on `primary` until DS3-01 moves Money's class with its own test (see the DS3-00 PR).
    expect(moneyStates.claimed.figure).toBe('primary');
    expect(moneyStates.credited.figure).toBe('primary');
    for (const s of T3) expect([status.gold.text, status.primary.text], s).toContain(status[moneyStates[s].figure as StatusFamily].text);
    expect(status.gold.text).toBe('#00713E');
    expect(status.primary.text).toBe('#00573B');
  });

  it('`ok` is the T3 family by meaning: the same variables as `gold`', () => {
    const c = tailwindPreset.theme.extend.colors as unknown as Record<string, unknown>;
    const b = tailwindPreset.theme.extend.borderColor as unknown as Record<string, unknown>;
    expect(c.ok).toEqual(c.gold);
    expect(b.ok).toEqual(b.gold);
  });

  it('a money figure is never red: T1 and T2 are ink, T4 and zero are muted', () => {
    for (const [s, m] of Object.entries(moneyStates)) {
      expect(['ink', 'muted', 'gold', 'primary'], s).toContain(m.figure);
      if (m.tier === 'T1' || m.tier === 'T2') expect(m.figure, s).toBe('ink');
      if (m.tier === 'T4' || s === 'zero') expect(m.figure, s).toBe('muted');
    }
  });

  it('pending (T4) is neutral, never a warning colour', () => {
    expect(moneyStates.pending.figure).toBe('muted');
    expect(status.neutral.text).toBe(text.muted);
  });

  it('the action (basil) and good news (leaf) are distinct greens; focus is distinct from both and from danger', () => {
    expect(new Set([status.primary.text, status.gold.text, focus, status.danger.text]).size).toBe(4);
  });
});

describe('DS3 · contrast holds what the reference holds (5:1; lowest 5.42:1)', () => {
  const TEXT_SURFACES = { canvas: surfaces.canvas, surface: surfaces.surface, sunken: surfaces.sunken, hover: surfaceV2.hover, selected: surfaceV2.selected };
  const FAMILIES: StatusFamily[] = ['primary', 'danger', 'warn', 'gold', 'info', 'neutral'];
  const pairs: Array<[string, string, string]> = [];
  for (const [bg, hex] of Object.entries(TEXT_SURFACES)) {
    for (const [fg, f] of Object.entries({ ink: text.ink, muted: text.muted, subtle: text.subtle })) pairs.push([`${fg} on ${bg}`, f, hex]);
    for (const fam of FAMILIES) pairs.push([`${fam} text on ${bg}`, status[fam].text, hex]);
  }
  for (const fam of FAMILIES) {
    const r = status[fam];
    for (const [fg, f] of Object.entries({ ink: text.ink, muted: text.muted, subtle: text.subtle, [`${fam} text`]: r.text })) {
      pairs.push([`${fg} on ${fam} subtle`, f, r.bgSubtle]);
      pairs.push([`${fg} on ${fam} subtle-hover`, f, r.bgSubtleHover]);
    }
    pairs.push([`white on ${fam} bold`, r.onBold, r.bgBold]);
    pairs.push([`white on ${fam} bold-hover`, r.onBold, r.bgBoldHover]);
  }

  it.each(pairs)('%s ≥ 5:1', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(5);
  });

  it('the reference\'s lowest pair (the agorot on a selected row) holds its 5.42:1 (5.415 unrounded)', () => {
    expect(contrastRatio(text.subtle, surfaceV2.selected)).toBeGreaterThanOrEqual(5.41);
  });

  it('non-text: control border, focus and indicators ≥ 3:1 where they sit (the amber dot through its ring)', () => {
    for (const bg of Object.values(TEXT_SURFACES)) {
      expect(contrastRatio(surfaces.lineStrong, bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(focus, bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(indicator.danger, bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(indicator.warnRing, bg)).toBeGreaterThanOrEqual(3);
    }
    for (const bg of [surfaces.canvas, surfaces.surface, surfaces.sunken, surfaceV2.selected]) expect(contrastRatio(indicator.gold, bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(indicator.neutral, surfaces.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe('DS3 · shape, elevation, focus (SPEC §4)', () => {
  it('radii stay D6: control 8 · card 12 · overlay 16 · pill', () => {
    expect(radiusRoles).toEqual({ control: '0.5rem', card: '0.75rem', overlay: '1rem', pill: '9999px' });
  });

  it('a resting card is sh1; every floating layer is sh2 (no border)', () => {
    expect(elevation.e1).toBe('0 1px 2px rgb(18 28 23 / .05)');
    expect(elevation.e2).toBe('0 2px 6px rgb(18 28 23 / .06), 0 12px 28px -10px rgb(18 28 23 / .18)');
    expect(elevation.e3).toBe(elevation.e2);
    expect(legacyShadow.card).toBe(elevation.e1);
  });

  it('shadows and the scrim are tinted with the ink', () => {
    expect(SHADOW_INK).toBe(channels(text.ink));
    expect(scrim).toBe(`rgb(${channels(text.ink)} / .48)`);
    for (const v of [...Object.values(elevation), ...Object.values(legacyShadow)]) expect(v).not.toMatch(/rgba?\(\s*\d+\s*,/);
  });

  it('focus is a 2 px outline with a 2 px offset in the focus colour', () => {
    const css = cssVariables();
    expect(css).toContain('--focus-width: 2px;');
    expect(css).toContain('--focus-offset: 2px;');
    expect(css).toContain(`--c-focus: ${channels(focus)};`);
  });
});

describe('DS3 · density variables express SPEC §7 (the switch itself is DS3-06)', () => {
  const css = cssVariables();
  const block = (head: string) => {
    const at = css.indexOf(head);
    expect(at, head).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('compact: screen titles 20/26 and a queue row\'s block padding 4/5 (regular 7/8)', () => {
    const compact = block("[data-density='compact'] {\n  --fs-cell"); // the v2 block (the v1 one sets --row-h)
    for (const decl of ['--fs-title-lg: 1.25rem;', '--lh-title-lg: 1.625rem;', '--fs-title-md: 1.25rem;', '--lh-title-md: 1.625rem;', '--decision-row-pt: 4px;', '--decision-row-pb: 5px;']) {
      expect(compact).toContain(decl);
    }
    const root = block(':root {\n  --c-surface-canvas');
    expect(root).toContain('--decision-row-pt: 7px;');
    expect(root).toContain('--decision-row-pb: 8px;');
  });

  it('a phone keeps regular density: a coarse pointer undoes every compact type step and dial', () => {
    const floor = css.slice(css.indexOf("@media (pointer: coarse) {\n  [data-density='compact'] {"));
    const body = floor.slice(0, floor.indexOf('}'));
    for (const decl of ['--lh-title-lg: 2rem;', '--decision-row-pt: 7px;', '--decision-row-pb: 8px;', '--btn-h-primary: 40px;', '--chip-h: 24px;', '--nav-item-h: 36px;', '--fs-cell: 0.875rem;']) {
      expect(body).toContain(decl);
    }
    // The floor comes after the compact block, so it wins at equal specificity.
    expect(css.indexOf("@media (pointer: coarse) {\n  [data-density='compact'] {")).toBeGreaterThan(css.indexOf("[data-density='compact'] {"));
  });
});

describe('DS3 · motion is SPEC §8 already (confirmed, not duplicated)', () => {
  it('durations and curves equal the spec table', () => {
    expect(motion.duration).toEqual({ micro: '100ms', short: '150ms', medium: '240ms', long: '400ms' });
    expect(motion.easing).toEqual({
      standard: 'cubic-bezier(0.2,0,0.38,0.9)',
      enter: 'cubic-bezier(0,0,0.38,0.9)',
      exit: 'cubic-bezier(0.2,0,1,0.9)',
    });
  });

  it('no second set of motion variables is emitted', () => {
    const css = cssVariables();
    expect(css).not.toMatch(/--t-(press|state|panel|explain)\b/);
    expect(css).not.toMatch(/--e-(std|out|exit)\b/);
  });
});
