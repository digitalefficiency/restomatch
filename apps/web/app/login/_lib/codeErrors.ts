import { CredentialsSignin } from 'next-auth';

/**
 * Thrown from the `email-code` authorize() when code sign-in is locked for the
 * account (5 wrong codes in 10 min, or the 24 h cap). Carries `code = 'locked'`
 * so /login/code says "too many attempts" and does NOT invite a new code that
 * would be burned on the first try (security review M5).
 */
export class LoginCodeLocked extends CredentialsSignin {
  override code = 'locked';
}

/** The `?e=` code /login/code shows for a failed code sign-in. */
export function codeLoginErrorCode(err: unknown): 'rate' | 'wrongCode' {
  return err instanceof CredentialsSignin && (err.code === 'rate' || err.code === 'locked') ? 'rate' : 'wrongCode';
}
