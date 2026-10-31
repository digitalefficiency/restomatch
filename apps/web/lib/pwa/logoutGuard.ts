/**
 * Sign-out with unsent invoice photos (mobile-field-01, auth-01 guard side).
 *
 * Signing out used to wipe the device queue silently, so invoices shot in the
 * walk-in with no signal were lost (and their leak never reached the owner).
 * Now:
 *  - nothing queued → sign out;
 *  - online → upload first, then sign out;
 *  - still queued (offline, or an upload failed) → ask, naming the count:
 *    wait for the network (cancel), sign out and keep them on the phone
 *    (attributed to their user — they upload when that user signs in again),
 *    or delete them and sign out. Deleting happens ONLY on that explicit choice.
 *
 * Pure: every effect is injected, so the rule is unit-tested.
 */

export type LogoutChoice = 'wait' | 'keep' | 'delete';

export interface LogoutGuardDeps {
  /** This user's queued photos on the device. */
  countMine: () => Promise<number>;
  online: () => boolean;
  /** Upload this user's queued photos; resolves with how many are still queued. */
  flush: () => Promise<number>;
  /** Show the sheet; resolves with the receiver's choice. */
  ask: (queued: number) => Promise<LogoutChoice>;
  /** Delete this user's queued photos. Called only after `ask` → 'delete'. */
  clearMine: () => Promise<void>;
  proceed: () => void;
  /** Optional progress hook ("uploading N photos before signing out"). */
  onFlushing?: (count: number) => void;
}

export type LogoutOutcome = 'signed-out' | 'flushed-then-signed-out' | 'kept' | 'deleted' | 'cancelled';

export async function runLogoutGuard(d: LogoutGuardDeps): Promise<LogoutOutcome> {
  let queued = await d.countMine().catch(() => 0);
  if (queued === 0) {
    d.proceed();
    return 'signed-out';
  }
  if (d.online()) {
    d.onFlushing?.(queued);
    queued = await d.flush().catch(() => queued);
    if (queued === 0) {
      d.proceed();
      return 'flushed-then-signed-out';
    }
  }
  const choice = await d.ask(queued);
  if (choice === 'wait') return 'cancelled';
  if (choice === 'delete') {
    await d.clearMine();
    d.proceed();
    return 'deleted';
  }
  d.proceed();
  return 'kept';
}
