import { describe, expect, it } from 'vitest';
import { assertWebEnv, resolveWebDbUrl } from '../env';

/**
 * Boot-guard / fail-closed env logic (Epic 0.1 / 0.2). Pure — no DB.
 * (assertAppRoleNoBypass / assertRlsEnabled are DB-backed and exercised by the
 * RLS attack suite + at runtime in instrumentation.ts.)
 */

const OWNER = 'postgres://owner@localhost:5432/db';
const APP = 'postgres://restomatch_app@localhost:5432/db';

describe('resolveWebDbUrl — fail-closed tenant connection', () => {
  it('prefers DATABASE_URL_APP when set', () => {
    expect(resolveWebDbUrl({ DATABASE_URL_APP: APP, DATABASE_URL: OWNER } as never)).toBe(APP);
  });

  it('THROWS rather than silently falling back to the owner DB', () => {
    expect(() =>
      resolveWebDbUrl({ DATABASE_URL: OWNER, NODE_ENV: 'production' } as never),
    ).toThrow(/DATABASE_URL_APP is required/);
  });

  it('allows the owner fallback only under ALLOW_OWNER_DB=1', () => {
    expect(resolveWebDbUrl({ DATABASE_URL: OWNER, ALLOW_OWNER_DB: '1' } as never)).toBe(OWNER);
  });

  it('allows the owner fallback under NODE_ENV=test', () => {
    expect(resolveWebDbUrl({ DATABASE_URL: OWNER, NODE_ENV: 'test' } as never)).toBe(OWNER);
  });
});

describe('assertWebEnv — production hardening', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: OWNER,
    DATABASE_URL_APP: APP,
    RESEND_API_KEY: 'k',
    EMAIL_FROM: 'no-reply@example.com',
    AUTH_URL: 'https://app.example.com',
    REDIS_URL: 'redis://localhost:6379',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    // Required in production by Epic B/C (B.6) — AES-256-GCM key for the TOTP secret.
    AUTH_ENC_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };

  it('passes with all required production secrets', () => {
    expect(() => assertWebEnv(prod as never)).not.toThrow();
  });

  it('fails when DATABASE_URL_APP is missing in production', () => {
    const { DATABASE_URL_APP: _omit, ...rest } = prod;
    expect(() => assertWebEnv(rest as never)).toThrow(/DATABASE_URL_APP/);
  });

  it('rejects the ALLOW_OWNER_DB escape hatch in production', () => {
    expect(() => assertWebEnv({ ...prod, ALLOW_OWNER_DB: '1' } as never)).toThrow(
      /ALLOW_OWNER_DB is set in production/,
    );
  });

  it('does not require the app role outside production', () => {
    expect(() =>
      assertWebEnv({ NODE_ENV: 'development', DATABASE_URL: OWNER } as never),
    ).not.toThrow();
  });
});
