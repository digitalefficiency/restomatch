/**
 * G-16 (money-swallow), routed to W2-11: a failed read must never render as
 * ₪0 or an empty list. Each optional read on the supplier leak card settles
 * to its value, "gated" (the plan doesn't include it: a calm upsell), or
 * "unavailable" (any other failure: a neutral "לא זמין · נסו שוב").
 * Pure; unit-tested.
 */
export type Settled<T> = { state: 'ok'; value: T } | { state: 'gated' } | { state: 'unavailable' };

export async function settle<T>(read: Promise<T>, isGated: (err: unknown) => boolean = () => false): Promise<Settled<T>> {
  try {
    return { state: 'ok', value: await read };
  } catch (err) {
    return isGated(err) ? { state: 'gated' } : { state: 'unavailable' };
  }
}
