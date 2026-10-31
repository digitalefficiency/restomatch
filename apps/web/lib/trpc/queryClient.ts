import { hashKey, MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isNetworkError, isUnauthorized, shouldRetryQuery } from '@/lib/net/errorKind';
import { reportNetworkFailure } from '@/lib/net/online';
import { requestReauth } from '@/lib/net/reauth';

/**
 * Server-seeded lists hand their rows over as `initialData`; with the default
 * `staleTime: 0` every one of them was fetched again right after hydration
 * (perf-states-04). 30 s keeps the SSR rows; focus refetch keeps them fresh.
 */
export const QUERY_STALE_MS = 30_000;

/**
 * The app's QueryClient defaults (W1-04):
 * - queries: 30 s stale, no retry for 4xx (a retry can't fix a bad request or
 *   a missing session — it only delays the error by ~7 s);
 * - mutations: `networkMode: 'always'` — offline, a money decision FAILS at
 *   once with a network error shown inline, instead of pausing silently and
 *   firing later without the user knowing (perf-states-08);
 * - `UNAUTHORIZED` opens the re-auth sheet in place (perf-states-15). A failed
 *   READ is re-fetched once after sign-in; a failed MUTATION is never replayed —
 *   it rejects to its caller as "not sent" and the user re-taps (a replay
 *   detached from the caller could double-submit a PO or an approval).
 * - a network failure re-checks connectivity.
 */
export function createAppQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        if (isUnauthorized(err)) {
          requestReauth(() => client.refetchQueries({ queryKey: query.queryKey, exact: true }), hashKey(query.queryKey));
        } else if (isNetworkError(err)) reportNetworkFailure();
      },
    }),
    mutationCache: new MutationCache({
      onError: (err) => {
        if (isUnauthorized(err)) requestReauth();
        else if (isNetworkError(err)) reportNetworkFailure();
      },
    }),
    defaultOptions: {
      queries: { staleTime: QUERY_STALE_MS, retry: shouldRetryQuery },
      mutations: { networkMode: 'always' },
    },
  });
  return client;
}

/**
 * A client navigation landed on a new route: drop the cached queries no screen
 * is watching, so a revisited list renders its fresh server `initialData`
 * instead of a 30 s-old client copy (a PO marked received elsewhere must not
 * show "sent"). Active queries — the header search, the new page — stay.
 */
export function onRouteChange(client: QueryClient): void {
  client.removeQueries({ type: 'inactive' });
}
