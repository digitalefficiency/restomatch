import { describe, expect, it } from 'vitest';
import {
  DENSITY_BUDGET,
  evaluateDensity,
  figureDrift,
  figureTwice,
  formatFinding,
  newFindings,
  type DensityCounts,
} from '../e2e/ia/budget';
import { DENSITY_SCREENS } from '../e2e/ia/screens';

/** IA-01 — the rule-4 budget table and its evaluator (IA-SPEC §2 rule 4 + rule 7; D7). */

function counts(over: Partial<DensityCounts> = {}): DensityCounts {
  return {
    words: 0,
    pageWords: 0,
    blocks: 0,
    numbers: 0,
    t2: 0,
    primary: 0,
    rows: [],
    figures: [],
    marked: { blocks: false, numbers: false, primary: false, figures: false },
    ...over,
  };
}

describe('DENSITY_BUDGET mirrors IA-SPEC rule 4', () => {
  it('home: ≤5 blocks, ≤20/≤15 numbers, ≤3 T2 (≤1 per row), ≤150/≤60 words', () => {
    const b = DENSITY_BUDGET.home;
    expect(b.blocks).toBe(5);
    expect(b.numbers).toEqual({ desk: 20, phone: 15 });
    expect([b.t2, b.t2PerRow]).toEqual([3, 1]);
    expect(b.words).toEqual({ desk: 150, phone: 60 });
  });
  it('queue: ≤4 numbers and ≤1 T2 per row, ≥10 rows at 1440×900', () => {
    const b = DENSITY_BUDGET.queue;
    expect([b.numbersPerRow, b.t2PerRow, b.minRowsDesk]).toEqual([4, 1, 10]);
  });
  it('record: header + one section, ≤110 words, ≤1 T2', () => {
    const b = DENSITY_BUDGET.record;
    expect([b.blocks, b.words.desk, b.t2]).toEqual([2, 110, 1]);
  });
  it('audit and setup are calm (0 T2); audit may repeat a figure', () => {
    expect(DENSITY_BUDGET.audit.t2).toBe(0);
    expect(DENSITY_BUDGET.setup.t2).toBe(0);
    expect(DENSITY_BUDGET.audit.figureRepeatAllowed).toBe(true);
  });
  it('field: ≤10 numbers, ≤45 words in the fold, ≤100 on the page', () => {
    const b = DENSITY_BUDGET.field;
    expect([b.numbers.phone, b.words.phone, b.pageWords]).toEqual([10, 45, 100]);
  });
  it('D7: one filled primary per viewport wherever a primary exists', () => {
    for (const [type, b] of Object.entries(DENSITY_BUDGET)) {
      if (type !== 'audit') expect(b.primaryPerFold, type).toBe(1);
    }
  });
});

describe('evaluateDensity', () => {
  it('passes a screen exactly at its budget (≤ is inside)', () => {
    expect(evaluateDensity('home', 'desk', counts({ blocks: 5, numbers: 20, t2: 3, words: 150, pageWords: 260, primary: 1 }))).toEqual([]);
  });
  it('flags one over on every capped metric', () => {
    const f = evaluateDensity('home', 'phone', counts({ blocks: 6, numbers: 16, t2: 4, words: 61, pageWords: 261, primary: 2 }));
    expect(f.map((x) => x.metric).sort()).toEqual(['blocks', 'numbers', 'pageWords', 'primaryPerFold', 't2', 'words']);
    expect(f.find((x) => x.metric === 'numbers')).toEqual({ metric: 'numbers', actual: 16, budget: 15 });
  });
  it('uses the viewport-specific cap (20 desk vs 15 phone)', () => {
    expect(evaluateDensity('home', 'desk', counts({ numbers: 16 }))).toEqual([]);
    expect(evaluateDensity('home', 'phone', counts({ numbers: 16 }))).toHaveLength(1);
  });
  it('checks per-row numbers and T2 with the row index', () => {
    const rows = Array.from({ length: 10 }, () => ({ numbers: 4, t2: 1 }));
    rows[3] = { numbers: 5, t2: 2 };
    const f = evaluateDensity('queue', 'desk', counts({ rows }));
    expect(f).toEqual([
      { metric: 'numbersPerRow', actual: 5, budget: 4, where: 3 },
      { metric: 't2PerRow', actual: 2, budget: 1, where: 3 },
    ]);
  });
  it('a desk queue needs ≥10 rows in the fold; phone has no minimum', () => {
    const rows = Array.from({ length: 9 }, () => ({ numbers: 1, t2: 0 }));
    expect(evaluateDensity('queue', 'desk', counts({ rows }))).toEqual([{ metric: 'minRowsDesk', actual: 9, budget: 10 }]);
    expect(evaluateDensity('queue', 'phone', counts({ rows }))).toEqual([]);
  });
  it('an audit screen tolerates numbers and repeats but no T2', () => {
    const figures = [{ id: 'N1', value: '₪760' }, { id: 'N1', value: '₪760' }];
    expect(evaluateDensity('audit', 'desk', counts({ numbers: 400, figures }))).toEqual([]);
    expect(evaluateDensity('audit', 'desk', counts({ t2: 1 }))).toEqual([{ metric: 't2', actual: 1, budget: 0 }]);
  });
  it('rule 7: a figure twice on a home fails', () => {
    const figures = [{ id: 'N1', value: '₪760' }, { id: 'N1', value: '₪760' }, { id: 'N2', value: '₪296' }];
    expect(evaluateDensity('home', 'desk', counts({ figures }))).toEqual([{ metric: 'figureTwice', actual: 2, budget: 1, where: 'N1' }]);
  });
});

describe('figure rules', () => {
  it('figureTwice ignores single occurrences', () => {
    expect(figureTwice([{ id: 'a', value: '1' }, { id: 'b', value: '1' }])).toEqual([]);
  });
  it('figureDrift: one id with two values across screens', () => {
    const f = figureDrift({
      home: [{ id: 'N2', value: '₪296' }],
      approvals: [{ id: 'N2', value: '₪390.20' }],
      leaks: [{ id: 'N1', value: '₪760' }],
      report: [{ id: 'N1', value: ' ₪760 ' }],
    });
    expect(f).toEqual([{ metric: 'figureDrift', actual: 2, budget: 1, where: 'N2' }]);
  });
});

describe('ratchet', () => {
  const findings = [
    { metric: 'blocks' as const, actual: 12, budget: 5 },
    { metric: 'words' as const, actual: 169, budget: 150 },
    { metric: 'minRowsDesk' as const, actual: 6, budget: 10 },
  ];
  it('no allowance → every finding is new', () => {
    expect(newFindings(findings, undefined)).toEqual(findings);
  });
  it('a finding at or under its allowance is not new; above it is', () => {
    expect(newFindings(findings, { blocks: 12, words: 160, minRowsDesk: 6 })).toEqual([findings[1]]);
    expect(newFindings(findings, { blocks: 12, words: 169, minRowsDesk: 7 })).toEqual([findings[2]]);
  });
  it('formats a finding for the log', () => {
    expect(formatFinding({ metric: 'numbersPerRow', actual: 5, budget: 4, where: 3 })).toBe('numbersPerRow @3: 5 > 4');
    expect(formatFinding({ metric: 'minRowsDesk', actual: 6, budget: 10 })).toBe('minRowsDesk: 6 < 10');
  });
});

describe('DENSITY_SCREENS', () => {
  it('covers the five role homes on desk and phone, plus queues and records', () => {
    const homes = DENSITY_SCREENS.filter((s) => s.route === '/dashboard');
    expect(homes).toHaveLength(10);
    expect(DENSITY_SCREENS.some((s) => s.type === 'queue')).toBe(true);
    expect(DENSITY_SCREENS.some((s) => s.type === 'record')).toBe(true);
  });
  it('measures every rule-4 screen type (home, queue, record, audit, field, setup)', () => {
    expect(new Set(DENSITY_SCREENS.map((s) => s.type))).toEqual(new Set(Object.keys(DENSITY_BUDGET)));
  });
  it('ids are unique and every screen names its adopter', () => {
    const ids = DENSITY_SCREENS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of DENSITY_SCREENS) expect(s.adopter).toMatch(/^W\d-\d+|^G-\d+|^H-\d+/);
  });
});

describe('BASELINE_0711 ratchet', () => {
  it('every measured screen has a recorded allowance (possibly empty)', async () => {
    const { BASELINE_0711 } = await import('../e2e/ia/screens');
    for (const s of DENSITY_SCREENS) expect(BASELINE_0711[s.id], s.id).toBeDefined();
  });
});
