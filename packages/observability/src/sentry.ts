/**
 * Sentry — lazy-loaded so dev/test runs without the SDK installed.
 *
 * Set env vars to enable:
 *   SENTRY_DSN — project DSN
 *   SENTRY_ENV — "production" | "staging" | "development"
 *
 * Production: `pnpm add @sentry/nextjs @sentry/node` to apps that need them.
 * The functions here are no-ops if Sentry isn't set up — application code
 * can call them unconditionally.
 */

export interface SentryClient {
  captureException(error: unknown, context?: Record<string, unknown>): void;
  captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
  setUser(user: { id: string; email?: string }): void;
  setTag(key: string, value: string): void;
}

let _client: SentryClient | null = null;

export function registerSentryClient(client: SentryClient): void {
  _client = client;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (_client) {
    _client.captureException(error, context);
  } else if (process.env.NODE_ENV !== 'production') {
    console.error('[sentry:noop]', error, context);
  }
}

export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (_client) {
    _client.captureMessage(message, level);
  }
}

export function setSentryUser(user: { id: string; email?: string }): void {
  if (_client) {
    _client.setUser(user);
  }
}

export function setSentryTag(key: string, value: string): void {
  if (_client) {
    _client.setTag(key, value);
  }
}

export function isSentryEnabled(): boolean {
  return _client !== null;
}
