/**
 * The cockpit's optional ₪ reads (VAT at risk, the consolidated cross-match).
 * A failed read is NEVER "nothing here" or ₪0 (G-16 money-swallow): it is an
 * explicit "couldn't load" — a neutral banner with retry — and its section stays out.
 */
export type Settled<T> = { ok: true; value: T } | { ok: false } | null;

/** null = the read wasn't asked for (flag/role off); { ok:false } = it failed. */
export const settled = <T,>(p: Promise<T>): Promise<Settled<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  );

/** True when any asked-for read failed. */
export const anyFailed = (...reads: Settled<unknown>[]): boolean => reads.some((r) => r?.ok === false);

/** The value of a read that succeeded; null when it failed or wasn't asked for. */
export const valueOf = <T,>(r: Settled<T>): T | null => (r?.ok ? r.value : null);
