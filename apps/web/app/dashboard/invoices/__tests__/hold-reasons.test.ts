import { describe, expect, it } from 'vitest';
import { he } from '@/lib/i18n/messages/invoices/he';
import { en } from '@/lib/i18n/messages/invoices/en';
import { HOLD_REASON_KEYS, holdReasonKey, holdReasonKeys } from '../hold-reasons';

describe('held-invoice reasons (pilot #222)', () => {
  it('maps the S13 codes, collapses doc_kind_*, reads unknown codes as "unknown"', () => {
    expect(holdReasonKey('supplier_id_mismatch')).toBe('supplier_id_mismatch');
    expect(holdReasonKey('consolidated_unknown_supplier')).toBe('consolidated_unknown_supplier');
    expect(holdReasonKey('doc_kind_credit_note')).toBe('doc_kind');
    expect(holdReasonKey('some_pipeline_code')).toBe('unknown');
    expect(holdReasonKey('doc_kind')).toBe('unknown');
    expect(holdReasonKeys(['doc_kind_receipt', 'doc_kind_other', 'consolidated'])).toEqual(['doc_kind', 'consolidated']);
    expect(holdReasonKeys([])).toEqual(['unknown']);
  });
  it('every reason key has he + en copy (parity), and the he copy never alarms', () => {
    for (const k of HOLD_REASON_KEYS) {
      expect(he.needsLines.held[k], `he ${k}`).toBeTruthy();
      expect(en.needsLines.held[k], `en ${k}`).toBeTruthy();
      expect(he.needsLines.held[k]).not.toMatch(/חריג|דחוף|שגיאה/);
    }
    expect(he.needsLines.held.supplier_id_mismatch).toBe('ח.פ. במסמך שונה מהרשום לספק — בדקו את פרטי הספק');
    expect(he.needsLines.held.unknown).toBe('ממתינה לבדיקה');
  });
});
