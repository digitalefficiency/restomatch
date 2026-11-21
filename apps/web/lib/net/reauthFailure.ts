/**
 * Which state the re-auth sheet shows after a failed password sign-in
 * (next-auth/react signIn result, redirect:false). A throttled attempt
 * (LoginRateLimited, `code: 'rate'`) says "too many attempts"; every other
 * failure — wrong password, locked account, network error — stays the uniform
 * "wrong" state so it reveals nothing about the account.
 */
export function reauthFailureKind(res: { error?: string | null; code?: string | null } | undefined | null): 'rate' | 'wrong' {
  return res?.error && res.code === 'rate' ? 'rate' : 'wrong';
}
