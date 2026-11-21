import { CredentialsSignin } from 'next-auth';

/**
 * Thrown from the Credentials authorize() when the email or IP login limiter
 * denies. Auth.js v5 carries `code` to the caller (`?code=rate` on the callback
 * redirect, `err.code` from a server-action signIn), so the login page can say
 * "too many attempts" instead of "wrong password" to someone whose password is
 * right but who shares a throttled network (a restaurant's Wi-Fi).
 *
 * It reveals no account state: the limiters key on any email string and the IP,
 * never on whether the account exists or is locked. A wrong password and the
 * per-account DB lockout stay the plain, uniform CredentialsSignin.
 *
 * Accepted residual (warden, PR #221): because a success clears the per-account
 * counter, "rate" vs "wrong password" can hint whether an address had recent
 * successful logins — a weak account-activity signal; a timing channel already
 * existed, and the probe itself spends the attacker's own attempts.
 */
export class LoginRateLimited extends CredentialsSignin {
  override code = 'rate';
}

/** The `?error=` code the login page should show for a failed password sign-in. */
export function loginErrorCode(err: unknown): 'rate' | 'CredentialsSignin' {
  return err instanceof CredentialsSignin && err.code === 'rate' ? 'rate' : 'CredentialsSignin';
}
