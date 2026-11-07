/**
 * W3-02 · what the owner-overview recipes card shows (G-16 money-swallow fix).
 * Before this, a failed `recipes.changes` hid the card, and a failed
 * `recipes.priceAlerts` became "no alerts", so a broken query looked like
 * calm news. Now a failure is stated: a neutral T4 "unavailable" line with no
 * ₪ and no zero. Pure, so it is unit-tested.
 */
export type Fetched<T> = { ok: true; data: T } | { ok: false };

export type CardState<C, A> =
  /** The flag is off (or the caller can't see recipes): the feature stays invisible. */
  | { kind: 'hidden' }
  /** recipes.changes failed: the card says so, with no dishes and no ₪. */
  | { kind: 'unavailable' }
  | {
      kind: 'ready';
      changes: C;
      /** null = the alerts flag is off; 'unavailable' = the query failed (shown as a note, never as "no alerts"). */
      alerts: A | null | 'unavailable';
    };

export function overviewCardState<C, A extends { enabled: boolean }>(
  enabled: Fetched<{ enabled: boolean }>,
  changes: Fetched<C> | null,
  alerts: Fetched<A> | null,
): CardState<C, A> {
  if (!enabled.ok || !enabled.data.enabled) return { kind: 'hidden' };
  if (!changes || !changes.ok) return { kind: 'unavailable' };
  const a = !alerts ? null : !alerts.ok ? ('unavailable' as const) : alerts.data.enabled ? alerts.data : null;
  return { kind: 'ready', changes: changes.data, alerts: a };
}

/** Await a promise into a Fetched (logs the error: never a silent swallow). */
export async function fetched<T>(p: Promise<T>, label: string): Promise<Fetched<T>> {
  try {
    return { ok: true, data: await p };
  } catch (err) {
    console.error(`[recipes-overview-card] ${label} failed`, err);
    return { ok: false };
  }
}
