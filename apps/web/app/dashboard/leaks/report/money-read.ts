/**
 * G-16 (money-swallow), routed to W3-08: a failed money read never renders as an
 * empty list or ₪0. A read is settled into ok / failed, and the screen says
 * "לא זמין" (neutral T4) for a failed one instead of quietly hiding the figure.
 */
export type Settled<T> = { ok: true; value: T } | { ok: false };

export function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  );
}

export type NoteState<R> = { kind: 'off' } | { kind: 'unavailable' } | { kind: 'items'; items: R[] };

/**
 * The "approved but in no credit request" note under the claimed figure.
 *   - tracker off (`tracked` is null): no note at all;
 *   - either read failed: unavailable, never "nothing to say";
 *   - otherwise the computed items (possibly none).
 */
export function resolvedNoteState<L, T, R>(
  lines: Settled<L>,
  tracked: Settled<T> | null,
  compute: (lines: L, tracked: T) => R[],
): NoteState<R> {
  if (tracked === null) return { kind: 'off' };
  if (!lines.ok || !tracked.ok) return { kind: 'unavailable' };
  return { kind: 'items', items: compute(lines.value, tracked.value) };
}
