/**
 * After a sign-in from the re-auth sheet, what may the still-mounted page do?
 * Pure (unit tested); ShellResilience performs the outcome.
 *
 * - `resume`: the same person, same branch → re-fetch the parked reads.
 * - `switchBack`: same person, but the fresh session opened another branch
 *   (a new login lands on the oldest membership) → restore the branch the page
 *   belongs to BEFORE anything re-runs (W1-04 review, blocker 3).
 * - `reload`: someone else signed in, or we never learned whose page this is →
 *   drop everything and reload home (review minor 6: one worker's screen never
 *   acts for another on a shared tablet).
 */

export interface PageOwner {
  id: string;
  restaurantId: string | null;
}

export interface SignedIn {
  id: string;
  restaurantId: string | null;
  pending: boolean;
}

export type AfterSignIn =
  | { kind: 'stillOut' }
  | { kind: 'twoFactor' }
  | { kind: 'reload' }
  | { kind: 'switchBack'; restaurantId: string }
  | { kind: 'resume' };

export function decideAfterSignIn(owner: PageOwner | null, now: SignedIn | null): AfterSignIn {
  if (!now) return { kind: 'stillOut' };
  if (now.pending) return { kind: 'twoFactor' };
  if (!owner || owner.id !== now.id) return { kind: 'reload' };
  if (owner.restaurantId && now.restaurantId !== owner.restaurantId) {
    return { kind: 'switchBack', restaurantId: owner.restaurantId };
  }
  return { kind: 'resume' };
}
