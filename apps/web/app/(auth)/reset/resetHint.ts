/** httpOnly cookie (path /reset) carrying the address a reset link was requested for. */
export const RESET_HINT_COOKIE = 'rm_reset_hint';
/** Seconds before the "sent" state offers another reset link. */
export const RESET_RESEND_SEC = 60;

export function resetWaitSec(sentAt: number | null, now: number = Date.now()): number {
  if (!sentAt) return 0;
  return Math.max(0, Math.min(RESET_RESEND_SEC, Math.ceil((sentAt + RESET_RESEND_SEC * 1000 - now) / 1000)));
}
