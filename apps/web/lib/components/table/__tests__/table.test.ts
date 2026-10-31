import { describe, expect, it } from 'vitest';
import { toCsv } from '../../views/csv';
import { DESK_COPY } from '../copy';
import { buildExportCsv, exportTable, formatGeneratedAt } from '../exportCsv';
import { formatMoneyFigure, moneyHeader } from '../cells';
import { pageWindow } from '../paging';
import { DEFAULT_BULK_CAP_AGOROT, disabledReason, isOverCap, selectAllIds, summarize, toggleId } from '../selection';
import { ariaSortOf, compareValues, firstSortDesc, nextSort, sortRows } from '../sort';
import type { ColumnDef } from '../types';
import { parseTableState, writeTableState } from '../urlState';

interface R {
  id: string;
  name: string;
  amount: number;
  date: number;
  sev: 'block' | 'warn' | 'none';
}

const rows: R[] = [
  { id: 'a', name: 'תנובה', amount: 12_000, date: 3, sev: 'warn' },
  { id: 'b', name: 'אבי', amount: 50_000, date: 1, sev: 'block' },
  { id: 'c', name: 'גד', amount: -9_000, date: 2, sev: 'none' },
  { id: 'd', name: 'בית', amount: 30_000, date: 4, sev: 'warn' },
];

const cols: ColumnDef<R>[] = [
  { id: 'name', header: 'ספק', identity: true, value: (r) => r.name },
  { id: 'amount', header: 'סכום', kind: 'money', decimals: 2, value: (r) => r.amount },
  { id: 'date', header: 'תאריך', kind: 'date', value: (r) => r.date },
];

describe('sort contract', () => {
  it('₪ and numeric columns sort descending on the first click; text and dates ascending', () => {
    expect(nextSort(null, cols[1]!)).toEqual({ id: 'amount', desc: true });
    expect(nextSort(null, cols[0]!)).toEqual({ id: 'name', desc: false });
    expect(nextSort({ id: 'name', desc: false }, cols[2]!)).toEqual({ id: 'date', desc: false });
    expect(firstSortDesc('number')).toBe(true);
  });
  it('a second click flips; it never cycles back to unsorted', () => {
    const s1 = nextSort(null, cols[1]!);
    const s2 = nextSort(s1, cols[1]!);
    const s3 = nextSort(s2, cols[1]!);
    expect([s1.desc, s2.desc, s3.desc]).toEqual([true, false, true]);
  });
  it('exactly one column carries aria-sort', () => {
    const sort = { id: 'amount', desc: true };
    const aria = cols.map((c) => ariaSortOf(sort, c.id)).filter(Boolean);
    expect(aria).toEqual(['descending']);
  });
  it('sorts money by value (negative last when descending), stably', () => {
    expect(sortRows(rows, cols, { id: 'amount', desc: true }).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortRows(rows, cols, { id: 'name', desc: false }, 'he').map((r) => r.name)).toEqual(['אבי', 'בית', 'גד', 'תנובה']);
    const ties = [{ ...rows[0]!, id: 'x' }, { ...rows[0]!, id: 'y' }];
    expect(sortRows(ties, cols, { id: 'amount', desc: true }).map((r) => r.id)).toEqual(['x', 'y']);
  });
  it('empty values sort last in both directions', () => {
    expect(compareValues(null, 5, false)).toBe(1);
    expect(compareValues(null, 5, true)).toBe(1);
    expect(compareValues('', 'א', true)).toBe(1);
  });
});

describe('useTableUrlState codec', () => {
  it('round-trips sort, cols, sel, peek, view, page and density', () => {
    const state = {
      sort: { id: 'amount', desc: true },
      cols: ['name', 'amount'],
      sel: 'inv-010',
      peek: 'inv-010',
      view: 'block',
      page: 3,
      density: 'compact' as const,
    };
    const qs = writeTableState(state);
    expect(qs.toString()).toBe('sort=amount%3Adesc&cols=name%2Camount&sel=inv-010&peek=inv-010&view=block&page=3&d=compact');
    expect(parseTableState(qs)).toEqual(state);
  });
  it('keeps params it does not own and omits defaults', () => {
    const base = new URLSearchParams('p=last_month&sup=1&page=4');
    const out = writeTableState(parseTableState(new URLSearchParams('')), base);
    expect(out.toString()).toBe('p=last_month&sup=1');
  });
  it('falls back on malformed values', () => {
    const s = parseTableState({ sort: 'amount:sideways', page: '-2', d: 'huge', sel: '<script>', cols: 'a,<b>,c' });
    expect(s).toMatchObject({ sort: null, page: 1, density: null, sel: null, cols: ['a', 'c'] });
  });
});

describe('batch selection (R-12)', () => {
  const rules = {
    rowKey: (r: R) => r.id,
    selectable: (r: R) => (r.sev === 'block' ? { disabled: 'דורש בדיקה פרטנית' } : (true as const)),
    amountAgorot: (r: R) => r.amount,
  };
  it('defaults the per-item cap to ₪200', () => {
    expect(DEFAULT_BULK_CAP_AGOROT).toBe(20_000);
    expect(isOverCap(rules, rows[3]!)).toBe(true);
    expect(isOverCap(rules, rows[2]!)).toBe(false); // |−₪90| is under the cap
  });
  it('block rows are never selectable and carry the visible reason', () => {
    expect(disabledReason(rules, rows[1]!)).toBe('דורש בדיקה פרטנית');
    expect(disabledReason(rules, rows[0]!)).toBeNull();
  });
  it('select-all excludes block rows and rows above the cap', () => {
    expect(selectAllIds(rules, rows)).toEqual(['a', 'c']);
  });
  it('the bar sums Σ|amount| of eligible rows within the cap; over-cap rows are held back', () => {
    const sel = new Set(['a', 'b', 'c', 'd']);
    const s = summarize(rules, rows, sel);
    expect(s.actionable.map((r) => r.id)).toEqual(['a', 'c']);
    expect(s.overCap.map((r) => r.id)).toEqual(['d']);
    expect(s.count).toBe(3); // the block row never counts
    expect(s.sumAgorot).toBe(21_000);
  });
  it('a null cap turns the cap off', () => {
    expect(selectAllIds({ ...rules, capAgorot: null }, rows)).toEqual(['a', 'c', 'd']);
  });
  it('toggles ids immutably', () => {
    const a = new Set(['x']);
    const b = toggleId(a, 'y');
    expect([...a]).toEqual(['x']);
    expect([...toggleId(b, 'x')]).toEqual(['y']);
  });
});

describe('money cells', () => {
  it('fixed decimals per column, ₪ in the header', () => {
    expect(formatMoneyFigure(120_050, 2, 'he')).toBe('1,200.50');
    expect(formatMoneyFigure(1_200, 2, 'en')).toBe('12.00');
    expect(formatMoneyFigure(99_999, 0, 'en')).toBe('1,000');
    expect(moneyHeader('סכום')).toBe('סכום (₪)');
    expect(moneyHeader('סכום (₪)')).toBe('סכום (₪)');
  });
});

describe('ExportMenu CSV', () => {
  const meta = {
    title: 'חשבוניות',
    period: 'אוקטובר 2026',
    scope: 'כפר הזיתים',
    filters: 'חוסמים',
    generatedAt: new Date('2026-10-20T07:05:00Z'), // IDT (UTC+3); DST ends 25.10
  };
  const labels = DESK_COPY.he.exportMeta;
  it('stamps generated-at in Asia/Jerusalem whatever the machine zone', () => {
    expect(formatGeneratedAt(meta.generatedAt)).toBe('20.10.2026 10:05 (Asia/Jerusalem)');
  });
  it('writes period, scope, filters and generated-at rows above the table, then the totals row', () => {
    const out = exportTable(cols, rows, { label: 'סה״כ (4 שורות)', columnId: 'amount', sumAgorot: 83_000 });
    const csv = buildExportCsv(meta, labels, out.columns, out.rows, out.totals);
    const lines = csv.split('\r\n');
    expect(lines.slice(0, 6)).toEqual([
      'חשבוניות',
      'תקופה,אוקטובר 2026',
      'היקף,כפר הזיתים',
      'סינון,חוסמים',
      'הופק,20.10.2026 10:05 (Asia/Jerusalem)',
      '',
    ]);
    expect(lines[6]).toBe('ספק,סכום (₪),תאריך');
    expect(lines[7]).toBe('תנובה,120,3');
    expect(lines[9]).toBe('גד,-90,2'); // a number, so the formula guard never quotes it
    expect(lines.at(-1)).toBe('סה״כ (4 שורות),830,');
  });
  it('reuses the shared escaper (formula injection, quotes)', () => {
    const csv = buildExportCsv({ ...meta, filters: '=HYPERLINK("x")' }, labels, [], []);
    expect(csv.split('\r\n')[3]).toBe(toCsv([{ key: '0', label: 'סינון' }, { key: '1', label: '=HYPERLINK("x")' }], []));
    expect(csv.split('\r\n')[3]).toBe('סינון,"\'=HYPERLINK(""x"")"');
  });
});

describe('paging', () => {
  it('describes the window and clamps out-of-range pages', () => {
    expect(pageWindow(312, 1, 50)).toMatchObject({ from: 1, to: 50, pages: 7 });
    expect(pageWindow(312, 7, 50)).toMatchObject({ from: 301, to: 312, page: 7 });
    expect(pageWindow(312, 99, 50).page).toBe(7);
    expect(pageWindow(0, 1, 50)).toMatchObject({ from: 0, to: 0, pages: 1 });
  });
});

describe('desk copy', () => {
  it('he and en have the same keys', () => {
    expect(Object.keys(DESK_COPY.en).sort()).toEqual(Object.keys(DESK_COPY.he).sort());
    expect(Object.keys(DESK_COPY.en.exportMeta).sort()).toEqual(Object.keys(DESK_COPY.he.exportMeta).sort());
  });
  it('uses the R-12 block reason and the totals label', () => {
    expect(DESK_COPY.he.blockReason).toBe('דורש בדיקה פרטנית');
    expect(DESK_COPY.he.selected(3)).toBe('3 נבחרו');
    expect(DESK_COPY.he.totals(1)).toBe('סה״כ (שורה אחת)');
    expect(DESK_COPY.he.totals(500)).toBe('סה״כ (500 שורות)');
  });
});
