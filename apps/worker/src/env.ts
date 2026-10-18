/**
 * Fail-fast environment validation for the worker.
 *
 * The worker silently no-ops without its secrets (no REDIS_URL → BullMQ never
 * processes a job; no ANTHROPIC_API_KEY → OCR/PO parsing throws per-job; no
 * RESEND_API_KEY → outbox email parks failed). Call assertWorkerEnv() once at
 * startup to turn a misconfigured production deploy into a LOUD boot failure
 * instead of a process that looks healthy but does nothing.
 *
 * Plain checks (no zod) — the worker package has no zod dependency.
 */
export interface WorkerEnv {
  DATABASE_URL: string;
  REDIS_URL?: string;
  ANTHROPIC_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SENTRY_DSN?: string;
}

export function assertWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  if (!env.DATABASE_URL || env.DATABASE_URL.trim() === '') {
    throw new Error('[env] DATABASE_URL is required for the worker');
  }
  if (env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!env.REDIS_URL) missing.push('REDIS_URL — BullMQ queues (no OCR/match/cron runs without it)');
    if (!env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY — invoice OCR / PO parsing');
    if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY — outbox email dispatch');
    if (!env.EMAIL_FROM) missing.push('EMAIL_FROM — sender domain');
    if (missing.length > 0) {
      throw new Error(`[env] missing required worker production env:\n - ${missing.join('\n - ')}`);
    }
  }
  return {
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    RESEND_API_KEY: env.RESEND_API_KEY,
    EMAIL_FROM: env.EMAIL_FROM,
    SENTRY_DSN: env.SENTRY_DSN,
  };
}
