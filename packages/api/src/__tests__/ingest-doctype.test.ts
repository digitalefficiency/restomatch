import { describe, expect, it } from 'vitest';
import { classifyDocument } from '../ingest/docType';

describe('classifyDocument (W3-11 inbox chip)', () => {
  it.each([
    [{ filename: 'חשבונית זיכוי 4471.pdf' }, 'credit_note', 'high'],
    [{ subject: 'תעודת זיכוי על משלוח 12.10' }, 'credit_note', 'high'],
    [{ filename: 'credit-note-88.pdf' }, 'credit_note', 'high'],
    [{ filename: 'כרטסת הנהלת חשבונות 10-2026.xlsx' }, 'statement', 'high'],
    [{ subject: 'Statement of account October' }, 'statement', 'high'],
    [{ filename: 'חשבונית מרכזת אוקטובר.pdf' }, 'consolidated', 'high'],
    [{ subject: 'חשבוניות ריכוז' }, 'consolidated', 'high'],
    [{ filename: 'תעודת משלוח 5521.jpg' }, 'delivery_note', 'high'],
    [{ filename: 'חשבונית מס 1203.pdf' }, 'invoice', 'high'],
    [{ filename: 'scan_0012.pdf', subject: 'חשבונית' }, 'invoice', 'low'],
    [{ filename: 'ת"מ 33.jpg' }, 'delivery_note', 'low'],
  ] as const)('%o → %s (%s)', (input, type, confidence) => {
    expect(classifyDocument(input)).toEqual({ type, confidence });
  });

  it('a credit note is never read as an invoice, nor a consolidated one as a plain invoice', () => {
    expect(classifyDocument({ text: 'חשבונית מס / חשבונית זיכוי מס׳ 9' }).type).toBe('credit_note');
    expect(classifyDocument({ text: 'חשבונית מס מרכזת' }).type).toBe('consolidated');
  });

  it('returns no type when there is nothing to read', () => {
    expect(classifyDocument({})).toEqual({ type: null, confidence: 'low' });
    expect(classifyDocument({ filename: 'IMG_2201.jpg' })).toEqual({ type: null, confidence: 'low' });
  });
});
