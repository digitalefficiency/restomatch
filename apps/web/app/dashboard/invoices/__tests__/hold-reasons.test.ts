import { describe, expect, it } from 'vitest';
import { he } from '@/lib/i18n/messages/invoices/he';
import { en } from '@/lib/i18n/messages/invoices/en';
import { createTranslator } from '@/lib/i18n/translate';
import { invoices } from '@/lib/i18n/messages/invoices';
import { HOLD_REASON_KEYS, holdReasonKey, holdReasonKeys } from '../hold-reasons';

describe('held-invoice reasons (pilot #222)', () => {
  it('maps S13 / #174 / pipeline codes into grouped keys (review #4, #8)', () => {
    expect(holdReasonKey('supplier_id_mismatch')).toBe('supplier_id_mismatch');
    expect(holdReasonKey('supplier_id_invalid')).toBe('supplier_id_invalid');
    for (const c of ['line_math_mismatch', 'subtotal_mismatch', 'vat_mismatch', 'total_mismatch']) expect(holdReasonKey(c)).toBe('math');
    expect(holdReasonKey('missing_invoice_number')).toBe('missing');
    expect(holdReasonKey('missing_date')).toBe('missing');
    expect(holdReasonKey('confidence')).toBe('confidence');
    expect(holdReasonKey('lowLines')).toBe('low_lines');
    expect(holdReasonKey('document_kind_not_invoice')).toBe('doc_kind');
    expect(holdReasonKey('doc_kind_delivery_note')).toBe('doc_kind_delivery_note');
    expect(holdReasonKey('doc_kind_credit_note')).toBe('doc_kind_credit_note');
    expect(holdReasonKey('doc_kind_receipt')).toBe('doc_kind_receipt');
    expect(holdReasonKey('doc_kind_quote')).toBe('doc_kind_quote');
    expect(holdReasonKey('doc_kind_other')).toBe('doc_kind');
    expect(holdReasonKey('some_pipeline_code')).toBe('unknown');
    expect(holdReasonKeys(['vat_mismatch', 'total_mismatch', 'missing_date'])).toEqual(['math', 'missing']);
    expect(holdReasonKeys([])).toEqual([]);
  });

  it('every reason key has he + en copy (parity); he copy is calm and has no dead-end "בחרו ספק"', () => {
    for (const k of HOLD_REASON_KEYS) {
      expect(he.needsLines.held[k], `he ${k}`).toBeTruthy();
      expect(en.needsLines.held[k], `en ${k}`).toBeTruthy();
      expect(he.needsLines.held[k]).not.toMatch(/חריג|דחוף|שגיאה|בחרו ספק/);
    }
    expect(he.needsLines.held.math).toBe('הסכומים לא מסתדרים — השוו לסריקה ותקנו');
    expect(he.needsLines.held.consolidated_unknown_supplier).toBe('חשבונית מרכזת מספק שלא זוהה — נבדקת');
    expect(he.needsLines.held.unknown).toBe('ממתינה לבדיקה');
  });

  it('review #9: counts are ICU plurals in both languages', () => {
    const tHe = createTranslator('he', invoices);
    const tEn = createTranslator('en', invoices);
    expect(tHe('needsLines.count', { count: 1 })).toBe('חשבונית אחת');
    expect(tHe('needsLines.count', { count: 3 })).toBe('3 חשבוניות');
    expect(tEn('needsLines.count', { count: 1 })).toBe('1 invoice');
    expect(tEn('needsLines.count', { count: 3 })).toBe('3 invoices');
  });
  it('prototype keys never resolve to a reason', () => {
    expect(holdReasonKeys(['toString', '__proto__', 'constructor'])).toEqual(['unknown']);
  });
});
