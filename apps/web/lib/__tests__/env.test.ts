import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { assertWebEnv, resolveWebDbUrl, supabaseRefFromDbUrl, supabaseRefFromUrl, webEnvWarnings } from '../env';

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
    AUTH_SECRET: 'test-secret',
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

/* F4/F5/F6 (client-ready QA round): boot guard gaps. */
describe('assertWebEnv — AUTH_SECRET + Supabase URL shape (F4/F5)', () => {
  const REF = 'abcdefghijklmnopqrst';
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: OWNER,
    DATABASE_URL_APP: APP,
    RESEND_API_KEY: 'k',
    EMAIL_FROM: 'no-reply@example.com',
    AUTH_URL: 'https://app.example.com',
    AUTH_SECRET: 'test-secret',
    REDIS_URL: 'redis://localhost:6379',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    AUTH_ENC_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };
  afterEach(() => vi.restoreAllMocks());

  it('fails without AUTH_SECRET in production (login would 500 after boot)', () => {
    const { AUTH_SECRET: _omit, ...rest } = prod;
    expect(() => assertWebEnv(rest as never)).toThrow(/AUTH_SECRET/);
  });

  it('accepts the legacy NEXTAUTH_SECRET name', () => {
    const { AUTH_SECRET: _omit, ...rest } = prod;
    expect(() => assertWebEnv({ ...rest, NEXTAUTH_SECRET: 's' } as never)).not.toThrow();
  });

  it('rejects a Supabase URL that is not https://<ref>.supabase.co', () => {
    for (const bad of ['http://abcdefghijklmnopqrst.supabase.co', 'https://old-project.example.com', 'https://abcdefghijklmnopqrst.supabase.co/storage']) {
      expect(() => assertWebEnv({ ...prod, NEXT_PUBLIC_SUPABASE_URL: bad } as never)).toThrow(/supabase\.co/);
    }
    expect(() =>
      assertWebEnv({ ...prod, NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` } as never),
    ).not.toThrow();
  });

  it('does not enforce the Supabase shape outside production (local http stack)', () => {
    expect(() =>
      assertWebEnv({ NODE_ENV: 'development', DATABASE_URL: OWNER, SUPABASE_URL: 'http://127.0.0.1:54321' } as never),
    ).not.toThrow();
  });

  it('logs boot warnings (and still boots)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertWebEnv({ ...prod, APP_URL: 'https://other.example.com' } as never)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('APP_URL origin'));
  });
});

describe('webEnvWarnings (F5/F6)', () => {
  const A = 'aaaaaaaaaaaaaaaaaaaa';
  const B = 'bbbbbbbbbbbbbbbbbbbb';
  const pooled = (ref: string, role = 'postgres') =>
    `postgres://${role}.${ref}:S3cretPassw0rd@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;

  it('extracts refs from API, pooler and direct DB URLs', () => {
    expect(supabaseRefFromUrl(`https://${A}.supabase.co`)).toBe(A);
    expect(supabaseRefFromDbUrl(pooled(A, 'restomatch_app'))).toBe(A);
    expect(supabaseRefFromDbUrl(`postgres://postgres:pw@db.${B}.supabase.co:5432/postgres`)).toBe(B);
    expect(supabaseRefFromDbUrl('postgres://postgres:pw@localhost:5432/db')).toBeNull();
  });

  it('warns when the DB ref and the Supabase URL ref differ — naming refs, never secrets', () => {
    const w = webEnvWarnings({
      NEXT_PUBLIC_SUPABASE_URL: `https://${A}.supabase.co`,
      DATABASE_URL: pooled(B),
      DATABASE_URL_APP: pooled(B, 'restomatch_app'),
    } as never);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain(A);
    expect(w[0]).toContain(B);
    expect(w[0]).not.toContain('S3cretPassw0rd');
    expect(w[0]).not.toContain('pooler');
  });

  it('is quiet when everything points at one project and one origin', () => {
    expect(
      webEnvWarnings({
        NEXT_PUBLIC_SUPABASE_URL: `https://${A}.supabase.co`,
        DATABASE_URL: pooled(A),
        APP_URL: 'https://app.example.com/',
        AUTH_URL: 'https://app.example.com',
      } as never),
    ).toEqual([]);
  });

  it('warns when APP_URL and AUTH_URL origins differ (login loop on the other host)', () => {
    const w = webEnvWarnings({ APP_URL: 'https://demo.example.com', AUTH_URL: 'https://app.example.com' } as never);
    expect(w).toEqual([expect.stringContaining('open the app only on that host')]);
  });

  it('warns in production when neither AUTH_URL nor APP_URL is set (broken email links)', () => {
    expect(webEnvWarnings({ NODE_ENV: 'production' } as never)).toEqual([
      expect.stringContaining('neither AUTH_URL nor APP_URL'),
    ]);
    expect(webEnvWarnings({ NODE_ENV: 'production', APP_URL: 'https://app.example.com' } as never)).toEqual([]);
    expect(webEnvWarnings({ NODE_ENV: 'development' } as never)).toEqual([]);
  });
});
