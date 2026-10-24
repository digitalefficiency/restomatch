import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertWorkerEnv } from '../env';

const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db:5432/x',
  ANTHROPIC_API_KEY: 'k',
  RESEND_API_KEY: 'r',
  EMAIL_FROM: 'a@b.c',
};

describe('assertWorkerEnv — Postgres-only (0061, no Redis)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('boots in production without any REDIS_URL', () => {
    expect(assertWorkerEnv(PROD).DATABASE_URL).toBe(PROD.DATABASE_URL);
  });

  it('still refuses to boot without DATABASE_URL (the job queue lives there)', () => {
    expect(() => assertWorkerEnv({ ...PROD, DATABASE_URL: '' })).toThrow(/DATABASE_URL is required/);
  });

  it('still requires the OCR + email secrets in production', () => {
    const { ANTHROPIC_API_KEY: _a, RESEND_API_KEY: _r, ...rest } = PROD;
    expect(() => assertWorkerEnv(rest)).toThrow(/ANTHROPIC_API_KEY[\s\S]*RESEND_API_KEY/);
  });

  it('warns once about a leftover REDIS_URL instead of using it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertWorkerEnv({ ...PROD, REDIS_URL: 'rediss://x:6379' })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/REDIS_URL is set but no longer used/));
  });
});
