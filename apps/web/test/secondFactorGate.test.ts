import { describe, expect, it } from 'vitest';
import { bypassesSecondFactor } from '../lib/secondFactorGate';

/**
 * Train-A review (MEDIUM): adminProcedure checks that the ACCOUNT has TOTP, not
 * that THIS SESSION passed it. A JWT minted before enrolment carried
 * twoFactorPending:false and opened the admin console for up to 30 days. The jwt
 * callback now revokes any token for which bypassesSecondFactor() is true.
 */
describe('second-factor gate for already-issued session tokens', () => {
  it('a token minted BEFORE enrolment (not pending, never passed a factor) is revoked', () => {
    expect(bypassesSecondFactor({ twoFactorEnabled: true, twoFactorPending: false })).toBe(true);
    // legacy token without the field at all
    expect(bypassesSecondFactor({ twoFactorEnabled: true })).toBe(true);
  });

  it('a token still pending the second factor stays pending (the /login/2fa gate), not revoked', () => {
    expect(bypassesSecondFactor({ twoFactorEnabled: true, twoFactorPending: true })).toBe(false);
  });

  it('a token cleared by a server-verified ticket (mfaAt stamped) is allowed', () => {
    expect(bypassesSecondFactor({ twoFactorEnabled: true, twoFactorPending: false, mfaAt: 1_700_000_000_000 })).toBe(false);
  });

  it('an account without 2FA is never affected', () => {
    expect(bypassesSecondFactor({ twoFactorEnabled: false })).toBe(false);
    expect(bypassesSecondFactor({ twoFactorEnabled: false, twoFactorPending: false })).toBe(false);
    expect(bypassesSecondFactor({ twoFactorEnabled: false, mfaAt: 1 })).toBe(false);
  });
});
