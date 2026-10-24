/**
 * Fail-fast environment validation for the worker.
 *
 * The worker silently no-ops without its secrets (no DATABASE_URL → no job
 * queue at all; no ANTHROPIC_API_KEY → OCR/PO parsing throws per-job; no
 * RESEND_API_KEY → outbox email parks failed). Call assertWorkerEnv() once at
 * startup to turn a misconfigured production deploy into a LOUD boot failure
 * instead of a process that looks healthy but does nothing.
 *
 * Plain checks (no zod) — the worker package has no zod dependency.
 */
export interface WorkerEnv {
  DATABASE_URL: string;
  ANTHROPIC_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SENTRY_DSN?: string;
}

export function assertWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  if (!env.DATABASE_URL || env.DATABASE_URL.trim() === '') {
    throw new Error('[env] DATABASE_URL is required for the worker');
  }
  // Redis is gone (0061: the job queue is in Postgres). A leftover REDIS_URL is
  // harmless but misleading — say so once.
  if (env.REDIS_URL) console.warn('[env] REDIS_URL is set but no longer used (the job queue is in Postgres) — remove it');
  if (env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY — invoice OCR / PO parsing');
    if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY — outbox email dispatch');
    if (!env.EMAIL_FROM) missing.push('EMAIL_FROM — sender domain');
    if (missing.length > 0) {
      throw new Error(`[env] missing required worker production env:\n - ${missing.join('\n - ')}`);
    }
  }
  return {
    DATABASE_URL: env.DATABASE_URL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    RESEND_API_KEY: env.RESEND_API_KEY,
    EMAIL_FROM: env.EMAIL_FROM,
    SENTRY_DSN: env.SENTRY_DSN,
  };
}
