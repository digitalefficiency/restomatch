import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertWorkerEnv } from '../env';

const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db:5432/x',
  ANTHROPIC_API_KEY: 'k',
  RESEND_API_KEY: 'r',
  EMAIL_FROM: 'a@b.c',
};

describe('assertWorkerEnv — REDIS_URL scheme (EN-7)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses to boot in production on an Upstash REST URL', () => {
    expect(() => assertWorkerEnv({ ...PROD, REDIS_URL: 'https://eu1-x.upstash.io' })).toThrow(
      /Upstash REST URL/,
    );
  });

  it('boots in production on a rediss:// URL', () => {
    expect(assertWorkerEnv({ ...PROD, REDIS_URL: 'rediss://default:pw@eu1-x.upstash.io:6379' }).REDIS_URL).toMatch(
      /^rediss:/,
    );
  });

  it('only warns outside production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      assertWorkerEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x', REDIS_URL: 'http://localhost:6379' }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/redis:\/\/ or rediss:\/\//));
  });
});
