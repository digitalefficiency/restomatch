import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';

// Real Hebrew copy, no provider: the i18n client hooks resolve to the translator directly.
vi.mock('@/lib/i18n/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/i18n/client')>()),
  useLocale: () => 'he',
  useAppLocale: () => 'he',
  useDir: () => 'rtl',
  useT: (messages: Parameters<typeof createTranslator>[1]) => createTranslator('he', messages),
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

(globalThis as unknown as { React?: typeof React }).React = React;
const { ReceiptSummary } = await import('../receipt-summary');
const { adaptReconciliation } = await import('../_adapters');
const { lineKey } = await import('@/app/showcase/receiver/_state');

/**
 * G-04 follow-up Q3 (owner decision 11.11): on a closed receipt, a line nobody
 * counted reads a neutral "לא נספר" (no quantity check on it), never a bare "—".
 */
const po = { id: 'po', supplierId: 's', supplierName: 'ספק', expectedAt: null, status: 'partial', totalEstimated: null };
const poLines = [
  { id: 'pl1', productId: 'p1', rawDescription: 'חזה עוף', qtyOrdered: '4', unit: 'ק״ג', unitPriceExpected: '20' },
  { id: 'pl2', productId: 'p2', rawDescription: 'עגבניה שרי', qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '10' },
];

function render(marks: Record<string, unknown>) {
  const { result } = adaptReconciliation({ po, poLines, receiptLines: [], invoiceLines: [] });
  return renderToStaticMarkup(
    createElement(ReceiptSummary, { status: 'partial', receivedAt: null, result, marks: marks as never, closedUncounted: 1 }),
  );
}

describe('ReceiptSummary · "לא נספר" (G-04 Q3)', () => {
  it('a line closed without a count reads "לא נספר"; a counted line shows its quantity', () => {
    const { result } = adaptReconciliation({ po, poLines, receiptLines: [], invoiceLines: [] });
    const counted = result.lines.find((l) => l.poLineId === 'pl1')!;
    // Mark only the first line as counted (4 ק״ג); the second stays untouched.
    const html = render({ [lineKey(counted)]: { touched: true, qtyReceived: 4, rejectReason: null, condition: 'ok', method: 'per_line' } });
    const rows = html.split('data-testid="receipt-summary-line"').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain('summary-not-counted');
    expect(rows[1]).toContain('data-testid="summary-not-counted"');
    expect(rows[1]).toContain('לא נספר');
    expect(rows[1]).not.toMatch(/₪/);
    expect(html).toContain('data-testid="receipt-closed-uncounted"');
  });
});
