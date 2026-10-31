import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
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
 * - `UNAUTHORIZED` anywhere parks a retry and opens the re-auth sheet in place
 *   (perf-states-15); a network failure re-checks connectivity.
 */
export function createAppQueryClient(): QueryClient {
  const onFailure = (err: unknown, retry: () => unknown) => {
    if (isUnauthorized(err)) requestReauth(retry);
    else if (isNetworkError(err)) reportNetworkFailure();
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => onFailure(err, () => client.refetchQueries({ queryKey: query.queryKey, exact: true })),
    }),
    mutationCache: new MutationCache({
      // Replays the SAME mutation object, so the screen's useMutation state and
      // hook-level callbacks see the retried result.
      onError: (err, variables, _ctx, mutation) => onFailure(err, () => mutation.execute(variables)),
    }),
    defaultOptions: {
      queries: { staleTime: QUERY_STALE_MS, retry: shouldRetryQuery },
      mutations: { networkMode: 'always' },
    },
  });
  return client;
}
