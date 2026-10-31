import { describe, expect, it } from 'vitest';
import { invitationExpired, inviteFailure } from '../failure';

describe('invite failure states (auth-11)', () => {
  it('maps each acceptInvite appCode to its own state', () => {
    expect(inviteFailure({ cause: { appCode: 'team.inviteExpired' } })).toBe('expired');
    expect(inviteFailure({ cause: { appCode: 'team.inviteWrongEmail' } })).toBe('wrongEmail');
    expect(inviteFailure({ data: { appCode: 'team.inviteUsed' } })).toBe('used');
    expect(inviteFailure({ cause: { appCode: 'team.inviteNotFound' } })).toBe('notFound');
  });

  it('anything else is the generic state', () => {
    expect(inviteFailure(new Error('boom'))).toBe('other');
    expect(inviteFailure(null)).toBe('other');
    expect(inviteFailure({ cause: { appCode: 'auth.forbidden' } })).toBe('other');
  });
});

describe('an expired invite stays EXPIRED on every open', () => {
  const now = new Date('2026-10-31T10:00:00Z');
  it('the status flipped by the first open still reads as expired', () => {
    expect(invitationExpired({ status: 'expired', expiresAt: new Date('2026-10-20T00:00:00Z') }, now)).toBe(true);
    expect(invitationExpired({ status: 'pending', expiresAt: new Date('2026-10-30T00:00:00Z') }, now)).toBe(true);
  });
  it('a used or revoked invite is not called expired', () => {
    expect(invitationExpired({ status: 'accepted', expiresAt: new Date('2026-10-20T00:00:00Z') }, now)).toBe(false);
    expect(invitationExpired({ status: 'revoked', expiresAt: new Date('2026-11-20T00:00:00Z') }, now)).toBe(false);
    expect(invitationExpired({ status: 'pending', expiresAt: new Date('2026-11-20T00:00:00Z') }, now)).toBe(false);
  });
});
