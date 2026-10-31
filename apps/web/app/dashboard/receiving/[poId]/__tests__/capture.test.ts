import { describe, expect, it } from 'vitest';
import { failedReadNotice, isErrorNotice, onRegisterError } from '../_capture';
import { he } from '@/lib/i18n/messages/receiving/delivery.he';

describe('after the photo: registration and the OCR read (pilot)', () => {
  it('a registration error is an explicit retry state — never a silent count without the invoice', () => {
    const photo = { url: 'blob:x', filename: 'inv.jpg', publicUrl: 'https://scans/inv.jpg?token=1' };
    const s = onRegisterError(photo);
    expect(s.step).toBe('SCAN_INVOICE');
    expect(s.retry).toBe(photo); // one tap re-sends the same scan (registerInvoice is idempotent, M8)
    expect(he.delivery.scan.registerFailed).toBe('החשבונית לא נשמרה — צלמו שוב');
  });

  it("'ocr_disabled' is calm receiver copy, not an error", () => {
    expect(failedReadNotice('ocr_disabled')).toBe('disabled');
    expect(isErrorNotice('disabled')).toBe(false);
    expect(he.delivery.processing.ocrDisabled).toBe('קריאה אוטומטית אינה פעילה בחשבון זה — המשיכו מול ההזמנה');
    expect(failedReadNotice('quota_exceeded')).toBe('quota');
    expect(failedReadNotice('extraction_failed')).toBe('failed');
    expect(failedReadNotice(null)).toBe('failed');
    expect(isErrorNotice('failed')).toBe(true);
  });
});
