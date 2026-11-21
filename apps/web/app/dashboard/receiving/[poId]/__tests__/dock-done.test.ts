import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adaptReconciliation, type PoLineRow } from '../_adapters';

// The components are compiled with the classic JSX runtime in vitest (as in read-only.test).
(globalThis as unknown as { React?: typeof React }).React = React;
const { DockDone } = await import('../dock-done');

/**
 * The end screen (DS3-05): its headline says "all as ordered" only when nothing else is open for
 * the receipt, and a close found waiting at reopen (no count on screen) makes no claim about the
 * document.
 */
const po = { id: 'po', supplierId: 's', supplierName: 'ספק', expectedAt: null, status: 'sent', totalEstimated: null };
const poLines: PoLineRow[] = [
  { id: 'pl1', productId: 'p1', rawDescription: 'חזה עוף', qtyOrdered: '4', unit: 'ק״ג', unitPriceExpected: '20' },
  { id: 'pl2', productId: 'p2', rawDescription: 'עגבניה שרי', qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '10' },
];
const { result } = adaptReconciliation({ po, poLines, receiptLines: [], invoiceLines: [] });

function done(props: Partial<Parameters<typeof DockDone>[0]>): string {
  return renderToStaticMarkup(
    createElement(DockDone, {
      supplierName: 'ספק',
      result,
      confirmedAt: null,
      capturedImage: null,
      invoiceHref: null,
      invoiceNumber: null,
      amount: null,
      receivedBy: null,
      gaps: [],
      doc: 'none',
      closeQueued: false,
      resetLabel: 'למשלוח הבא',
      onReset: () => undefined,
      ...props,
    }),
  );
}

describe('DockDone — the end screen', () => {
  it('a clean count with nothing else open says "all as ordered"', () => {
    expect(done({})).toContain('הכול כמו בהזמנה');
  });

  it('a clean count while the invoice or the slip still has something to say: the items, no clean claim', () => {
    const html = done({ otherFindings: true });
    expect(html).toContain('data-testid="confirmed-summary"');
    expect(html).not.toContain('הכול כמו בהזמנה');
  });

  it('a close found waiting at reopen (no count on screen): no summary and no document claim', () => {
    const html = done({ result: null, closeQueued: true });
    expect(html).not.toContain('data-testid="confirmed-summary"');
    expect(html).not.toContain('data-testid="confirmed-doc"');
    expect(html).toContain('data-testid="close-queued"');
  });

  it('with a count, the document row says where the document stands — each state in its own words', () => {
    const docRow = (html: string) => html.slice(html.indexOf('data-testid="confirmed-doc"'));
    expect(docRow(done({ doc: 'none' }))).toContain('לא צולם');
    // Today's order: photographed before the count.
    expect(docRow(done({ doc: 'done' }))).toContain('צולם');
    expect(docRow(done({ doc: 'done' }))).not.toContain('לא צולם');
    expect(docRow(done({ doc: 'done' }))).not.toContain('ברקע');
    // Count first: photographed after the count, read in the background — or when the signal returns.
    expect(docRow(done({ doc: 'done', countFirst: true }))).toContain('צולם, נקרא ברקע');
    expect(docRow(done({ doc: 'queued' }))).toContain('צולם, ייקרא כשהחיבור יחזור');
    expect(docRow(done({ doc: 'done', countFirst: true, closeQueued: true }))).toContain('צולם, ייקרא כשהחיבור יחזור');
  });
});
