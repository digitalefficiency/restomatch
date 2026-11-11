import { CredentialsSignin } from 'next-auth';

/**
 * The `?e=` code /login/code shows for a failed code sign-in. A locked code
 * sign-in and the login limiter both arrive as CredentialsSignin code 'rate'
 * (one answer for any address — review N1) → "locked", no new-code invite.
 */
export function codeLoginErrorCode(err: unknown): 'rate' | 'wrongCode' {
  return err instanceof CredentialsSignin && (err.code === 'rate') ? 'rate' : 'wrongCode';
}
