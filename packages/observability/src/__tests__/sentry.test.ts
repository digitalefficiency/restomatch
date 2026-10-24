import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureException,
  initSentryFromEnv,
  isSentryEnabled,
  resetSentryClientForTests,
  type SentrySdk,
} from '../sentry';

function fakeSdk() {
  const calls: { init?: Record<string, unknown>; captured: unknown[]; tags: Record<string, string> } = { captured: [], tags: {} };
  const sdk: SentrySdk = {
    init: (o) => void (calls.init = o),
    captureException: (e, hint) => void calls.captured.push({ e, hint }),
    captureMessage: () => undefined,
    setUser: () => undefined,
    setTag: (k, v) => void (calls.tags[k] = v),
  };
  return { sdk, calls };
}

afterEach(() => {
  resetSentryClientForTests();
  vi.restoreAllMocks();
});

describe('initSentryFromEnv — the DSN is optional', () => {
  it('without SENTRY_DSN: disabled, never loads the SDK, capture is a no-op', async () => {
    const loadSdk = vi.fn();
    const res = await initSentryFromEnv({ service: 'worker', env: {}, loadSdk });
    expect(res).toEqual({ enabled: false, reason: 'no-dsn' });
    expect(loadSdk).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => captureException(new Error('x'))).not.toThrow();
  });

  it('with a DSN but no SDK installed: warns, stays disabled, does not throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await initSentryFromEnv({
      service: 'web',
      env: { SENTRY_DSN: 'https://k@o0.ingest.sentry.io/1' },
      loadSdk: () => Promise.reject(new Error("Cannot find package '@sentry/node'")),
    });
    expect(res).toMatchObject({ enabled: false, reason: 'sdk-missing' });
    expect(warn).toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });

  it('with a DSN + SDK: inits with PII scrubbing, no tracing, release + service tag', async () => {
    const { sdk, calls } = fakeSdk();
    const res = await initSentryFromEnv({
      service: 'worker',
      env: { SENTRY_DSN: 'https://k@o0.ingest.sentry.io/1', SENTRY_ENV: 'staging', FLY_IMAGE_REF: 'img:abc' },
      loadSdk: async () => sdk,
    });
    expect(res).toEqual({ enabled: true, service: 'worker', environment: 'staging' });
    expect(calls.init).toMatchObject({ environment: 'staging', release: 'img:abc', sendDefaultPii: false, tracesSampleRate: 0 });
    expect(calls.tags.service).toBe('worker');
    const scrubbed = (calls.init!.beforeSend as (e: Record<string, unknown>) => Record<string, unknown>)({
      extra: { email: 'owner@kfar.test', note: 'call 052-123-4567' },
    });
    expect(JSON.stringify(scrubbed)).not.toMatch(/owner@kfar\.test|052-123-4567/);
    captureException(new Error('boom'), { password: 'p' });
    expect(JSON.stringify(calls.captured)).not.toContain('"p"');
  });
});

describe('scrubSentryEvent covers the free-text fields', () => {
  it('masks emails/phones in message, exception values and breadcrumbs', async () => {
    const { scrubSentryEvent } = await import('../sentry');
    const out = scrubSentryEvent({
      message: 'login failed for owner@kfar.test',
      exception: { values: [{ type: 'Error', value: 'call 052-123-4567 or owner@kfar.test' }] },
      breadcrumbs: [{ category: 'console', message: '[match-invoice] job=1 failed: owner@kfar.test' }],
    });
    expect(JSON.stringify(out)).not.toMatch(/owner@kfar\.test|052-123-4567/);
    expect((out.exception as { values: Array<{ type: string }> }).values[0]!.type).toBe('Error');
  });
});
