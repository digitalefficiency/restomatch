import { describe, expect, it } from 'vitest';
import { HERO_ENTRY_CSS, SPLIT_MIN_AGOROT, agorotOf, calcRowsGuard, heroMonthKey, heroSplitForm, type CalcReport } from '../model';

describe('heroMonthKey — the month owner.leakReport reads is the hero’s own (v2 A1)', () => {
  it('Israel November: bounds 31.10 22:00Z → 30.11 22:00Z → "2026-11" (never monthStart.slice(0, 7))', () => {
    expect(heroMonthKey('2026-10-31T22:00:00.000Z', '2026-11-30T22:00:00.000Z')).toBe('2026-11');
    expect('2026-10-31T22:00:00.000Z'.slice(0, 7)).toBe('2026-10'); // the trap it avoids
  });
  it('a month with a clock change (October: summer start, winter end) and a short month', () => {
    expect(heroMonthKey('2026-09-30T21:00:00.000Z', '2026-10-31T22:00:00.000Z')).toBe('2026-10');
    expect(heroMonthKey('2026-01-31T22:00:00.000Z', '2026-02-28T22:00:00.000Z')).toBe('2026-02');
  });
  it('a zone east of UTC+12 still lands in its month', () => {
    expect(heroMonthKey('2026-10-31T10:00:00.000Z', '2026-11-30T11:00:00.000Z')).toBe('2026-11'); // Pacific/Kiritimati-like
  });
  it('bounds that do not parse → null, never a guessed month', () => {
    expect(heroMonthKey('', '2026-11-30T22:00:00.000Z')).toBeNull();
    expect(heroMonthKey('soon', 'later')).toBeNull();
  });
});

describe('calcRowsGuard — the calculation rows prove THIS hero or they do not show (v4 H3)', () => {
  const MONTH_START = '2026-10-31T22:00:00.000Z';
  // The lab report (21.11): 7 + 6 + 1 + 1 gaps, Σ = ₪769.77 = the hero, no cap.
  const lab: CalcReport = {
    hero: { monthStart: MONTH_START, leakIls: 769.77 },
    byType: [{ amountIls: 400.82 }, { amountIls: 284.29 }, { amountIls: 72 }, { amountIls: 12.66 }],
    capAdjustmentIls: 0,
  };

  it('the lab report under the lab hero', () => expect(calcRowsGuard(lab, MONTH_START, 76977)).toBe(true));

  it('a capped month: rows ₪148, cap ₪30, total ₪118 (leak-report.test.ts:166)', () => {
    const capped: CalcReport = { hero: { monthStart: MONTH_START, leakIls: 118 }, byType: [{ amountIls: 100 }, { amountIls: 48 }], capAdjustmentIls: 30 };
    expect(calcRowsGuard(capped, MONTH_START, 11800)).toBe(true);
    // The same rows without the cap would not prove ₪118.
    expect(calcRowsGuard({ ...capped, capAdjustmentIls: 0 }, MONTH_START, 11800)).toBe(false);
    // Nor do they prove a hero that moved since the page loaded.
    expect(calcRowsGuard(capped, MONTH_START, 14800)).toBe(false);
  });

  it('a match landed between the two reads: the report’s total is not the hero on the page', () => {
    const moved: CalcReport = { ...lab, hero: { ...lab.hero, leakIls: 780.01 }, byType: [...lab.byType, { amountIls: 10.24 }] };
    expect(calcRowsGuard(moved, MONTH_START, 76977)).toBe(false);
  });

  it('another month (e.g. the panel opened after midnight on the 1st) never stands under this hero', () => {
    expect(calcRowsGuard({ ...lab, hero: { ...lab.hero, monthStart: '2026-11-30T22:00:00.000Z' } }, MONTH_START, 76977)).toBe(false);
  });

  it('rows that do not make the report’s own total', () => {
    expect(calcRowsGuard({ ...lab, byType: lab.byType.slice(1) }, MONTH_START, 76977)).toBe(false);
  });

  it('compares instants, not spellings, and agorot, not floats', () => {
    expect(calcRowsGuard({ ...lab, hero: { ...lab.hero, monthStart: '2026-10-31T22:00:00Z' } }, MONTH_START, 76977)).toBe(true);
    const floats: CalcReport = { hero: { monthStart: MONTH_START, leakIls: 0.3 }, byType: [{ amountIls: 0.1 }, { amountIls: 0.2 }], capAdjustmentIls: 0 };
    expect(calcRowsGuard(floats, MONTH_START, agorotOf(0.3))).toBe(true);
    expect(calcRowsGuard({ ...lab, hero: { ...lab.hero, monthStart: 'nope' } }, 'nope', 76977)).toBe(false);
  });
});

describe('heroSplitForm — the bar only when both parts are worth printing (v2 C2)', () => {
  it('both parts at ₪0.50 or more → the bar, sized by the agorot', () => {
    expect(heroSplitForm([{ agorot: 30866 }, { agorot: 46111 }])).toEqual({ kind: 'bar', first: 30866, second: 46111 });
    expect(heroSplitForm([{ agorot: SPLIT_MIN_AGOROT }, { agorot: SPLIT_MIN_AGOROT }]).kind).toBe('bar');
  });
  it('both parts above ₪0 but one under ₪0.50 (a sliver, "₪0" at whole shekels) → the two values, no bar', () => {
    expect(heroSplitForm([{ agorot: 49 }, { agorot: 76928 }])).toEqual({ kind: 'values' });
    expect(heroSplitForm([{ agorot: 76928 }, { agorot: 1 }])).toEqual({ kind: 'values' });
    expect(heroSplitForm([{ agorot: 30 }, { agorot: 20 }])).toEqual({ kind: 'values' });
  });
  it('one line only when the other part is exactly ₪0 ("all of it" must be true)', () => {
    expect(heroSplitForm([{ agorot: 76977 }, { agorot: 0 }])).toEqual({ kind: 'single', index: 0 });
    expect(heroSplitForm([{ agorot: 0 }, { agorot: 76977 }])).toEqual({ kind: 'single', index: 1 });
    expect(heroSplitForm([{ agorot: 0 }, { agorot: 0 }])).toEqual({ kind: 'single', index: 0 });
  });
  it('strings without agorot (the showcase) → the legend alone; nothing → none', () => {
    expect(heroSplitForm([{}, {}])).toEqual({ kind: 'legend' });
    expect(heroSplitForm([{ agorot: 100 }, {}])).toEqual({ kind: 'legend' });
    expect(heroSplitForm([{ agorot: 100 }])).toEqual({ kind: 'legend' });
    expect(heroSplitForm([])).toEqual({ kind: 'none' });
    expect(heroSplitForm(undefined)).toEqual({ kind: 'none' });
  });
});

describe('HERO_ENTRY_CSS — once, on the tokens, never under reduced motion (v4 H1)', () => {
  const block = (css: string) => {
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference){');
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) return { start, end: i };
    }
    return { start, end: -1 };
  };

  it('every animation sits inside the no-preference block, scoped to the hero section with data-entry', () => {
    const { start, end } = block(HERO_ENTRY_CSS);
    expect(start).toBe(0);
    const inside = HERO_ENTRY_CSS.slice(start, end + 1);
    const outside = HERO_ENTRY_CSS.slice(end + 1);
    expect(outside).not.toMatch(/animation:/);
    for (const rule of inside.match(/[^{}]+\{animation:[^}]+\}/g) ?? []) {
      expect(rule).toMatch(/^section\[aria-labelledby="leak-hero-label"\]\[data-entry\] /);
    }
    expect(inside.match(/animation:/g)).toHaveLength(4);
  });

  it('the number is never held or counted: no rule targets it (owner decision 28.11 — a money figure only ever shows its true value)', () => {
    expect(HERO_ENTRY_CSS).not.toMatch(/data-entry-part="count"/);
    expect(HERO_ENTRY_CSS).not.toMatch(/opacity:0\}\}/);
    expect(HERO_ENTRY_CSS).not.toMatch(/\[data-entry\] \[data-entry-part\]\{/);
  });

  it('the pace line draws, fades and pops; the split bar grows — from the tokens, no literal time', () => {
    expect(HERO_ENTRY_CSS).toMatch(/"draw"\]\{animation:rm-hero-draw var\(--dur-long\) var\(--ease-standard\) both\}/);
    expect(HERO_ENTRY_CSS).toMatch(/"fade"\]\{animation:rm-hero-fade var\(--dur-medium\) linear both\}/);
    expect(HERO_ENTRY_CSS).toMatch(/"pop"\]\{animation:rm-hero-pop var\(--dur-short\) var\(--ease-enter\) calc\(var\(--dur-long\) - var\(--dur-short\)\) backwards\}/);
    expect(HERO_ENTRY_CSS).toMatch(/\[data-split-bar\]\{animation:rm-hero-grow var\(--dur-long\) var\(--ease-enter\) both\}/);
    expect(HERO_ENTRY_CSS).not.toMatch(/\d+m?s\b/);
    expect(HERO_ENTRY_CSS).not.toMatch(/cubic-bezier/);
  });

  it('its keyframes are rm-hero-* (globals.css already has rm-draw)', () => {
    const names = [...HERO_ENTRY_CSS.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(['rm-hero-draw', 'rm-hero-fade', 'rm-hero-grow', 'rm-hero-pop']);
    for (const used of HERO_ENTRY_CSS.matchAll(/animation:([\w-]+)/g)) expect(names).toContain(used[1]);
  });
});
