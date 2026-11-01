import type { AnswerBody } from './logic';

/**
 * The answer this browser last tried to send, kept for ONE page load after a
 * 409 so the page can tell the supplier's own retried answer from someone
 * else's (W1-09 review #6). Session storage, per link; read once, then gone.
 */
const key = (token: string) => `rm-portal-attempt:${token.slice(0, 16)}`;

export function rememberAttempt(token: string, body: AnswerBody): void {
  try {
    sessionStorage.setItem(key(token), JSON.stringify(body));
  } catch {
    /* private mode / storage off: the page falls back to the plain "already answered" text */
  }
}

export function takeAttempt(token: string): AnswerBody | null {
  try {
    const raw = sessionStorage.getItem(key(token));
    if (!raw) return null;
    sessionStorage.removeItem(key(token));
    const v = JSON.parse(raw) as AnswerBody;
    return Array.isArray(v?.lines) ? v : null;
  } catch {
    return null;
  }
}
