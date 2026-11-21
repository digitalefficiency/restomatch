// DS3 · the clean finish (docs/ux/ds3/SPEC.md §2, §3, §4, §7, §8; WORKPLAN DS3-00, with the handoff's
// correction of 14.11). Pins every value the spec names to the DS2 role that carries it, the T3 move
// (recovered money is its own green role), the contrast the reference holds, the motion scale DS3
// confirms plus the side menu's one named set, and the SPEC §3 steps the v2 type roles now carry.
import { describe, expect, it } from 'vitest';
import {
  action,
  border,
  channels,
  contrastRatio,
  cssVariables,
  elevation,
  focus,
  indicator,
  menuMotion,
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
  typeScaleV2,
  waits,
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
  // T3 (SPEC §2, correction of 14.11): the recovered amount is its own role at the dark green — never
  // the action role — and `--ok` is that family's bold. The family keeps its v1 name (`gold`).
  ['T3 recovered amount', '#00573B', { 'status.gold.text': status.gold.text }],
  ['--ok', '#00713E', { 'status.gold.bgBold': status.gold.bgBold }],
  ['--ok-solid', '#0EA053', { 'indicator.gold': indicator.gold }],
  ['--ok-sub', '#E2FBE9', { 'status.gold.bgSubtle': status.gold.bgSubtle }],
  ['--ok-bd', '#ADE3BF', { 'status.gold.borderSubtle': status.gold.borderSubtle }],
  ['--info / --focus', '#2256BB', { 'status.info.text': status.info.text, 'status.info.bgBold': status.info.bgBold, focus, 'border.focus': border.focus }],
  ['--info-sub', '#ECF4FF', { 'status.info.bgSubtle': status.info.bgSubtle, 'surfaceV2.selected': surfaceV2.selected }],
  ['--info-bd', '#BFD5FD', { 'status.info.borderSubtle': status.info.borderSubtle }],
];

describe('DS3 · SPEC §2 colours land on the DS2 roles', () => {
  it.each(SPEC_COLOURS)('%s = %s', (_prop, hex, roles) => {
    for (const [role, value] of Object.entries(roles)) expect(value, role).toBe(hex);
  });

  it('nothing is held: the canvas and the strong line are live at the spec values', () => {
    expect(surfaces.canvas).toBe('#F8FBF9');
    expect(surfaces.lineStrong).toBe('#808984');
  });

  it('every text role passes 5:1 on the canvas', () => {
    for (const fg of [text.ink, text.muted, text.subtle, status.primary.text, status.danger.text, status.warn.text, status.gold.text, status.info.text, focus]) {
      expect(contrastRatio(fg, surfaces.canvas)).toBeGreaterThanOrEqual(5);
    }
  });

  it('the strong line is a 3:1 boundary on every surface a control sits on', () => {
    for (const bg of [surfaces.surface, surfaces.canvas, surfaces.sunken, surfaceV2.hover, surfaceV2.selected]) {
      expect(contrastRatio(surfaces.lineStrong, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the generated block carries the clean values (channels)', () => {
    const css = cssVariables();
    for (const decl of ['--c-bg: 248 251 249;', '--c-line-strong: 128 137 132;', '--c-ink: 18 28 23;', '--c-focus: 34 86 187;', '--c-gold: 0 113 62;', '--c-gold-text: 0 87 59;', '--c-gold-bold: 0 113 62;', '--c-danger-dot: 221 39 41;', '--c-warn-dot-ring: 185 117 0;', '--c-surface-hover: 235 240 237;']) {
      expect(css).toContain(decl);
    }
  });

  it('the new roles are Tailwind keys: dots for fills, borders, rings and SVG paint — never text', () => {
    const ext = tailwindPreset.theme.extend as unknown as Record<string, Record<string, Record<string, string>>>;
    const fams = ['primary', 'danger', 'warn', 'gold', 'info', 'neutral'];
    for (const key of ['backgroundColor', 'borderColor', 'ringColor', 'fill', 'stroke']) {
      for (const f of fams) expect(ext[key]![f]!.dot, `${key}.${f}.dot`).toBe(`rgb(var(--c-${f}-dot) / <alpha-value>)`);
      expect(ext[key]!.ok!.dot, `${key}.ok.dot`).toBe('rgb(var(--c-gold-dot) / <alpha-value>)');
    }
    expect(ext.ringColor!.warn!['dot-ring']).toBe('rgb(var(--c-warn-dot-ring) / <alpha-value>)');
    // No `text-*-dot`: `colors` (which every text utility reads) carries no indicator.
    for (const f of [...fams, 'ok']) expect(ext.colors![f]!.dot, `colors.${f}.dot`).toBeUndefined();
    expect(ext.colors!.surface!.hover).toBe('rgb(var(--c-surface-hover) / <alpha-value>)');
  });

  it('every status family has the same role set, now with a dot (DS2 §2.2: six families, one role set)', () => {
    const FAMS: StatusFamily[] = ['primary', 'danger', 'warn', 'gold', 'info', 'neutral'];
    const css = cssVariables();
    for (const f of FAMS) {
      expect(Object.keys(status[f]).sort(), f).toEqual(['bgBold', 'bgBoldHover', 'bgSubtle', 'bgSubtleHover', 'borderSubtle', 'dot', 'onBold', 'text']);
      expect(css, f).toContain(`--c-${f}-dot: ${channels(status[f].dot)};`);
    }
    expect(indicator).toEqual({ primary: status.primary.dot, danger: status.danger.dot, warn: status.warn.dot, warnRing: '#B97500', gold: status.gold.dot, info: status.info.dot, neutral: status.neutral.dot });
  });
});

describe('DS3 · tiers keep their meaning (SPEC §2 rules)', () => {
  const T3: MoneyState[] = ['caught', 'claimed', 'credited', 'returned'];

  it('T3 (good news) is green: money that came back (caught, credited, returned) reads the T3 family; claimed reads the brand', () => {
    for (const s of T3) expect(moneyStates[s].tier, s).toBe('T3');
    expect(moneyStates.caught.figure).toBe('gold');
    expect(moneyStates.credited.figure).toBe('gold');
    expect(moneyStates.returned.figure).toBe('gold');
    // Held on `primary`: ds-foundation.test.ts:80 (DS3-01's folder) pins claimed's class (see the DS3-00 PR).
    expect(moneyStates.claimed.figure).toBe('primary');
    for (const s of T3) expect([status.gold.text, status.primary.text], s).toContain(status[moneyStates[s].figure as StatusFamily].text);
    // Its own variable, even though the clean value equals the action colour (SPEC §2).
    const css = cssVariables();
    expect(css).toContain(`--c-gold-text: ${channels(status.gold.text)};`);
    expect(css).toContain(`--c-primary: ${channels(status.primary.text)};`);
  });

  it('only T3 text reads the amount role; every T3 fill, tint, border, ring and gradient stays leaf', () => {
    // So a gold fill beside a primary one never collapses into the action colour (Badge gold vs accent,
    // the recovery funnel, the chain heat bands, the landing gradient, the money-flow motif).
    const css = cssVariables();
    expect(css).toContain(`--c-gold: ${channels(status.gold.bgBold)};`);
    const theme = tailwindPreset.theme as unknown as { extend: Record<string, Record<string, Record<string, string>>> };
    expect(theme.extend.colors!.gold!.DEFAULT).toBe('rgb(var(--c-gold) / <alpha-value>)');
    expect(theme.extend.textColor!.gold!.DEFAULT).toBe('rgb(var(--c-gold-text) / <alpha-value>)');
    expect(status.gold.bgBold).not.toBe(status.primary.bgBold);
  });

  it('`ok` is the good-news family by meaning: `text-ok` is --ok (the T3 bold); tint, border and dot are the T3 family\'s', () => {
    const c = tailwindPreset.theme.extend.colors as unknown as Record<string, Record<string, string>>;
    const b = tailwindPreset.theme.extend.borderColor as unknown as Record<string, unknown>;
    expect(c.ok).toEqual({ ...c.gold, DEFAULT: 'rgb(var(--c-gold-bold) / <alpha-value>)' });
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

  it('the action and --ok are distinct greens; focus is distinct from both and from danger', () => {
    // The T3 amount shares the action's value as its own role (SPEC §2); every T3 fill reads leaf.
    expect(new Set([status.primary.text, status.gold.bgBold, focus, status.danger.text]).size).toBe(4);
    expect(new Set([status.primary.bgBold, status.gold.bgBold]).size).toBe(2);
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
    for (const bg of [surfaces.canvas, surfaces.surface, surfaces.sunken, surfaceV2.selected, status.gold.bgSubtle]) expect(contrastRatio(indicator.gold, bg)).toBeGreaterThanOrEqual(3);
    for (const bg of Object.values(TEXT_SURFACES)) {
      for (const dot of [indicator.primary, indicator.info, indicator.neutral]) expect(contrastRatio(dot, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the one indicator pair below 3:1 is documented and pinned: ok-solid on --hover (2.95:1)', () => {
    // The reference never paints ok-solid on --hover, and a status dot always comes with its word
    // (SPEC §2), so the dot is never the only cue. Listed under "Not done" in the PR; pinned so it cannot slip.
    expect(contrastRatio(indicator.gold, surfaceV2.hover)).toBeGreaterThanOrEqual(2.95);
  });

  it('the v1 tint recipe the product paints most (`bg-{f}/a text-{f}`, a ≤ 12 %) stays ≥ 4.6:1 on surface and canvas', () => {
    // apps/web, 14.11: 28 × `bg-primary/12 text-primary`, 18 × danger, 12 × warn, 5 × info, 4 × gold (Badge) …
    // The re-valued families drive these translucent tints, which no other test reaches. Heavier tints
    // (the chain heat band's `/20`) were already below AA on the canvas on main; the PR lists them as requests.
    const over = (fg: string, a: number, bg: string) => {
      const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
      return `#${[0, 1, 2].map((i) => Math.round(ch(fg, i) * a + ch(bg, i) * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
    };
    for (const f of ['primary', 'danger', 'warn', 'gold', 'info'] as const) {
      // `bg-gold/a` reads the T3 fill (leaf); `text-gold` the amount role.
      const fill = f === 'gold' ? status.gold.bgBold : status[f].text;
      for (const a of [0.05, 0.08, 0.1, 0.12]) {
        for (const bg of [surfaces.surface, surfaces.canvas]) {
          expect(contrastRatio(status[f].text, over(fill, a, bg)), `${f}/${a * 100} on ${bg}`).toBeGreaterThanOrEqual(4.6);
        }
      }
    }
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
    // Every colour of a DS shadow (elevation, the card, the glows) is the ink or a role; Tailwind's
    // deprecated defaults (sm … 2xl) keep their black on purpose.
    const owned = [...Object.values(elevation), legacyShadow.card, ...Object.entries(legacyShadow).filter(([k]) => k.startsWith('glow-')).map(([, v]) => v)];
    for (const v of owned) {
      for (const m of v.matchAll(/rgba?\(([^)]*)\)/g)) expect(m[1]!.startsWith(`${SHADOW_INK} /`) || m[1]!.startsWith('var(--c-'), v).toBe(true);
    }
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

  it('compact: screen titles 20/26, row titles and amounts 14/18, sub-lines 12/16, a queue row 43 px with 4/5 padding', () => {
    const compact = block("[data-density='compact'] {\n  --fs-cell"); // the v2 block (the v1 one sets --row-h)
    for (const decl of [
      '--fs-title-lg: 1.25rem;', '--lh-title-lg: 1.625rem;', '--fs-title-md: 1.25rem;', '--lh-title-md: 1.625rem;',
      '--fs-row-title: 0.875rem;', '--lh-row-title: 1.125rem;', '--fs-row-sub: 0.75rem;', '--lh-row-sub: 1rem;',
      '--decision-row-h: 43px;', '--decision-row-pt: 4px;', '--decision-row-pb: 5px;',
    ]) {
      expect(compact).toContain(decl);
    }
    const root = block(':root {\n  --c-surface-canvas');
    for (const decl of ['--fs-row-title: 0.875rem;', '--lh-row-title: 1.25rem;', '--fw-row-title: 500;', '--fs-row-sub: 0.8125rem;', '--lh-row-sub: 1.125rem;', '--decision-row-h: 52px;', '--decision-row-pt: 7px;', '--decision-row-pb: 8px;']) {
      expect(root).toContain(decl);
    }
  });

  it('selection is sea, never the brand: the selected ring reads --c-info', () => {
    expect(cssVariables()).toContain('--ring-selected: inset 0 0 0 2px rgb(var(--c-info));');
  });

  it('a phone keeps regular density: a coarse pointer undoes every compact type step and dial', () => {
    const floor = css.slice(css.indexOf("@media (pointer: coarse) {\n  [data-density='compact'] {"));
    const body = floor.slice(0, floor.indexOf('}'));
    for (const decl of ['--lh-title-lg: 2rem;', '--lh-row-title: 1.25rem;', '--fs-row-sub: 0.8125rem;', '--decision-row-h: 52px;', '--decision-row-pt: 7px;', '--decision-row-pb: 8px;', '--btn-h-primary: 40px;', '--chip-h: 22px;', '--nav-item-h: 36px;', '--fs-cell: 0.875rem;']) {
      expect(body).toContain(decl);
    }
    // The floor comes after the compact block, so it wins at equal specificity.
    expect(css.indexOf("@media (pointer: coarse) {\n  [data-density='compact'] {")).toBeGreaterThan(css.indexOf("[data-density='compact'] {\n  --fs-cell"));
  });

  it('density is fixed on a touch pointer as a CSS fact: every variable compact sets is undone there', () => {
    // Top-level rules (a rule inside @media is indented), v1 and v2 blocks alike.
    const top = (sel: string) => {
      const vars = new Map<string, string>();
      const open = `\n${sel} {`;
      for (let at = css.indexOf(open); at !== -1; at = css.indexOf(open, at + open.length)) {
        const body = css.slice(at + open.length, css.indexOf('}', at));
        for (const d of body.matchAll(/(--[\w-]+): ([^;]+);/g)) vars.set(d[1]!, d[2]!);
      }
      return vars;
    };
    const compact = top("[data-density='compact']");
    const regular = top("[data-density='default']");
    const touch = top("[data-density='touch']");
    // What a coarse pointer sets for compact, or for every density (v1's touch floor).
    const coarse = new Map<string, string>();
    for (const m of css.matchAll(/@media \(pointer: coarse\) \{\n {2}([^{\n]+) \{([^}]*)\}/g)) {
      if (!/\[data-density(='compact')?\]/.test(m[1]!)) continue;
      for (const d of m[2]!.matchAll(/(--[\w-]+): ([^;]+);/g)) coarse.set(d[1]!, d[2]!);
    }
    expect(compact.size).toBeGreaterThan(25);
    expect([...compact.keys()].filter((v) => !coarse.has(v)), 'compact variables a coarse pointer leaves compact').toEqual([]);
    // Each falls back to the regular value; v1's row and control heights take the touch floor (DS2).
    for (const [v, value] of coarse) {
      if (!compact.has(v)) continue;
      expect([regular.get(v), touch.get(v)], v).toContain(value);
    }
    expect(coarse.get('--cell-px')).toBe('16px');
    expect(coarse.get('--cell-inline')).toBe('16px');
  });

  it("a status pill is 22 px high (SPEC §5) on DS2's chip dial; compact 20 and touch 28 stay", () => {
    const block = (open: string) => {
      const at = css.indexOf(open);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(block("\n[data-density='default'] {\n  --fs-cell")).toContain('--chip-h: 22px;');
    expect(block("\n[data-density='compact'] {\n  --fs-cell")).toContain('--chip-h: 20px;');
    expect(block("\n[data-density='touch'] {\n  --fs-cell")).toContain('--chip-h: 28px;');
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

  it('the one addition is the side menu\'s named set (SPEC §8, sidebar spec §10), emitted once and in Tailwind', () => {
    expect(menuMotion).toEqual({
      duration: { fade: '80ms', tooltip: '90ms', chevron: '120ms', delay: '130ms', collapse: '160ms', expand: '200ms' },
      easing: 'cubic-bezier(0.2,0,0,1)',
    });
    const css = cssVariables();
    for (const [k, v] of Object.entries(menuMotion.duration)) expect(css.split(`--dur-menu-${k}: ${v};`).length - 1, k).toBe(1);
    expect(css.split('--ease-menu: cubic-bezier(0.2,0,0,1);').length - 1).toBe(1);
    // Nothing else adds a duration or a curve. The only other --dur-* names are the two waits (next test).
    const names = (re: RegExp) => [...new Set([...css.matchAll(re)].map((m) => m[1]))].sort();
    expect(names(/--dur-([a-z-]+):/g)).toEqual(['long', 'medium', 'menu-chevron', 'menu-collapse', 'menu-delay', 'menu-expand', 'menu-fade', 'menu-tooltip', 'micro', 'short', 'skeleton-wait', 'tooltip-rest']);
    expect(names(/--ease-([a-z-]+):/g)).toEqual(['enter', 'exit', 'menu', 'standard']);
    const theme = tailwindPreset.theme as unknown as Record<string, Record<string, unknown>>;
    for (const k of Object.keys(menuMotion.duration)) expect(theme.transitionDuration![`menu-${k}`]).toBe(`var(--dur-menu-${k})`);
    expect(theme.transitionTimingFunction!.menu).toBe('var(--ease-menu)');
    expect((theme.extend!.transitionDelay as Record<string, string>).menu).toBe('var(--dur-menu-delay)');
  });

  it('two waits DS3-01 reads by name, each emitted once: the tooltip rest (450 ms) and the skeleton wait (SPEC §9: 1 s)', () => {
    expect(waits).toEqual({ 'tooltip-rest': '450ms', 'skeleton-wait': '1000ms' });
    const css = cssVariables();
    expect(css.split('--dur-tooltip-rest: 450ms;').length - 1).toBe(1);
    expect(css.split('--dur-skeleton-wait: 1000ms;').length - 1).toBe(1);
  });
});

describe('DS3 · the large-text preference (WORKPLAN, "Personal preferences: one contract")', () => {
  it('--text-zoom is 1, and 1.1 under [data-text=\'large\'], as the reference zooms its content', () => {
    const css = cssVariables();
    expect(css).toContain('--text-zoom: 1;');
    expect(css).toMatch(/\[data-text='large'\] \{\n {2}--text-zoom: 1\.1;\n\}/);
  });
});

describe('DS3 · SPEC §3 type steps on the v2 roles (DS3-03\'s requests, and the two the review found)', () => {
  const css = cssVariables();
  const rootBlock = css.slice(css.indexOf(':root {\n  --c-surface-canvas'), css.indexOf('}', css.indexOf(':root {\n  --c-surface-canvas')));
  // Every `@media (min-width: 768px)` block (the v1 one and the v2 one), as text.
  const md = css.split('@media (min-width: 768px) {').slice(1).map((s) => s.slice(0, s.indexOf('\n}'))).join('\n');
  const compact = css.slice(css.indexOf("[data-density='compact'] {\n  --fs-cell"), css.indexOf('}', css.indexOf("[data-density='compact'] {\n  --fs-cell")));

  it('the owner home\'s hero is 84/88 at weight 400, −0.03 em; 64/70 on a phone (mobile first)', () => {
    expect(typeScaleV2['money-hero']).toEqual({ base: { fs: '5.25rem', lh: '5.5rem' }, phone: { fs: '4rem', lh: '4.375rem' }, field: { fs: '4rem', lh: '4.375rem' }, fw: 400, ls: '-0.03em' });
    for (const decl of ['--fs-money-hero: 4rem;', '--lh-money-hero: 4.375rem;', '--fw-money-hero: 400;', '--ls-money-hero: -0.03em;']) expect(rootBlock).toContain(decl);
    for (const decl of ['--fs-money-hero: 5.25rem;', '--lh-money-hero: 5.5rem;']) expect(md).toContain(decl);
  });

  it('the region title (title-sm) is 16/22; the leading figure that is not the hero (money-card) is 28/32 at 600', () => {
    expect(typeScaleV2['title-sm']!.base).toEqual({ fs: '1rem', lh: '1.375rem' });
    expect(typeScaleV2['money-card']!.base).toEqual({ fs: '1.75rem', lh: '2rem' });
    expect(typeScaleV2['money-card']!.fw).toBe(600);
    for (const decl of ['--lh-title-sm: 1.375rem;', '--lh-money-card: 2rem;', '--fw-money-card: 600;']) expect(rootBlock).toContain(decl);
  });

  it('`sub` is 13/18 in every density; `lead` is 18/24 at weight 500', () => {
    for (const decl of ['--fs-sub: 0.8125rem;', '--lh-sub: 1.125rem;', '--fw-sub: 400;', '--fs-lead: 1.125rem;', '--lh-lead: 1.5rem;', '--fw-lead: 500;']) expect(rootBlock).toContain(decl);
    expect(compact).not.toContain('--fs-sub:');
    expect(compact).not.toContain('--fs-lead:');
  });
});
