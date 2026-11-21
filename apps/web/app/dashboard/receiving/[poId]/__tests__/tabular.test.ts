import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { asOrderedPatch, lineKey } from '@/app/showcase/receiver/_state';
import { adaptReconciliation, type PoLineRow } from '../_adapters';
import { PHONE_CTA } from '../_phone';

// The components are compiled with the classic JSX runtime in vitest (as in read-only.test).
(globalThis as unknown as { React?: typeof React }).React = React;
const { DockCount } = await import('../dock-count');

/**
 * DS3-07: with a proportional face (Google Sans) only tabular figures keep their width. On the
 * delivery check, digits that stand in a column (each row's count) or change in place (the
 * progress counter, a primary button's "mark the rest (8)" or the sheet's "save 12.5 kg" while
 * the pad types) are tabular; the pad's field, the spot fields and the keys carry `.num`.
 */
const po = { id: 'po', supplierId: 's', supplierName: 'ספק', expectedAt: null, status: 'sent', totalEstimated: null };
const poLines: PoLineRow[] = [
  { id: 'pl1', productId: 'p1', rawDescription: 'חזה עוף', qtyOrdered: '4', unit: 'ק״ג', unitPriceExpected: '20' },
  { id: 'pl2', productId: 'p2', rawDescription: 'עגבניה שרי', qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '10' },
  { id: 'pl3', productId: 'p3', rawDescription: 'בצל', qtyOrdered: '10', unit: 'ק״ג', unitPriceExpected: '3' },
];

/** The class list of the first element carrying this test id. */
function classesOf(html: string, testId: string): string[] {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, `no ${testId} in the markup`).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<', at);
  const tag = html.slice(open, html.indexOf('>', at) + 1);
  return /class="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];
}

describe('tabular figures on the delivery check (DS3-07)', () => {
  it('the primary buttons of the phone flow keep their digits tabular', () => {
    expect(PHONE_CTA.split(' ')).toContain('tabular-nums');
  });

  it('the progress counter, the counted rows and the main button with its count are tabular', () => {
    const { result, initialMarks } = adaptReconciliation({ po, poLines, receiptLines: [], invoiceLines: [] });
    // One line ticked: its count shows in the row's column, and the main button offers "mark the rest (2)".
    const first = result.lines[0]!;
    const marks = { ...initialMarks, [lineKey(first)]: { ...initialMarks[lineKey(first)]!, ...asOrderedPatch(first), touched: true } };
    const html = renderToStaticMarkup(
      createElement(DockCount, { result, marks, onUpdateMark: () => undefined, onSubmit: () => undefined, supplierName: 'ספק' }),
    );
    expect(classesOf(html, 'count-progress')).toContain('tabular-nums');
    expect(classesOf(html, 'count-line-result')).toContain('tabular-nums');
    expect(classesOf(html, 'mark-rest')).toContain('tabular-nums');
  });
});
