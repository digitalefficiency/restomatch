import { describe, expect, it } from 'vitest';
import { localizeServerError } from '../serverErrors';

describe('localizeServerError', () => {
  it('maps a known Hebrew router message to English', () => {
    expect(localizeServerError({ message: 'חייב להישאר לפחות בעלים אחד.' }, 'en')).toBe(
      'There must be at least one owner.',
    );
  });
  it('keeps the Hebrew message in Hebrew', () => {
    expect(localizeServerError({ message: 'המשתמש כבר חבר בצוות.' }, 'he')).toBe('המשתמש כבר חבר בצוות.');
  });
  it('maps a stable prefix code (DSR sole owner)', () => {
    const err = { message: 'SOLE_OWNER_TRANSFER_REQUIRED: יש להעביר בעלות', data: { code: 'PRECONDITION_FAILED' } };
    expect(localizeServerError(err, 'en')).toMatch(/Transfer ownership/);
    expect(localizeServerError(err, 'he')).toMatch(/יש להעביר בעלות/);
  });
  it('unwraps a zod JSON issue list', () => {
    const message = JSON.stringify([{ code: 'custom', message: 'אזור זמן לא תקין', path: ['timezone'] }]);
    expect(localizeServerError({ message, data: { code: 'BAD_REQUEST' } }, 'en')).toBe('Invalid time zone');
  });
  it('never leaks an unknown Hebrew message into English', () => {
    expect(localizeServerError({ message: 'שגיאה לא מוכרת' }, 'en')).toBe('The action failed. Please try again.');
  });
  it('replaces raw developer role errors with a translated FORBIDDEN string', () => {
    const err = { message: 'Required role: owner, got: chef', data: { code: 'FORBIDDEN' } };
    expect(localizeServerError(err, 'he')).toBe('אין לכם הרשאה לפעולה הזו.');
    expect(localizeServerError(err, 'en')).toBe('You do not have permission to do this.');
  });
  it('translates a duplicate invoice number CONFLICT with the number and the holder date', () => {
    const err = {
      message: 'מספר החשבונית 1234 כבר קיים בחשבונית אחרת של הספק (מתאריך 2026-10-12)',
      data: {
        code: 'CONFLICT',
        appCode: 'invoice.numberTaken',
        appParams: { invoiceNumber: '1234', holderDate: '2026-10-12', holderInvoiceId: 'x' },
      },
    };
    const en = localizeServerError(err, 'en');
    expect(en).toContain('1234');
    expect(en).toContain('2026-10-12');
    expect(en).not.toMatch(/[\u0590-\u05FF]/);
    expect(localizeServerError(err, 'he')).toContain('1234');
  });
  it('falls back for empty errors', () => {
    expect(localizeServerError(null, 'en', 'Custom')).toBe('Custom');
  });

  describe('stable appCode (primary path)', () => {
    it('translates data.appCode over the Hebrew message', () => {
      const err = { message: 'חייב להישאר לפחות בעלים אחד.', data: { code: 'BAD_REQUEST', appCode: 'team.lastOwner' } };
      expect(localizeServerError(err, 'en')).toBe('There must be at least one owner.');
      expect(localizeServerError(err, 'he')).toBe('חייב להישאר לפחות בעלים אחד.');
    });
    it('wins even when the message text is unknown / changed', () => {
      const err = { message: 'some reworded server text', data: { appCode: 'team.inviteExpired' } };
      expect(localizeServerError(err, 'en')).toBe('This invite has expired.');
    });
    it('reads cause.appCode from a direct server-side caller error', () => {
      const err = { message: 'x', cause: { appCode: 'dsr.soleOwner' } };
      expect(localizeServerError(err, 'en')).toMatch(/Transfer ownership/);
    });
    it('interpolates appParams (quota limit)', () => {
      const err = { message: 'm', data: { appCode: 'quota.exceeded', appParams: { limit: 50 } } };
      expect(localizeServerError(err, 'en')).toBe('You have used this month’s scan quota (50). Upgrade your plan to continue.');
    });
    it('translates the G-05 lifecycle codes, never the raw prefixed message', () => {
      const conflict = { message: 'lifecycle.conflict:{"currentStatus":"accepted"}', data: { code: 'CONFLICT', appCode: 'lifecycle.conflict', appParams: { currentStatus: 'accepted', actorName: 'Dana', at: '2026-10-31T10:00:00.000Z' } } };
      expect(localizeServerError(conflict, 'en')).toBe('Someone already updated this item in the meantime. Refresh to see its current state.');
      expect(localizeServerError(conflict, 'he')).toBe('מישהו כבר עדכן את הפריט הזה בינתיים. רעננו את המסך ובדקו את המצב העדכני.');
      const refused = { message: 'lifecycle.refused:invoice_has_claim: x', data: { code: 'PRECONDITION_FAILED', appCode: 'lifecycle.refused', appParams: { reason: 'invoice_has_claim' } } };
      expect(localizeServerError(refused, 'en')).toBe('This action is not possible in the item’s current state.');
    });
    it('ignores an unknown appCode and falls back to the message mapping', () => {
      const err = { message: 'תוקף ההזמנה פג.', data: { appCode: 'not.a.code' } };
      expect(localizeServerError(err, 'en')).toBe('This invite has expired.');
    });
    it('text fallback still maps the quota message with its limit', () => {
      const err = { message: 'חרגתם ממכסת הסריקות החודשית (120). שדרגו את המנוי כדי להמשיך.' };
      expect(localizeServerError(err, 'en')).toBe('You have used this month’s scan quota (120). Upgrade your plan to continue.');
    });
  });
});
