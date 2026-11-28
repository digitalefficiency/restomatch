/**
 * The approvals tiles' server refresh after a decision settles (W1-07 / W2-04).
 *
 * Two rules, both needed:
 *  1. Only the NEWEST refresh may land (a seq guard): an older, slower response
 *     never overwrites fresher tiles.
 *  2. Every refresh starts a NEW request: react-query dedups a fetch onto a
 *     request already in flight, so an undo that settles while the approve's
 *     refresh is still running would get the approve's (stale) count, and the
 *     seq guard would accept it (e2e W1-07 "10 s undo that really reopens":
 *     8 instead of 9). So the in-flight request is cancelled first.
 */
export interface SummaryRefreshDeps<T> {
  /** Cancel the in-flight summary request (react-query `cancelQueries`). */
  cancel: () => Promise<void>;
  /** Fetch the summary afresh (react-query `fetchQuery`, staleTime 0). */
  fetch: () => Promise<T>;
  /** Apply the result to the tiles. */
  apply: (value: T) => void;
}

export function makeSummaryRefresher<T>(deps: SummaryRefreshDeps<T>): () => Promise<void> {
  let latest = 0;
  return async () => {
    const seq = ++latest;
    try {
      await deps.cancel();
      const fresh = await deps.fetch();
      if (seq === latest) deps.apply(fresh);
    } catch {
      /* cancelled by a newer refresh, or failed: the optimistic numbers stay */
    }
  };
}
