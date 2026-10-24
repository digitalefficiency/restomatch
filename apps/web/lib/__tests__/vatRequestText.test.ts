import { describe, expect, it } from 'vitest';
import { supplierRequestText } from '../vat/requestText';

describe('supplierRequestText (Hebrew, copy-only)', () => {
  it('lists every invoice with its number, Israeli date and amount before VAT', () => {
    const text = supplierRequestText({
      supplierName: 'דגי הים התיכון',
      restaurantName: 'כפר הזיתים',
      invoices: [
        { invoiceNumber: '4521', invoiceDate: '2026-10-12', totalExclVat: 6240.5 },
        { invoiceNumber: null, invoiceDate: '2026-09-03', totalExclVat: 12000 },
      ],
    });
    expect(text).toContain('שלום דגי הים התיכון,');
    expect(text).toContain('חשבונית מס׳ 4521 מיום 12.10.2026');
    expect(text).toContain('6,240.5');
    expect(text).toContain('חשבונית ללא מספר מיום 03.09.2026');
    expect(text).toContain('חשבוניות מתוקנות');
    expect(text.trimEnd().endsWith('כפר הזיתים')).toBe(true);
  });

  it('singular wording for one invoice', () => {
    const text = supplierRequestText({
      supplierName: 'ספק',
      restaurantName: 'מסעדה',
      invoices: [{ invoiceNumber: '1', invoiceDate: '2026-10-01', totalExclVat: 5000.01 }],
    });
    expect(text).toContain('החשבונית הבאה');
    expect(text).toContain('חשבונית מתוקנת');
  });
});
