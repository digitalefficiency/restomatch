/**
 * IA-01 — the density budget per screen type (IA-SPEC §2 rule 4, kit branch 7.11) as data,
 * plus a pure evaluator. No Playwright import: the vitest gate (test/ia-density.test.ts)
 * unit-tests every boundary, and e2e/IA-01.spec.ts feeds it what e2e/ia/meter.ts counted.
 *
 * Everything is counted in the FIRST FOLD (the viewport after load, folds closed), except
 * `pageWords`. Rule 6 says one primary per card; owner decision D7 (7.11) tightens it to
 * one FILLED primary per viewport, so `primaryPerFold` is 1 on every type that has one.
 */

export type ScreenType = 'home' | 'queue' | 'record' | 'audit' | 'field' | 'setup';
export type Viewport = 'desk' | 'phone';

export const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desk: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

/** `null` = rule 4 sets no cap for this metric on this screen type. */
export interface DensityBudget {
  /** Blocks (cards / sections) intersecting the fold. */
  blocks: number | null;
  /** ₪ figures and other numbers in the fold. */
  numbers: Record<Viewport, number | null>;
  /** Numbers in one row / card. */
  numbersPerRow: number | null;
  /** T2 (danger / warn) marks on the screen, in the fold. */
  t2: number | null;
  /** T2 marks in one row / card. */
  t2PerRow: number | null;
  /** Visible words in the fold (explanations included). */
  words: Record<Viewport, number | null>;
  /** Visible words on the whole page (folds closed). */
  pageWords: number | null;
  /** Filled primary buttons in the fold (D7: one per viewport). */
  primaryPerFold: number | null;
  /** Queues only: rows visible at 1440×900. A MINIMUM, not a cap. */
  minRowsDesk?: number;
  /** Audit screens are exempt from "a figure twice on one screen" (each figure still once). */
  figureRepeatAllowed: boolean;
}

export const DENSITY_BUDGET: Record<ScreenType, DensityBudget> = {
  // בית: ≤5 blocks · ≤20 / ≤15 numbers · T2 ≤3 (≤1 per row) · 0 paragraphs (W2-16: ≤150 desk / ≤60 phone).
  home: {
    blocks: 5,
    numbers: { desk: 20, phone: 15 },
    numbersPerRow: null,
    t2: 3,
    t2PerRow: 1,
    words: { desk: 150, phone: 60 },
    pageWords: 260,
    primaryPerFold: 1,
    figureRepeatAllowed: false,
  },
  // תור: one summary row + rows (≥10 at 1440×900) · ≤4 numbers per row · T2 ≤1 per row · calc line ≤12 words.
  queue: {
    blocks: null,
    numbers: { desk: null, phone: null },
    numbersPerRow: 4,
    t2: null,
    t2PerRow: 1,
    words: { desk: null, phone: null },
    pageWords: null,
    primaryPerFold: 1,
    minRowsDesk: 10,
    figureRepeatAllowed: false,
  },
  // רשומה: header + one section · header ≤6 numbers, ≤4 per row · T2 ≤1 in the header · ≤110 words in the fold.
  record: {
    blocks: 2,
    numbers: { desk: null, phone: null },
    numbersPerRow: 4,
    t2: 1,
    t2PerRow: 1,
    words: { desk: 110, phone: 110 },
    pageWords: 320,
    primaryPerFold: 1,
    figureRepeatAllowed: false,
  },
  // ביקורת: no number cap, every figure once · 0 T2 (a calm screen) · print / export / share.
  audit: {
    blocks: null,
    numbers: { desk: null, phone: null },
    numbersPerRow: null,
    t2: 0,
    t2PerRow: 0,
    words: { desk: null, phone: null },
    pageWords: null,
    primaryPerFold: null,
    figureRepeatAllowed: true,
  },
  // שטח: the next item + one 56px button · ≤10 numbers · T2 ≤1 · ≤45 words in the fold, ≤100 on the page.
  field: {
    blocks: 2,
    numbers: { desk: 10, phone: 10 },
    numbersPerRow: null,
    t2: 1,
    t2PerRow: 1,
    words: { desk: 45, phone: 45 },
    pageWords: 100,
    primaryPerFold: 1,
    figureRepeatAllowed: false,
  },
  // הגדרה: state row first, forms folded · 0 T2 · one save per form.
  setup: {
    blocks: null,
    numbers: { desk: null, phone: null },
    numbersPerRow: null,
    t2: 0,
    t2PerRow: 0,
    words: { desk: null, phone: null },
    pageWords: null,
    primaryPerFold: 1,
    figureRepeatAllowed: false,
  },
};

/** One row / card the meter found in the fold. */
export interface RowCount {
  numbers: number;
  t2: number;
}

/** A `data-figure` occurrence (`<Money data-figure="N1">`) and the value it printed. */
export interface FigureMark {
  id: string;
  value: string;
}

export interface DensityCounts {
  words: number;
  pageWords: number;
  blocks: number;
  numbers: number;
  t2: number;
  primary: number;
  rows: RowCount[];
  figures: FigureMark[];
  /** Which counts came from `data-*` marks vs heuristics (report only). */
  marked: { blocks: boolean; numbers: boolean; primary: boolean; figures: boolean };
}

export type Metric =
  | 'blocks'
  | 'numbers'
  | 'numbersPerRow'
  | 't2'
  | 't2PerRow'
  | 'words'
  | 'pageWords'
  | 'primaryPerFold'
  | 'minRowsDesk'
  | 'figureTwice'
  | 'figureDrift';

export interface Finding {
  metric: Metric;
  actual: number;
  budget: number;
  /** Row index for per-row metrics; the figure id for figure metrics. */
  where?: number | string;
}

function over(metric: Metric, actual: number, budget: number | null, where?: number | string): Finding[] {
  if (budget === null || actual <= budget) return [];
  return [where === undefined ? { metric, actual, budget } : { metric, actual, budget, where }];
}

/** Every rule-4 breach of one measured screen. Empty = within budget. */
export function evaluateDensity(type: ScreenType, vp: Viewport, c: DensityCounts): Finding[] {
  const b = DENSITY_BUDGET[type];
  const out: Finding[] = [
    ...over('blocks', c.blocks, b.blocks),
    ...over('numbers', c.numbers, b.numbers[vp]),
    ...over('t2', c.t2, b.t2),
    ...over('words', c.words, b.words[vp]),
    ...over('pageWords', c.pageWords, b.pageWords),
    ...over('primaryPerFold', c.primary, b.primaryPerFold),
  ];
  c.rows.forEach((row, i) => {
    out.push(...over('numbersPerRow', row.numbers, b.numbersPerRow, i));
    out.push(...over('t2PerRow', row.t2, b.t2PerRow, i));
  });
  if (b.minRowsDesk !== undefined && vp === 'desk' && c.rows.length < b.minRowsDesk) {
    out.push({ metric: 'minRowsDesk', actual: c.rows.length, budget: b.minRowsDesk });
  }
  if (!b.figureRepeatAllowed) out.push(...figureTwice(c.figures));
  return out;
}

/** Rule 7: a figure id printed twice on one (non-audit) screen. */
export function figureTwice(figures: FigureMark[]): Finding[] {
  const n = new Map<string, number>();
  for (const f of figures) n.set(f.id, (n.get(f.id) ?? 0) + 1);
  return [...n].filter(([, k]) => k > 1).map(([id, k]) => ({ metric: 'figureTwice' as const, actual: k, budget: 1, where: id }));
}

/**
 * IA-SPEC §8: one figure id carries the same value, to the agora, on every screen of one
 * role and seed. Input: screen id → its figures. Returns one finding per drifting id.
 */
export function figureDrift(byScreen: Record<string, FigureMark[]>): Finding[] {
  const values = new Map<string, Set<string>>();
  for (const figs of Object.values(byScreen)) {
    for (const f of figs) {
      const set = values.get(f.id) ?? new Set<string>();
      set.add(f.value.replace(/\s+/g, ' ').trim());
      values.set(f.id, set);
    }
  }
  return [...values]
    .filter(([, v]) => v.size > 1)
    .map(([id, v]) => ({ metric: 'figureDrift' as const, actual: v.size, budget: 1, where: id }));
}

/**
 * Ratchet (report → warn → block): an allowance per screen and metric, from the first
 * measurement. A finding is "new" only when it exceeds the recorded allowance. Owners
 * lower their screen's allowance as they adopt the budget; never raise it.
 */
export type Allowance = Partial<Record<Metric, number>>;

export function newFindings(findings: Finding[], allow: Allowance | undefined): Finding[] {
  if (!allow) return findings;
  return findings.filter((f) => {
    const cap = allow[f.metric];
    if (cap === undefined) return true;
    return f.metric === 'minRowsDesk' ? f.actual < cap : f.actual > cap;
  });
}

/** A plain one-line summary for the spec's log. */
export function formatFinding(f: Finding): string {
  const at = f.where === undefined ? '' : ` @${f.where}`;
  const op = f.metric === 'minRowsDesk' ? '<' : '>';
  return `${f.metric}${at}: ${f.actual} ${op} ${f.budget}`;
}
