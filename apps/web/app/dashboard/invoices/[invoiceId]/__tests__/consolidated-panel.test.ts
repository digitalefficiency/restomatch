import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConsolidatedProposal } from '@restomatch/api';
import { createTranslator } from '@/lib/i18n/translate';
import { consolidated } from '@/lib/i18n/messages/consolidated';

// The JSX compiles to React.createElement (classic runtime in vitest), and the
// components barrel builds JSX at module load: set React first, then import the panel.
(globalThis as unknown as { React?: typeof React }).React = React;
const { ConsolidatedPanel } = await import('../consolidated-panel');

/**
 * G-04 §9: the ריכוז panel shows the proposal's review items and notes still being
 * counted as read-only rows, and never a red "פערים" card or a supplier letter asking
 * ₪0 when only review items keep the invoice from "תואמת".
 */
const note = (number: string, value: number) => ({
  grId: `gr-${number}`,
  poId: `po-${number}`,
  number,
  poRef: null,
  receivedAt: '2026-06-10T09:00:00.000Z',
  receivedValueIls: value,
  deltaIls: 0,
  status: 'covered' as const,
  alreadyBilledOn: null,
});

function proposal(over: Partial<ConsolidatedProposal>): ConsolidatedProposal {
  return {
    invoiceId: 'inv-1',
    supplierId: 's-1',
    invoiceStatus: 'parsed',
    periodStart: '2026-05-31T21:00:00.000Z',
    periodEnd: '2026-06-30T21:00:00.000Z',
    deliveryNotes: [note('9001', 34)],
    products: [],
    findings: [],
    claim: { exclIls: 0, inclIls: 0 },
    totals: { deliveryNotesIls: 34, invoiceSubtotalIls: 34, differenceIls: 0, leakIls: 0, invoiceTotalInclVat: 40.12 },
    status: 'matched',
    pendingNotes: [],
    reviewItems: [],
    ...over,
  };
}

const render = (p: ConsolidatedProposal, locale: 'he' | 'en' = 'he') =>
  renderToStaticMarkup(
    createElement(ConsolidatedPanel, {
      proposal: p,
      t: createTranslator(locale, consolidated),
      locale,
      supplierName: 'ספק',
      invoiceNumber: 'R-1',
    }),
  );
/** The text of the element carrying this data-testid (first match), tags stripped. */
const textOf = (html: string, testId: string) => {
  const i = html.indexOf(`data-testid="${testId}"`);
  if (i < 0) return null;
  const start = html.lastIndexOf('<', i);
  const tag = /^<(\w+)/.exec(html.slice(start))![1]!;
  const end = html.indexOf(`</${tag}>`, i);
  return html.slice(start, end).replace(/<[^>]+>/g, '').replace(/[‎‏⁦-⁩]/g, '');
};

describe('ConsolidatedPanel · G-04 §9 review items', () => {
  it('billed twice only: a T2 review row with the ₪ and the other invoice — no red "פערים" card, no ₪0 letter', () => {
    const html = render(
      proposal({
        status: 'differences',
        reviewItems: [
          { flag: 'note_billed_twice', tier: 'T2', noteNumber: '9001', amountIls: 36, otherInvoice: { invoiceId: 'i0', invoiceNumber: 'A-M-1' }, blocksMatched: true },
        ],
      }),
    );
    expect(html).not.toContain('data-testid="xmatch-differences"');
    expect(html).not.toContain('data-testid="xmatch-letter"');
    expect(html).not.toContain('נא לזכות');
    expect(html).toContain('data-testid="xmatch-review-only"');
    const row = textOf(html, 'xmatch-review-note_billed_twice')!;
    expect(row).toContain('אפשר שחויב פעמיים');
    expect(row).toContain('ת.מ. 9001');
    expect(row).toContain('חשבונית A-M-1');
    expect(row).toMatch(/36\.00/);
  });

  it('a note not in the system with an unknown ₪ never shows ₪0', () => {
    const html = render(
      proposal({
        status: 'differences',
        reviewItems: [{ flag: 'note_not_in_system', tier: 'warn', noteNumber: '7822', amountIls: null, otherInvoice: null, blocksMatched: true }],
      }),
    );
    const row = textOf(html, 'xmatch-review-note_not_in_system')!;
    expect(row).toContain('תעודה שלא נקלטה במערכת');
    expect(row).toContain('ת.מ. 7822');
    expect(row).not.toMatch(/0\.00/);
    expect(html).not.toContain('data-testid="xmatch-letter"');
  });

  it('a month-total line repeated on an earlier ריכוז reads as such, with its overlapping ₪', () => {
    const html = render(
      proposal({
        status: 'differences',
        reviewItems: [
          { flag: 'note_billed_twice', tier: 'T2', noteNumber: null, amountIls: 170, otherInvoice: { invoiceId: 'i0', invoiceNumber: 'R-JUN-A' }, blocksMatched: true },
        ],
      }),
    );
    const row = textOf(html, 'xmatch-review-note_billed_twice')!;
    expect(row).toContain('שורת סה״כ חודש');
    expect(row).toContain('חשבונית R-JUN-A');
    expect(row).toMatch(/170\.00/);
    expect(html).not.toContain('נא לזכות');
  });

  it('a note still being counted is a calm T4 row with the ₪ billed on it; the invoice can still read "matched"', () => {
    const html = render(proposal({ status: 'matched', pendingNotes: [{ number: '7702', billedIls: 51 }] }));
    expect(html).toContain('data-testid="xmatch-matched"');
    const row = textOf(html, 'xmatch-review-pending')!;
    expect(row).toContain('עדיין בספירה');
    expect(row).toContain('ת.מ. 7702');
    expect(row).toMatch(/51\.00/);
  });

  it('a note from another month is a non-blocking row with its receipt day; the edge case is neutral', () => {
    const html = render(
      proposal({
        status: 'matched',
        reviewItems: [
          { flag: 'note_other_month', tier: 'T4', noteNumber: '7812', amountIls: 8.5, otherInvoice: null, receivedOn: '2026-07-01', daysOutside: 1, blocksMatched: false },
        ],
      }),
    );
    expect(html).toContain('data-testid="xmatch-matched"');
    const row = textOf(html, 'xmatch-review-note_other_month')!;
    expect(row).toContain('תעודת משלוח מחודש אחר');
    expect(row).toContain('ת.מ. 7812');
  });

  it('a real claim still gets its T2 card and its letter (no regression)', () => {
    const html = render(
      proposal({
        status: 'differences',
        claim: { exclIls: 2, inclIls: 0 },
        totals: { deliveryNotesIls: 34, invoiceSubtotalIls: 36, differenceIls: 2, leakIls: 2, invoiceTotalInclVat: 42.48 },
        findings: [
          {
            type: 'PRICE_HIGHER', severity: 'warn', productId: 'p', deliveryNoteNumber: '9001', alreadyBilledOn: null, basis: 'excl',
            productName: 'חלב', productNameEn: 'Milk', unit: 'kg', qty: 4, expected: 8.5, actual: 9, deltaAmount: 2, countsAsLeak: true,
          },
        ],
        reviewItems: [{ flag: 'note_not_in_system', tier: 'warn', noteNumber: '7822', amountIls: null, otherInvoice: null, blocksMatched: true }],
      }),
    );
    expect(html).toContain('data-testid="xmatch-differences"');
    expect(html).toContain('data-testid="xmatch-letter"');
    expect(html).not.toContain('data-testid="xmatch-review-only"');
    expect(html).toContain('data-testid="xmatch-review-note_not_in_system"');
  });

  it('en renders the same rows (copy parity)', () => {
    const html = render(
      proposal({
        status: 'differences',
        reviewItems: [{ flag: 'note_billed_twice', tier: 'T2', noteNumber: '9001', amountIls: 36, otherInvoice: { invoiceId: 'i0', invoiceNumber: 'A-M-1' }, blocksMatched: true }],
      }),
      'en',
    );
    expect(textOf(html, 'xmatch-review-note_billed_twice')).toContain('Possibly billed twice');
  });
});
