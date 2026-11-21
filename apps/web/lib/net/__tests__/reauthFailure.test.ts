import { describe, expect, it } from 'vitest';
import { reauthFailureKind } from '../reauthFailure';
import { en } from '@/lib/i18n/messages/common/en';
import { he } from '@/lib/i18n/messages/common/he';

describe('re-auth sheet: a throttled sign-in says "too many attempts", not "wrong password"', () => {
  it('maps only code "rate" (LoginRateLimited) to the rate state', () => {
    expect(reauthFailureKind({ error: 'CredentialsSignin', code: 'rate' })).toBe('rate');
  });

  it('a wrong password, a locked account, a missing result or an odd code stay the uniform "wrong"', () => {
    expect(reauthFailureKind({ error: 'CredentialsSignin', code: 'credentials' })).toBe('wrong');
    expect(reauthFailureKind({ error: 'CredentialsSignin' })).toBe('wrong');
    expect(reauthFailureKind({ error: 'Configuration', code: null })).toBe('wrong');
    expect(reauthFailureKind(undefined)).toBe('wrong');
    expect(reauthFailureKind(null)).toBe('wrong');
    // no error → not a rate state even if a code is present
    expect(reauthFailureKind({ error: null, code: 'rate' })).toBe('wrong');
  });

  it('has the rate copy in he and en', () => {
    expect(he.shell.session.rate).toBe('יותר מדי ניסיונות. נסו שוב מאוחר יותר.');
    expect(en.shell.session.rate).toBe('Too many attempts. Try again later.');
  });
});
