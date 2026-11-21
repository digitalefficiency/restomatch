// DS3-04 §7.1 (S1): the desk primitives as static markup (react-dom/server, as ds3-density.test.ts).
import '../../__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchTable, type MatchCellView, type MatchTableProps } from '../MatchTable';
import { UndoToast, type UndoToastProps } from '../UndoToast';

// Loosely typed createElement: two @types/react majors are hoisted in the workspace (STATE.md).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const classOf = (html: string, marker: string) => html.match(new RegExp(`${marker}[^>]*class="([^"]*)"`))?.[1] ?? '';

describe('MatchTable — ordered · received · billed', () => {
  // A cell's content is the prop's own node type (the global React namespace's, as every component here).
  const node = (el: ReactElement) => el as unknown as MatchCellView['content'];
  const bdi = (s: string) => node(h('bdi', null, s));
  const props = (o: Partial<MatchTableProps> = {}): MatchTableProps => ({
    caption: 'השוואה בין מה שהוזמן, מה שהתקבל ומה שחויב',
    columns: [{ label: 'הוזמן', sub: 'הזמנה מ־14.10.2026' }, { label: 'התקבל' }, { label: 'חויב', sub: 'חשבונית SH-24121' }],
    rows: [
      {
        label: 'כמות',
        cells: [
          { cell: 'ordered', content: bdi('9.5') },
          { cell: 'received', content: bdi('6.5'), flagged: true, gap: '3 ק״ג פחות' },
          { cell: 'billed', content: bdi('9.5') },
        ],
      },
      {
        label: 'מחיר ליחידה',
        sub: 'לפני מע״מ',
        cells: [
          { cell: 'ordered', content: bdi('12.90') },
          { cell: 'received', content: node(h('span', { className: 'text-caption text-fg-tertiary' }, 'אין מחיר בקבלת הסחורה')) },
          { cell: 'billed', content: bdi('12.90') },
        ],
      },
    ],
    tone: 'leak',
    compact: false,
    layout: 'responsive',
    ...o,
  });
  const table = (o: Partial<MatchTableProps> = {}) => renderToStaticMarkup(h(MatchTable, { ...props(o) }));

  it('a real table: sr-only caption, three column heads, two row heads, exactly one flagged cell', () => {
    const html = table();
    expect(html).toMatch(/^<div data-testid="match-table" class="[^"]*">/);
    expect(html).toContain('<table class="w-full table-fixed border-separate border-spacing-0 text-start">');
    expect(html).toContain('<caption class="sr-only">השוואה בין מה שהוזמן, מה שהתקבל ומה שחויב</caption>');
    expect(count(html, /<th scope="col"/g)).toBe(3);
    expect(count(html, /<th scope="row"/g)).toBe(2);
    expect(count(html, /data-testid="match-cell-off"/g)).toBe(1);
    expect(html).toMatch(/<td data-testid="match-cell-off" data-cell="received" class="/);
    // every value cell keeps tabular digits (§11.1)
    expect(count(html, /<td class="num |<td data-testid="match-cell-off" data-cell="[a-z]+" class="num /g)).toBe(6);
  });

  it('the tone tints the flagged cell only; values stay ink, only the written gap carries the tone', () => {
    const html = table();
    const flagged = classOf(html, 'data-testid="match-cell-off"');
    expect(flagged).toContain('bg-danger-subtle');
    expect(flagged).toContain('shadow-[inset_0_0_0_1px_rgb(var(--c-danger-border-subtle))]');
    expect(flagged).toContain('forced-colors:[outline:var(--focus-width)_solid_Highlight]');
    expect(flagged).toContain('forced-colors:[outline-offset:calc(var(--focus-width)*-1)]');
    expect(flagged.split(' ')).toEqual(expect.arrayContaining(['font-semibold', 'text-fg']));
    expect(flagged).not.toContain('text-danger');
    expect(count(html, /bg-danger-subtle/g)).toBe(1);
    // no text-danger on any value: the one red is the gap (a quantity, never a ₪)
    expect(count(html, /text-danger/g)).toBe(1);
    expect(html).toMatch(/<span class="[^"]*\btext-danger\b[^"]*">3 ק״ג פחות<\/span>/);
    for (const v of ['9.5', '6.5', '12.90']) expect(html).toContain(`<bdi>${v}</bdi>`);
    expect(classOf(table({ tone: 'warn' }), 'data-testid="match-cell-off"')).toContain('bg-warn-subtle');
    expect(table({ tone: 'warn' })).toMatch(/<span class="[^"]*\btext-warn\b[^"]*">3 ק״ג פחות<\/span>/);
    const neutral = classOf(table({ tone: 'neutral' }), 'data-testid="match-cell-off"');
    expect(neutral).toContain('bg-surface-sunken');
    expect(neutral).toContain('shadow-[inset_0_0_0_1px_rgb(var(--c-neutral-border-subtle))]');
  });

  it('a MatchRow.sub renders under its row header; column subs under their labels', () => {
    const html = table();
    expect(html).toMatch(/<th scope="row" class="[^"]*">מחיר ליחידה<span class="block text-caption text-fg-tertiary">לפני מע״מ<\/span><\/th>/);
    expect(html).toMatch(/<th scope="row" class="[^"]*">כמות<\/th>/);
    expect(html).toContain('<b class="block text-body-sm font-semibold text-fg">הוזמן</b><span class="block truncate text-caption text-fg-tertiary max-xl:hidden">הזמנה מ־14.10.2026</span>');
  });

  it('layout="narrow" (the landing) emits no xl: class and hides the column sub-captions', () => {
    const html = table({ layout: 'narrow', compact: true });
    expect(html).not.toMatch(/xl:/);
    expect(html).toContain('<col class="w-[3.625rem]"/>');
    expect(html).not.toContain('הזמנה מ־14.10.2026');
    expect(html).toContain('<span class="block text-caption text-fg-tertiary">לפני מע״מ</span>');
    expect(count(html, /data-testid="match-cell-off"/g)).toBe(1);
  });

  it('compact (xl only) adds the desk-scoped compact classes only when the desk is compact', () => {
    const compact = table({ compact: true });
    expect(compact).toContain('xl:group-data-[density=compact]/desk:mt-3');
    expect(compact).toContain('xl:group-data-[density=compact]/desk:py-1.5');
    expect(table({ compact: false })).not.toContain('group-data-[density=compact]');
    expect(table()).toContain('<col class="w-[7.25rem] max-xl:w-[3.625rem]"/>');
  });
});

describe('UndoToast — the dark toast with the time left', () => {
  const toast = (o: Partial<UndoToastProps> = {}) =>
    renderToStaticMarkup(
      h(UndoToast, {
        text: 'נוסף לבקשת הזיכוי · 38.70 ₪ לפני מע״מ',
        undoLabel: 'בטלו',
        capAt: Date.now() + 12_000,
        visibleMs: 10_000,
        failedMs: 5_000,
        failed: false,
        busy: false,
        instant: false,
        keyHint: true,
        placement: 'queue',
        onUndo: () => {},
        onExpire: () => {},
        ...o,
      } satisfies UndoToastProps),
    );

  it('root: testid, the on-dark focus ring, running with 10 s left, the forced-colours edge', () => {
    const html = toast();
    expect(html).toMatch(/^<div data-testid="approvals-undo" data-focus="on-dark" data-undo-state="running" data-undo-left-ms="10000" class="/);
    const root = classOf(html, 'data-testid="approvals-undo"');
    expect(root).toContain('forced-colors:border forced-colors:border-[color:ButtonText]');
    expect(root.split(' ')).toEqual(expect.arrayContaining(['bg-fg', 'text-on-bold', 'rounded-card', 'shadow-e2', 'flex-none']));
    expect(root).toContain('motion-safe:animate-[rm-toast-in_var(--dur-medium)_var(--ease-enter)]');
    expect(html).toContain('<p class="min-w-0 truncate">נוסף לבקשת הזיכוי · 38.70 ₪ לפני מע״מ</p>');
    expect(html).not.toMatch(/aria-live|role="status"|role="alert"/); // the desk's announcer speaks
  });

  it('the Z cap and aria-keyshortcuts only with keyHint', () => {
    const on = toast({ keyHint: true });
    expect(on).toMatch(/<button type="button" data-testid="approvals-undo-button" aria-keyshortcuts="Z" class="[^"]*">בטלו<kbd[^>]*data-kbd=""[^>]*>Z<\/kbd><\/button>/);
    const off = toast({ keyHint: false });
    expect(off).toContain('data-testid="approvals-undo-button"');
    expect(off).not.toContain('aria-keyshortcuts');
    expect(off).not.toContain('data-kbd');
  });

  it('the undo button is a 44 × 44 target on a coarse pointer, and always in the bar', () => {
    const queue = classOf(toast(), 'data-testid="approvals-undo-button"').split(' ');
    expect(queue).toEqual(expect.arrayContaining(['min-h-7', 'min-w-7', '[@media(pointer:coarse)]:min-h-11', '[@media(pointer:coarse)]:min-w-11']));
    expect(queue).not.toContain('min-w-11');
    const barHtml = toast({ placement: 'bar' });
    const bar = classOf(barHtml, 'data-testid="approvals-undo-button"').split(' ');
    expect(bar).toEqual(expect.arrayContaining(['min-h-11', 'min-w-11', '[@media(pointer:coarse)]:min-w-11']));
    // never stacked with the 28 px floor: Tailwind emits .min-h-11 before .min-h-7, so the floor would win
    expect(bar).not.toContain('min-h-7');
    expect(bar).not.toContain('min-w-7');
    const barRoot = classOf(barHtml, 'data-testid="approvals-undo"').split(' ');
    expect(barRoot).toContain('w-full');
    expect(barRoot).not.toContain('shadow-e2');
  });

  it('the time-left line: aria-hidden, shrinking toward the start, CanvasText in forced colours', () => {
    const html = toast();
    expect(html).toMatch(/<i aria-hidden="true" data-testid="undo-line" style="transform:scaleX\(1\)" class="[^"]*"><\/i>/);
    const line = classOf(html, 'data-testid="undo-line"').split(' ');
    expect(line).toEqual(
      expect.arrayContaining(['h-0.5', 'bg-on-bold/60', 'ltr:origin-left', 'rtl:origin-right', 'forced-color-adjust-none', 'forced-colors:bg-[CanvasText]']),
    );
  });

  it('failed → the text only: no button, no line', () => {
    const html = toast({ failed: true, text: 'כבר אי אפשר לבטל.' });
    expect(html).toContain('data-undo-state="failed"');
    expect(html).toContain('data-undo-left-ms="0"');
    expect(html).not.toContain('approvals-undo-button');
    expect(html).not.toContain('undo-line');
    expect(html).toContain('<p class="min-w-0 truncate">כבר אי אפשר לבטל.</p>');
  });

  it('busy disables the button (no text change); instant drops the entry animation', () => {
    expect(toast({ busy: true })).toMatch(/<button type="button" data-testid="approvals-undo-button" disabled="" aria-keyshortcuts="Z" class="[^"]*">בטלו</);
    expect(toast({ instant: true })).not.toContain('rm-toast-in');
  });

  it('a slow mount keeps the cap: 2 s left of the visible window when the cap is 2 s away', () => {
    expect(toast({ capAt: Date.now() + 2_000 })).toContain('data-undo-left-ms="2000"');
  });
});
