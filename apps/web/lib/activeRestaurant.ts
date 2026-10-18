/**
 * Which membership becomes the session's active restaurant (the jwt callback in
 * auth.ts). Pure so the trust rule is unit-tested:
 *
 *  • A requested branch (the branch switcher's `unstable_update`) wins ONLY when
 *    it is one of `rows` — the user's memberships, freshly read from the DB.
 *    The update payload can be hand-crafted by the browser (POST to the session
 *    endpoint), so it is never trusted on its own.
 *  • Otherwise keep the current active restaurant while its membership exists,
 *    else fall back to any membership (or none).
 */
export function pickActiveMembership<T extends { restaurantId: string }>(
  rows: readonly T[],
  current: string | null | undefined,
  requested?: unknown,
): T | undefined {
  if (typeof requested === 'string' && requested) {
    const wanted = rows.find((m) => m.restaurantId === requested);
    if (wanted) return wanted;
  }
  const active = current ? rows.find((m) => m.restaurantId === current) : undefined;
  return active ?? rows[0];
}

/** The branch id a session update asked for, if any (`unstable_update({ activeRestaurantId })`). */
export function requestedRestaurantOf(update: unknown): string | undefined {
  const v = (update as { activeRestaurantId?: unknown } | null | undefined)?.activeRestaurantId;
  return typeof v === 'string' && v ? v : undefined;
}
