/** httpOnly cookie (path /reset) carrying the address a reset link was requested for. */
export const RESET_HINT_COOKIE = 'rm_reset_hint';
/**
 * Seconds of the "resend" UX countdown in the reset "sent" state. Not a rate
 * limit (the cookie is client-held and the server does not check it): the real
 * limit is enforcePasswordResetLimit in requestPasswordResetAction.
 */
export const RESET_RESEND_SEC = 60;

export function resetWaitSec(sentAt: number | null, now: number = Date.now()): number {
  if (!sentAt) return 0;
  return Math.max(0, Math.min(RESET_RESEND_SEC, Math.ceil((sentAt + RESET_RESEND_SEC * 1000 - now) / 1000)));
}
