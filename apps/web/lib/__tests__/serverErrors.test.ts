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
  it('falls back for empty errors', () => {
    expect(localizeServerError(null, 'en', 'Custom')).toBe('Custom');
  });
});
