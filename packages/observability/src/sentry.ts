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

/* ── Env-driven bootstrap (wave 1 monitoring) ─────────────────────────────── */

/** The slice of @sentry/node (or @sentry/nextjs) we call. */
export interface SentrySdk {
  init(options: Record<string, unknown>): void;
  captureException(e: unknown, hint?: unknown): unknown;
  captureMessage(m: string, level?: string): unknown;
  setUser(u: { id: string; email?: string } | null): void;
  setTag(k: string, v: string): void;
}

export type SentryInitResult =
  | { enabled: true; service: string; environment: string }
  | { enabled: false; reason: 'no-dsn' | 'sdk-missing' | 'init-failed'; detail?: string };

const loadSentryNode = async (): Promise<SentrySdk> => {
  // Non-literal specifier: the SDK is OPTIONAL (bundlers must not require it).
  const pkg = '@sentry/node';
  return (await import(pkg)) as SentrySdk;
};

/**
 * Initialise Sentry from the environment. SENTRY_DSN unset → a no-op that
 * never throws (local dev, CI, tests, any deployment that hasn't opted in).
 * With a DSN: loads the SDK lazily (`pnpm add @sentry/node` in the app), sets
 * environment/release, disables tracing + default PII and routes every event
 * through scrubSentryEvent. Safe to call once per process.
 */
export async function initSentryFromEnv(opts: {
  service: 'web' | 'worker' | string;
  env?: NodeJS.ProcessEnv;
  loadSdk?: () => Promise<SentrySdk>;
}): Promise<SentryInitResult> {
  const env = opts.env ?? process.env;
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return { enabled: false, reason: 'no-dsn' };
  let sdk: SentrySdk;
  try {
    sdk = await (opts.loadSdk ?? loadSentryNode)();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[sentry] SENTRY_DSN is set but the SDK is not installed (${opts.service}): ${detail}`);
    return { enabled: false, reason: 'sdk-missing', detail };
  }
  const environment = env.SENTRY_ENV ?? env.VERCEL_ENV ?? env.NODE_ENV ?? 'development';
  try {
    sdk.init({
      dsn,
      environment,
      release: env.SENTRY_RELEASE ?? env.VERCEL_GIT_COMMIT_SHA ?? env.FLY_IMAGE_REF,
      serverName: opts.service,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: (event: Record<string, unknown>) => scrubSentryEvent(event),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[sentry] init failed (${opts.service}): ${detail}`);
    return { enabled: false, reason: 'init-failed', detail };
  }
  registerSentryClient({
    captureException: (e, c) => void sdk.captureException(e, c ? { extra: c } : undefined),
    captureMessage: (m, level) => void sdk.captureMessage(m, level),
    setUser: (u) => sdk.setUser(u),
    setTag: (k, v) => sdk.setTag(k, v),
  });
  sdk.setTag('service', opts.service);
  return { enabled: true, service: opts.service, environment };
}

/** Test hook: forget the registered client. */
export function resetSentryClientForTests(): void {
  _client = null;
}
