import { describe, expect, it } from 'vitest';
import { inviteFailure } from '../failure';

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
