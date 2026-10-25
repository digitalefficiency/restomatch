/**
 * team.acceptInvite failure → which calm state the invite page shows (auth-11).
 * Keyed on the API's stable appCode (cause.appCode on a server-side caller,
 * data.appCode over HTTP), never on message text.
 */
export type InviteFailure = 'expired' | 'wrongEmail' | 'used' | 'notFound' | 'other';

export function inviteFailure(err: unknown): InviteFailure {
  const e = (err ?? {}) as { cause?: { appCode?: unknown } | null; data?: { appCode?: unknown } | null };
  switch (e.cause?.appCode ?? e.data?.appCode) {
    case 'team.inviteExpired':
      return 'expired';
    case 'team.inviteWrongEmail':
      return 'wrongEmail';
    case 'team.inviteUsed':
      return 'used';
    case 'team.inviteNotFound':
      return 'notFound';
    default:
      return 'other';
  }
}
