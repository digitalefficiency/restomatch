import { safeRelativePath } from '@/lib/safeRedirect';
import { FORBIDDEN_PATH } from './access';

/**
 * `/dashboard/go?r=<restaurantId>&to=<path>` — the branch-aware deep link
 * (ia-nav-08/-09; lens-ia-nav §8.3, §10.5). Every link that leaves the app
 * (e-mail, WhatsApp, push, PDF) should go through it, so a multi-branch owner
 * lands on the object in the RIGHT branch instead of "already handled".
 *
 * Pure decision (unit tested); the route handler supplies the session and the
 * two side effects. Never trusts `r`: membership is re-checked by the same
 * `chain.switchTarget` the branch switcher uses, and the session update is
 * re-validated again by the jwt callback (lib/activeRestaurant.ts).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `to` as a same-origin /dashboard path (never back into the resolver), else /dashboard. */
export function goTarget(raw: unknown): string {
  const safe = safeRelativePath(raw, '/dashboard');
  const path = safe.split(/[?#]/)[0] ?? '';
  if (path === '/dashboard/go' || path.startsWith('/dashboard/go/')) return '/dashboard';
  return path === '/dashboard' || path.startsWith('/dashboard/') ? safe : '/dashboard';
}

export interface GoDeps {
  /** Throws unless the signed-in user is a member of `restaurantId`. */
  checkMembership(restaurantId: string): Promise<unknown>;
  /** Make `restaurantId` the session's active branch. */
  switchTo(restaurantId: string): Promise<unknown>;
}

export interface GoResult {
  location: string;
  outcome: 'same' | 'switched' | 'refused' | 'noBranch';
}

export function refusedLocation(to: string): string {
  return `${FORBIDDEN_PATH}?${new URLSearchParams({ reason: 'notMember', from: to }).toString()}`;
}

export async function resolveGo(
  input: { r: string | null; to: string | null; activeRestaurantId: string | null },
  deps: GoDeps,
): Promise<GoResult> {
  const to = goTarget(input.to);
  const r = input.r?.trim() ?? '';
  if (!r) return { location: to, outcome: 'noBranch' };
  if (!UUID.test(r)) return { location: refusedLocation(to), outcome: 'refused' };
  if (r === input.activeRestaurantId) return { location: to, outcome: 'same' };
  try {
    await deps.checkMembership(r);
  } catch {
    return { location: refusedLocation(to), outcome: 'refused' };
  }
  await deps.switchTo(r);
  return { location: to, outcome: 'switched' };
}
