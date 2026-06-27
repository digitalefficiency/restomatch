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

const REDACTED = '[redacted]';

/**
 * Keys whose VALUE is always dropped (credentials/PII), regardless of content.
 * Matched case-insensitively as a substring of the key name.
 */
const SENSITIVE_KEY_RE =
  /(authorization|cookie|set-cookie|password|secret|token|api[-_]?key|access[-_]?key|session|email|phone|connection[-_]?string|database[-_]?url|auth[-_]?secret|service[-_]?role)/i;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Phone-ish runs of 7+ digits with optional separators / leading +.
const PHONE_RE = /(?<![\w.])\+?\d[\d\s().-]{6,}\d(?![\w.])/g;

/** Redact PII-shaped substrings inside a free-text string. */
export function redactString(input: string): string {
  return input.replace(EMAIL_RE, '[redacted-email]').replace(PHONE_RE, '[redacted-phone]');
}

/**
 * Deep-scrub a value before it leaves the process for Sentry (E.9 — keep PII /
 * secrets out of the error pipeline / sub-processor). Sensitive KEYS are dropped
 * entirely; string VALUES have email/phone substrings masked. Cycles and
 * over-deep structures are bounded.
 */
export function scrubPii(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return REDACTED;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => scrubPii(v, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTED : scrubPii(v, depth + 1, seen);
  }
  return out;
}

/**
 * Scrub a Sentry event in place-ish (returns a scrubbed shallow copy). Wire this
 * as the `beforeSend` hook when initializing the real SDK:
 *
 *   Sentry.init({ dsn, beforeSend: scrubSentryEvent })
 */
export function scrubSentryEvent<T extends Record<string, unknown>>(event: T): T {
  const e = { ...event } as Record<string, unknown>;
  if (e.request && typeof e.request === 'object') {
    const req = { ...(e.request as Record<string, unknown>) };
    if ('data' in req) req.data = scrubPii(req.data);
    if ('cookies' in req) req.cookies = REDACTED;
    if ('headers' in req) req.headers = scrubPii(req.headers);
    if ('query_string' in req && typeof req.query_string === 'string') {
      req.query_string = redactString(req.query_string);
    }
    e.request = req;
  }
  if (e.extra) e.extra = scrubPii(e.extra);
  if (e.contexts) e.contexts = scrubPii(e.contexts);
  if (e.user && typeof e.user === 'object') {
    const u = { ...(e.user as Record<string, unknown>) };
    // Keep a stable id for grouping; drop direct identifiers.
    delete u.email;
    delete u.username;
    delete u.ip_address;
    e.user = u;
  }
  return e as T;
}

let _client: SentryClient | null = null;

export function registerSentryClient(client: SentryClient): void {
  _client = client;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  // Defense-in-depth: scrub structured context here too, so even no-SDK paths
  // and clients that forgo beforeSend never forward raw PII/secrets.
  const safeContext =
    context !== undefined ? (scrubPii(context) as Record<string, unknown>) : undefined;
  if (_client) {
    _client.captureException(error, safeContext);
  } else if (process.env.NODE_ENV !== 'production') {
    console.error('[sentry:noop]', error, safeContext);
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
