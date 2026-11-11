import { describe, expect, it } from 'vitest';
import { ENROLMENT_GRACE_MS, bypassesSecondFactor } from '../lib/secondFactorGate';

/**
 * Train-A review (MEDIUM): adminProcedure checks that the ACCOUNT has TOTP, not
 * that THIS SESSION passed it. A JWT minted before enrolment carried
 * twoFactorPending:false and opened the admin console for up to 30 days. The jwt
 * callback now revokes any token for which bypassesSecondFactor() is true.
 */
const ENROLLED = 1_700_000_000_000;
const LATER = ENROLLED + ENROLMENT_GRACE_MS + 1; // past the arming grace

describe('second-factor gate for already-issued session tokens', () => {
  it('a token minted BEFORE enrolment (not pending, never passed a factor) is revoked', () => {
    expect(bypassesSecondFactor({ twoFactorEnabledAt: ENROLLED, twoFactorPending: false, now: LATER })).toBe(true);
    // legacy token without the pending field at all
    expect(bypassesSecondFactor({ twoFactorEnabledAt: ENROLLED, now: LATER })).toBe(true);
  });

  it('a token still pending the second factor stays pending (the /login/2fa gate), not revoked', () => {
    expect(bypassesSecondFactor({ twoFactorEnabledAt: ENROLLED, twoFactorPending: true })).toBe(false);
  });

  it('a token cleared by a server-verified ticket for the CURRENT enrolment is allowed', () => {
    expect(bypassesSecondFactor({ twoFactorEnabledAt: ENROLLED, twoFactorPending: false, mfaFor: ENROLLED })).toBe(false);
  });

  it('a token that passed an OLD enrolment is revoked after disable + re-enrol (warden MEDIUM)', () => {
    expect(
      bypassesSecondFactor({ twoFactorEnabledAt: ENROLLED + 60_000, twoFactorPending: false, mfaFor: ENROLLED, now: LATER + 60_000 }),
    ).toBe(true);
  });

  it('right after arming, in-flight requests with the old token are not revoked yet (grace), then they are', () => {
    expect(bypassesSecondFactor({ twoFactorEnabledAt: ENROLLED, twoFactorPending: false, now: ENROLLED + 2_000 })).toBe(false);
    expect(
      bypassesSecondFactor({ twoFactorEnabledAt: ENROLLED, twoFactorPending: false, now: ENROLLED + ENROLMENT_GRACE_MS })
    ).toBe(false);
    expect(bypassesSecondFactor({ twoFactorEnabledAt: ENROLLED, twoFactorPending: false, now: LATER })).toBe(true);
  });

  it('an account without 2FA is never affected', () => {
    expect(bypassesSecondFactor({ twoFactorEnabledAt: null })).toBe(false);
    expect(bypassesSecondFactor({ twoFactorEnabledAt: null, twoFactorPending: false })).toBe(false);
    expect(bypassesSecondFactor({ twoFactorEnabledAt: null, mfaFor: ENROLLED })).toBe(false);
  });
});
