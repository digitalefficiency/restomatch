import { afterEach, describe, expect, it, vi } from 'vitest';
import { friendlyError } from '@/lib/components/errors';
import { wrapRouterPush, ROUTE_START_EVENT } from '@/lib/components/routeProgressState';
import { createTranslator } from '@/lib/i18n/translate';
import { components } from '@/lib/i18n/messages/components';
import { isClientError, isNetworkError, isUnauthorized, shouldRetryQuery } from '../errorKind';
import { probe } from '../online';
import { abandonReauth, completeReauth, dismissReauth, pendingRetries, requestReauth } from '../reauth';

const trpcError = (code: string, httpStatus = 400) =>
  Object.assign(new Error(code), { data: { code, httpStatus } });

describe('friendlyError: an expired session is not "no permission" (perf-states-15)', () => {
  for (const locale of ['he', 'en'] as const) {
    it(`[${locale}] UNAUTHORIZED ≠ FORBIDDEN`, () => {
      const t = createTranslator(locale, components);
      const expired = friendlyError(trpcError('UNAUTHORIZED', 401), t);
      const forbidden = friendlyError(trpcError('FORBIDDEN', 403), t);
      expect(expired).not.toBe(forbidden);
      expect(forbidden).toBe(t('errors.forbidden'));
      expect(expired).toMatch(locale === 'he' ? /ההתחברות פגה/ : /session expired/i);
    });
  }
  it('a network failure is the network message', () => {
    const t = createTranslator('he', components);
    expect(friendlyError(new TypeError('Failed to fetch'), t)).toBe(t('errors.network'));
  });
});

describe('error kinds', () => {
  it('classifies tRPC and network errors', () => {
    expect(isUnauthorized(trpcError('UNAUTHORIZED', 401))).toBe(true);
    expect(isUnauthorized(trpcError('FORBIDDEN', 403))).toBe(false);
    expect(isClientError(trpcError('NOT_FOUND', 404))).toBe(true);
    expect(isClientError(trpcError('INTERNAL_SERVER_ERROR', 500))).toBe(false);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(trpcError('INTERNAL_SERVER_ERROR', 500))).toBe(false);
  });
  it('queries never retry a 4xx (it only delays the error); server errors get 2 retries', () => {
    expect(shouldRetryQuery(0, trpcError('UNAUTHORIZED', 401))).toBe(false);
    expect(shouldRetryQuery(0, trpcError('FORBIDDEN', 403))).toBe(false);
    expect(shouldRetryQuery(0, trpcError('INTERNAL_SERVER_ERROR', 500))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(2, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('re-auth store', () => {
  afterEach(() => abandonReauth());

  it('parks retries and replays each exactly once after sign-in', () => {
    const a = vi.fn();
    const b = vi.fn(() => Promise.reject(new Error('again')));
    requestReauth(a);
    requestReauth(b);
    expect(pendingRetries()).toBe(2);
    expect(completeReauth()).toBe(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(completeReauth()).toBe(0);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('dismissing the sheet drops the parked reads (nothing stale replays later)', () => {
    const a = vi.fn();
    requestReauth(a);
    dismissReauth();
    expect(pendingRetries()).toBe(0);
    abandonReauth();
    expect(pendingRetries()).toBe(0);
    completeReauth();
    expect(a).not.toHaveBeenCalled();
  });
});

describe('app QueryClient defaults (perf-states-04/-08/-15)', () => {
  afterEach(() => abandonReauth());

  it('30 s staleTime for queries; mutations fail fast offline (networkMode always)', async () => {
    const { createAppQueryClient, QUERY_STALE_MS } = await import('@/lib/trpc/queryClient');
    const qc = createAppQueryClient();
    expect(QUERY_STALE_MS).toBe(30_000);
    expect(qc.getDefaultOptions().queries?.staleTime).toBe(30_000);
    expect(qc.getDefaultOptions().mutations?.networkMode).toBe('always');
  });

  it('a FORBIDDEN mutation does not open the re-auth sheet', async () => {
    const { createAppQueryClient } = await import('@/lib/trpc/queryClient');
    const qc = createAppQueryClient();
    const mutation = qc.getMutationCache().build(qc, {
      mutationFn: async () => {
        throw trpcError('FORBIDDEN', 403);
      },
    });
    await expect(mutation.execute(undefined)).rejects.toThrow();
    expect(pendingRetries()).toBe(0);
  });
});

describe('connectivity probe', () => {
  it('true only for an OK answer inside the timeout', async () => {
    expect(await probe((async () => new Response(null, { status: 200 })) as typeof fetch)).toBe(true);
    expect(await probe((async () => new Response(null, { status: 503 })) as typeof fetch)).toBe(false);
    expect(await probe((async () => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch)).toBe(false);
    const hang = ((_u: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    expect(await probe(hang, 20)).toBe(false);
  });
});

describe('RouteProgress: router.push starts the bar (perf-states-01 d)', () => {
  it('wraps push once and dispatches the start event for a cross-route push', () => {
    const events: string[] = [];
    const doc = new EventTarget();
    doc.addEventListener(ROUTE_START_EVENT, (e) => events.push((e as CustomEvent<{ target: string }>).detail.target));
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { location: new URL('https://app.test/dashboard/orders/new') });
    try {
      const calls: string[] = [];
      const router = { push: (href: string) => void calls.push(href) };
      expect(wrapRouterPush(router)).toBe(true);
      expect(wrapRouterPush(router)).toBe(false); // idempotent
      router.push('/dashboard/orders/abc');
      router.push('/dashboard/orders/new?step=2'); // same path: no bar
      expect(calls).toEqual(['/dashboard/orders/abc', '/dashboard/orders/new?step=2']);
      expect(events).toEqual(['/dashboard/orders/abc']);
      expect(wrapRouterPush(undefined)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
