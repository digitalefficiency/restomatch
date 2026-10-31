/**
 * The field outbox and the expired session (W1-06 × W1-04). The Delivery
 * Check sends its saves through the plain tRPC client, outside the
 * QueryClient's caches, so W1-04's UNAUTHORIZED handler never sees them. The
 * gate does it here: an expired session opens the re-auth sheet (no retry
 * callback — the row stays queued on the phone and is resent after sign-in)
 * and holds the automatic retries until then, so a dismissed sheet is not
 * re-opened every 15 s. A dropped network or a branch switch is NOT an
 * expired session: those keep the calm "saved on the phone" path.
 */
import { ScopeChangedError, SessionGoneError, classifyFailure } from './offlineQueue';

export function isSessionExpired(err: unknown): boolean {
  if (err instanceof SessionGoneError) return true;
  if (err instanceof ScopeChangedError) return false;
  return classifyFailure(err, true) === 'auth';
}

export interface AuthGate {
  /** Wrap a send: on an expired session, block, call `onExpired`, and rethrow (the row stays queued). */
  wrap<P, R>(send: (p: P) => Promise<R>): (p: P) => Promise<R>;
  /** The session expired and nobody signed in since. */
  readonly blocked: boolean;
  /** May the 15 s / `online` timer resend now? */
  shouldAutoRetry(): boolean;
  /** Signed in again: let the retries through. */
  resume(): void;
}

export function createAuthGate(onExpired: () => void): AuthGate {
  let blocked = false;
  return {
    wrap(send) {
      return async (p) => {
        try {
          return await send(p);
        } catch (err) {
          if (isSessionExpired(err)) {
            blocked = true;
            onExpired();
          }
          throw err;
        }
      };
    },
    get blocked() {
      return blocked;
    },
    shouldAutoRetry: () => !blocked,
    resume() {
      blocked = false;
    },
  };
}
