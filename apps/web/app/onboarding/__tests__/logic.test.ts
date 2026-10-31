import { describe, expect, it } from 'vitest';
import { firstInvalid, normalizeBusinessId, validateOnboarding } from '../logic';

describe('onboarding form rules (auth-21, auth-27)', () => {
  it('strips dashes and spaces from the company number instead of rejecting them', () => {
    expect(normalizeBusinessId('51-477812-3')).toBe('514778123');
    expect(normalizeBusinessId('514 778 123')).toBe('514778123');
    const { values, errors } = validateOnboarding({ yourName: 'דנה כהן', name: 'כפר הזיתים', businessId: '51-477812-3' });
    expect(errors).toEqual({});
    expect(values.businessId).toBe('514778123');
  });

  it('flags each invalid field, in visual order, and focuses the first one', () => {
    const { errors } = validateOnboarding({ yourName: ' ', name: 'א', businessId: '12-34' });
    expect(errors).toEqual({ yourName: true, name: true, businessId: true });
    expect(firstInvalid(errors)).toBe('yourName');
    expect(firstInvalid(validateOnboarding({ yourName: 'דנה', name: 'כפר', businessId: 'abc' }).errors)).toBe('businessId');
  });

  it('treats the company number as optional and never accepts control characters in names', () => {
    expect(validateOnboarding({ yourName: 'דנה', name: 'כפר', businessId: '' }).values.businessId).toBeUndefined();
    expect(validateOnboarding({ yourName: 'דנה\nBcc: x', name: 'כפר', businessId: '' }).errors.yourName).toBe(true);
    // Bidi overrides / isolates (U+202A–U+202E, U+2066–U+2069) never reach an invite or the portal.
    for (const c of ['\u202e', '\u202a', '\u2066', '\u2069']) {
      expect(validateOnboarding({ yourName: `דנה${c}abc`, name: 'כפר', businessId: '' }).errors.yourName).toBe(true);
    }
  });
});
