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

  it('warns (does not throw) on a Supabase URL that is not https://<ref>.supabase.co', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['http://abcdefghijklmnopqrst.supabase.co', 'https://old-project.example.com', 'https://abcdefghijklmnopqrst.supabase.co/storage']) {
      warn.mockClear();
      expect(() => assertWebEnv({ ...prod, NEXT_PUBLIC_SUPABASE_URL: bad } as never)).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('supabase.co'));
    }
    warn.mockClear();
    assertWebEnv({ ...prod, NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` } as never);
    expect(warn).not.toHaveBeenCalled();
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

  it('treats empty-string values as unset, never a parse error (dev must still boot)', () => {
    const blanks = { AUTH_SECRET: '', NEXTAUTH_SECRET: '', SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_URL: '' };
    expect(() => assertWebEnv({ NODE_ENV: 'development', DATABASE_URL: OWNER, ...blanks } as never)).not.toThrow();
    expect(webEnvWarnings({ NODE_ENV: 'production', ...blanks } as never)).toEqual([]);
  });
});

describe('assertWebEnv — empty secrets + legacy URL name', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: OWNER,
    DATABASE_URL_APP: APP,
    RESEND_API_KEY: 'k',
    EMAIL_FROM: 'no-reply@example.com',
    AUTH_URL: 'https://app.example.com',
    AUTH_SECRET: 'test-secret',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    AUTH_ENC_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };

  it('an empty AUTH_SECRET counts as missing in production', () => {
    expect(() => assertWebEnv({ ...prod, AUTH_SECRET: '' } as never)).toThrow(/AUTH_SECRET/);
  });

  it('accepts the legacy NEXTAUTH_URL in place of AUTH_URL/APP_URL', () => {
    const { AUTH_URL: _omit, ...rest } = prod;
    expect(() => assertWebEnv(rest as never)).toThrow(/AUTH_URL or APP_URL/);
    expect(() => assertWebEnv({ ...rest, NEXTAUTH_URL: 'https://app.example.com' } as never)).not.toThrow();
  });
});

describe('build-phase DB placeholder (Vercel Preview builds without database env)', () => {
  it('resolveWebDbUrl returns the placeholder ONLY during next build', async () => {
    const { resolveWebDbUrl, BUILD_PHASE_DB_PLACEHOLDER } = await import('../env');
    expect(resolveWebDbUrl({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' })).toBe(
      BUILD_PHASE_DB_PLACEHOLDER,
    );
    // Runtime (no NEXT_PHASE, or any other phase): still fail-closed.
    expect(() => resolveWebDbUrl({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL_APP is required/);
    expect(() => resolveWebDbUrl({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-server' })).toThrow(
      /DATABASE_URL_APP is required/,
    );
  });

  it('a real URL always wins over the placeholder', async () => {
    const { resolveWebDbUrl } = await import('../env');
    expect(
      resolveWebDbUrl({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build', DATABASE_URL_APP: 'postgres://a/b' }),
    ).toBe('postgres://a/b');
  });

  it('the production boot guard ignores the build phase: missing env still refuses to boot', async () => {
    const { assertWebEnv } = await import('../env');
    expect(() => assertWebEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' })).toThrow(
      /invalid web environment[\s\S]*DATABASE_URL/,
    );
    // …and with DATABASE_URL present, the production secrets are still mandatory.
    expect(() =>
      assertWebEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build', DATABASE_URL: 'postgres://a/b' }),
    ).toThrow(/missing required production secrets[\s\S]*DATABASE_URL_APP/);
  });
});

describe('Redis is gone (0061)', () => {
  it('production boots without REDIS_URL; a leftover one only warns', async () => {
    const { webEnvWarnings } = await import('../env');
    expect(webEnvWarnings({ NODE_ENV: 'production', REDIS_URL: 'rediss://x:6379' } as never)).toEqual(
      expect.arrayContaining([expect.stringMatching(/REDIS_URL is set but no longer used/)]),
    );
    expect(webEnvWarnings({ NODE_ENV: 'production' } as never).some((w) => /REDIS/.test(w))).toBe(false);
  });
});

describe('DATABASE_URL_APP malformed in production → derived from DATABASE_URL + APP_ROLE_PASSWORD', () => {
  const REF = 'rutbnmvkwirqtixvuhdq';
  const POOLER = `postgresql://postgres.${REF}:owner-secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`;
  const APP_PW = 'a'.repeat(64);
  const prodEnv = (over: Record<string, string | undefined>) =>
    ({ NODE_ENV: 'production', DATABASE_URL: POOLER, APP_ROLE_PASSWORD: APP_PW, ...over }) as never;

  it('derives restomatch_app.<ref> on the owner host, never the owner password', async () => {
    const { resolveWebDbUrl } = await import('../env');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of [
      `DATABASE_URL_APP=postgresql://restomatch_app.${REF}:x@h:6543/postgres`,
      'just-a-password',
      `postgresql://restomatch_app.${REF}:<${APP_PW}>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres x`,
      undefined,
    ]) {
      const url = new URL(resolveWebDbUrl(prodEnv({ DATABASE_URL_APP: bad })));
      expect(url.username).toBe(`restomatch_app.${REF}`);
      expect(decodeURIComponent(url.password)).toBe(APP_PW);
      expect(url.host).toBe('aws-0-ap-northeast-1.pooler.supabase.com:6543');
      expect(url.pathname).toBe('/postgres');
      expect(url.toString()).not.toContain('owner-secret');
    }
    // The warning says why, without the value.
    for (const [msg] of warn.mock.calls) expect(String(msg)).not.toContain('just-a-password');
    warn.mockRestore();
  });

  it('keeps a valid DATABASE_URL_APP as is', async () => {
    const { resolveWebDbUrl } = await import('../env');
    const good = `postgresql://restomatch_app.${REF}:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`;
    expect(resolveWebDbUrl(prodEnv({ DATABASE_URL_APP: good }))).toBe(good);
  });

  it('URL-encodes a password with special characters so postgres.js round-trips it', async () => {
    const { deriveAppRoleUrl } = await import('../env');
    const pw = 'p@ss:w/rd?#%x';
    const u = new URL(deriveAppRoleUrl(prodEnv({ APP_ROLE_PASSWORD: pw }))!);
    expect(decodeURIComponent(u.password)).toBe(pw);
  });

  it('uses plain restomatch_app on a direct (non-Supavisor) owner URL', async () => {
    const { deriveAppRoleUrl } = await import('../env');
    const u = new URL(deriveAppRoleUrl(prodEnv({ DATABASE_URL: 'postgres://postgres:pw@db.example.com:5432/postgres' }))!);
    expect(u.username).toBe('restomatch_app');
  });

  it('without APP_ROLE_PASSWORD a malformed value fails loudly — naming the problem, not the value', async () => {
    const { resolveWebDbUrl } = await import('../env');
    // Beyond repair (a NAME= prefix on a URL alone is repaired — see below).
    const bad = 'DATABASE_URL_APP=secretpw';
    expect(() => resolveWebDbUrl(prodEnv({ APP_ROLE_PASSWORD: undefined, DATABASE_URL_APP: bad }))).toThrow(/starts with "NAME="/);
    try {
      resolveWebDbUrl(prodEnv({ APP_ROLE_PASSWORD: undefined, DATABASE_URL_APP: bad }));
    } catch (e) {
      expect(String(e)).not.toContain('secretpw');
    }
    // …but never breaks `next build` (the boot guard refuses at runtime instead).
    const { BUILD_PHASE_DB_PLACEHOLDER } = await import('../env');
    expect(
      resolveWebDbUrl(prodEnv({ APP_ROLE_PASSWORD: undefined, DATABASE_URL_APP: bad, NEXT_PHASE: 'phase-production-build' })),
    ).toBe(BUILD_PHASE_DB_PLACEHOLDER);
  });

  it('assertWebEnv accepts a derivable app role and names the problem otherwise', async () => {
    const { assertWebEnv } = await import('../env');
    const base = {
      RESEND_API_KEY: 'k',
      EMAIL_FROM: 'no-reply@example.com',
      AUTH_URL: 'https://app.example.com',
      AUTH_SECRET: 's'.repeat(32),
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      AUTH_ENC_KEY: 'a'.repeat(64),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertWebEnv(prodEnv({ ...base, DATABASE_URL_APP: 'just-a-password' }))).not.toThrow(/DATABASE_URL_APP/);
    expect(() => assertWebEnv(prodEnv({ ...base, DATABASE_URL_APP: 'just-a-password', APP_ROLE_PASSWORD: undefined }))).toThrow(
      /DATABASE_URL_APP — it does not start with postgresql:\/\//,
    );
    warn.mockRestore();
  });

  it('outside production the old behaviour is unchanged', async () => {
    const { resolveWebDbUrl } = await import('../env');
    expect(resolveWebDbUrl({ NODE_ENV: 'test', DATABASE_URL: POOLER, APP_ROLE_PASSWORD: APP_PW } as never)).toBe(POOLER);
  });
});

describe('pasted DB URLs are repaired, or named — never echoed', () => {
  const REF = 'rutbnmvkwirqtixvuhdq';
  const HOST = 'aws-0-ap-northeast-1.pooler.supabase.com:6543';
  const PW = 'Sec#ret/pa?ss@w0rd';
  const urlWith = (pw: string, user = `postgres.${REF}`) => `postgresql://${user}:${pw}@${HOST}/postgres`;

  it('repairs the common paste mistakes into a URL postgres.js parses, with the same password', async () => {
    const { normalizePgUrl } = await import('../env');
    for (const raw of [
      urlWith(PW), // # / ? @ never URL-encoded → "Invalid URL" before
      `DATABASE_URL=${urlWith(PW)}`,
      `"${urlWith(PW)}"`,
      `  ${urlWith(PW)}\n`,
      urlWith(`[${PW}]`), // Supabase's [YOUR-PASSWORD] brackets left in
      urlWith(`<${PW}>`),
      urlWith(encodeURIComponent(PW)), // already encoded: unchanged password
    ]) {
      const fixed = normalizePgUrl(raw);
      expect(fixed, raw).not.toBeNull();
      const u = new URL(fixed!);
      expect(decodeURIComponent(u.password)).toBe(PW);
      expect(decodeURIComponent(u.username)).toBe(`postgres.${REF}`);
      expect(u.host).toBe(HOST);
      expect(u.pathname).toBe('/postgres');
    }
  });

  it('returns a clean URL unchanged, and null for one beyond repair', async () => {
    const { normalizePgUrl } = await import('../env');
    const clean = urlWith(encodeURIComponent(PW));
    expect(normalizePgUrl(clean)).toBe(clean);
    expect(normalizePgUrl(` ${clean} `)).toBe(clean);
    for (const bad of [undefined, '', 'just-a-password', 'https://example.com', 'postgresql://']) {
      expect(normalizePgUrl(bad)).toBeNull();
    }
  });

  it('the auth connection uses the repaired DATABASE_URL; beyond repair it fails at runtime, never the build', async () => {
    const { resolveAuthDbUrl, BUILD_PHASE_DB_PLACEHOLDER } = await import('../env');
    const prod = { NODE_ENV: 'production' };
    expect(decodeURIComponent(new URL(resolveAuthDbUrl({ ...prod, DATABASE_URL: urlWith(PW) } as never)!).password)).toBe(PW);
    expect(resolveAuthDbUrl({ ...prod, DATABASE_URL: 'just-a-password', NEXT_PHASE: 'phase-production-build' } as never)).toBe(
      BUILD_PHASE_DB_PLACEHOLDER,
    );
    expect(() => resolveAuthDbUrl({ ...prod, DATABASE_URL: 'just-a-password' } as never)).toThrow(
      /DATABASE_URL is unusable: it does not start with postgresql:\/\//,
    );
    try {
      resolveAuthDbUrl({ ...prod, DATABASE_URL: 'just-a-password' } as never);
    } catch (e) {
      expect(String(e)).not.toContain('just-a-password');
    }
    // DATABASE_URL_APP only when DATABASE_URL is unset (legacy dev setups).
    expect(resolveAuthDbUrl({ DATABASE_URL_APP: APP } as never)).toBe(APP);
    expect(resolveAuthDbUrl({} as never)).toBeUndefined();
  });

  it('derives the app role from a repaired owner URL', async () => {
    const { resolveWebDbUrl } = await import('../env');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const u = new URL(
      resolveWebDbUrl({ NODE_ENV: 'production', DATABASE_URL: urlWith(PW), APP_ROLE_PASSWORD: 'app-pw', DATABASE_URL_APP: 'x' } as never),
    );
    expect(u.username).toBe(`restomatch_app.${REF}`);
    expect(decodeURIComponent(u.password)).toBe('app-pw');
    warn.mockRestore();
  });

  it('without APP_ROLE_PASSWORD a repairable DATABASE_URL_APP is repaired; a bracketed one is never used as is', async () => {
    const { resolveWebDbUrl } = await import('../env');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const appPw = 'ap#p/w';
    for (const raw of [urlWith(appPw, `restomatch_app.${REF}`), urlWith(`[${appPw}]`, `restomatch_app.${REF}`)]) {
      const u = new URL(resolveWebDbUrl({ NODE_ENV: 'production', DATABASE_URL_APP: raw } as never));
      expect(decodeURIComponent(u.password)).toBe(appPw);
    }
    for (const [msg] of warn.mock.calls) expect(String(msg)).not.toContain(appPw);
    warn.mockRestore();
  });

  it('the build/boot report names each variable\'s state and reason, never a value', async () => {
    const { dbEnvReport } = await import('../env');
    const r = dbEnvReport({
      DATABASE_URL: urlWith(PW),
      DATABASE_URL_APP: 'DATABASE_URL_APP=junk-secret',
      APP_ROLE_PASSWORD: 'app-secret',
    } as never);
    expect(r).toMatch(/DATABASE_URL: repaired \(.*URL-encoded\)/);
    expect(r).toMatch(/DATABASE_URL_APP: UNUSABLE \(.*NAME=/);
    expect(r).toContain('APP_ROLE_PASSWORD: set');
    expect(r).toContain('app role derivable: yes');
    for (const secret of [PW, 'Sec', 'junk-secret', 'app-secret']) expect(r).not.toContain(secret);
    expect(dbEnvReport({ DATABASE_URL: urlWith(encodeURIComponent(PW)) } as never)).toMatch(/^DATABASE_URL: ok · DATABASE_URL_APP: unset/);
  });

  it('assertWebEnv names an unusable DATABASE_URL in production', async () => {
    const { assertWebEnv } = await import('../env');
    const env = {
      NODE_ENV: 'production',
      DATABASE_URL: 'just-a-password',
      DATABASE_URL_APP: urlWith('pw', `restomatch_app.${REF}`),
      RESEND_API_KEY: 'k',
      EMAIL_FROM: 'no-reply@example.com',
      AUTH_URL: 'https://app.example.com',
      AUTH_SECRET: 's'.repeat(32),
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      AUTH_ENC_KEY: 'a'.repeat(64),
    };
    expect(() => assertWebEnv(env as never)).toThrow(/DATABASE_URL — it does not start with postgresql:\/\//);
  });
});

describe('owner connection falls back to the Supabase integration when DATABASE_URL is beyond repair', () => {
  const REF = 'rutbnmvkwirqtixvuhdq';
  const POOLER = `aws-0-ap-northeast-1.pooler.supabase.com`;
  const INTEGRATION = `postgres://postgres.${REF}:intPw@${POOLER}:6543/postgres?sslmode=require&supa=base-pooler.x&pgbouncer=true`;

  it('repairs a URL pasted without its scheme', async () => {
    const { normalizePgUrl } = await import('../env');
    const u = new URL(normalizePgUrl(`postgres.${REF}:p#w@${POOLER}:6543/postgres`)!);
    expect(u.protocol).toBe('postgresql:');
    expect(decodeURIComponent(u.password)).toBe('p#w');
    expect(u.host).toBe(`${POOLER}:6543`);
  });

  it('uses POSTGRES_URL (only sslmode kept) when DATABASE_URL is unusable; DATABASE_URL wins when usable', async () => {
    const { ownerDbUrl, ownerDbUrlSource } = await import('../env');
    const env = { DATABASE_URL: 'just-a-password', POSTGRES_URL: INTEGRATION } as never;
    expect(ownerDbUrlSource(env)).toBe('POSTGRES_URL');
    const u = new URL(ownerDbUrl(env)!);
    expect(decodeURIComponent(u.username)).toBe(`postgres.${REF}`);
    expect(u.host).toBe(`${POOLER}:6543`);
    expect([...u.searchParams.keys()]).toEqual(['sslmode']);
    expect(u.searchParams.get('sslmode')).toBe('require');

    const good = `postgresql://postgres.${REF}:ownPw@${POOLER}:6543/postgres`;
    expect(ownerDbUrl({ DATABASE_URL: good, POSTGRES_URL: INTEGRATION } as never)).toBe(good);
    // The non-pooling URL is the last resort.
    expect(ownerDbUrlSource({ POSTGRES_URL_NON_POOLING: INTEGRATION.replace(':6543', ':5432') } as never)).toBe(
      'POSTGRES_URL_NON_POOLING',
    );
    expect(ownerDbUrl({ DATABASE_URL: 'just-a-password' } as never)).toBeNull();
  });

  it('auth connection, derived app role, boot guard and report all follow the fallback', async () => {
    const { resolveAuthDbUrl, resolveWebDbUrl, assertWebEnv, dbEnvReport } = await import('../env');
    const env = {
      NODE_ENV: 'production',
      DATABASE_URL: 'just-a-password',
      DATABASE_URL_APP: 'also-broken',
      POSTGRES_URL: INTEGRATION,
      APP_ROLE_PASSWORD: 'app-pw',
      RESEND_API_KEY: 'k',
      EMAIL_FROM: 'no-reply@example.com',
      AUTH_URL: 'https://app.example.com',
      AUTH_SECRET: 's'.repeat(32),
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      AUTH_ENC_KEY: 'a'.repeat(64),
    } as never;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeURIComponent(new URL(resolveAuthDbUrl(env)!).username)).toBe(`postgres.${REF}`);
    const app = new URL(resolveWebDbUrl(env));
    expect(decodeURIComponent(app.username)).toBe(`restomatch_app.${REF}`);
    expect(decodeURIComponent(app.password)).toBe('app-pw');
    expect(app.host).toBe(`${POOLER}:6543`);
    expect(app.toString()).not.toContain('intPw');
    expect(() => assertWebEnv(env)).not.toThrow();
    const r = dbEnvReport(env);
    expect(r).toContain('owner connection from: POSTGRES_URL');
    expect(r).toContain('app role derivable: yes');
    for (const secret of ['intPw', 'just-a-password', 'also-broken', 'app-pw']) expect(r).not.toContain(secret);
    warn.mockRestore();
  });
});

describe('normalizePgUrl — read the way postgres.js reads it (review of #127)', () => {
  const REF = 'rutbnmvkwirqtixvuhdq';
  const HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';
  const raw = (pw: string) => `postgresql://postgres.${REF}:${pw}@${HOST}:6543/postgres`;

  // postgres.js's own parse (no connection is opened).
  const pgOptions = async (url: string) => {
    const { default: postgres } = await import('postgres');
    const sql = postgres(url, { max: 1 });
    const o = sql.options as unknown as { host: string[]; port: number[]; user: string; pass: string; database: string };
    await sql.end({ timeout: 0 });
    return o;
  };

  it.each([
    'P@ssw0rd#1', // `new URL` accepts it, postgres.js read host "ssw0rd"
    'Rest@urant/2024',
    'a@b?c',
    '#Abc123',
    '/Abc123',
    '2024#Summer',
    '1234/abcd',
    'a@b,c', // postgres.js multi-host split at the first '@'
    'Fo0d%cost!', // a raw % made postgres() throw URIError at import
    '50%off',
    'pa ss word', // an inner space is part of the password, not paste noise
    '[P@ss#1]', // template brackets around a password that holds '@'
  ])('%s → postgres.js reads the same user, password, host, port and database', async (pw) => {
    const { normalizePgUrl } = await import('../env');
    const fixed = normalizePgUrl(raw(pw));
    expect(fixed, pw).not.toBeNull();
    const o = await pgOptions(fixed!);
    expect(o.host).toEqual([HOST]);
    expect(o.port).toEqual([6543]);
    expect(o.user).toBe(`postgres.${REF}`);
    expect(o.pass).toBe(pw.replace(/^\[(.*)\]$/, '$1'));
    expect(o.database).toBe('postgres');
  });

  it('a clean, already-encoded URL is returned unchanged and reported ok', async () => {
    const { normalizePgUrl, dbEnvReport } = await import('../env');
    const clean = raw(encodeURIComponent('P@ss w#rd%1'));
    expect(normalizePgUrl(clean)).toBe(clean);
    expect(dbEnvReport({ DATABASE_URL: clean } as never)).toMatch(/^DATABASE_URL: ok/);
    expect(dbEnvReport({ DATABASE_URL: raw('P@ssw0rd#1') } as never)).toMatch(/^DATABASE_URL: repaired/);
    expect(dbEnvReport({ DATABASE_URL: raw('50%off') } as never)).toContain('%25');
  });

  it('line breaks from a wrapped paste are dropped; a fragment never survives', async () => {
    const { normalizePgUrl } = await import('../env');
    const wrapped = `postgresql://postgres.${REF}:abc\n123@${HOST}:6543/\r\npostgres`;
    expect(normalizePgUrl(wrapped)).toBe(raw('abc123'));
    expect(new URL(normalizePgUrl(raw('x#y'))!).hash).toBe('');
  });

  it('applyRepairedDbEnv hands the queue (DATABASE_URL) the repaired value; a clean one is left alone', async () => {
    const { applyRepairedDbEnv } = await import('../env');
    const env: Record<string, string> = { DATABASE_URL: raw('P@ssw0rd#1') };
    expect(applyRepairedDbEnv(env as never)).toBe(true);
    expect((await pgOptions(env.DATABASE_URL!)).pass).toBe('P@ssw0rd#1');
    expect(applyRepairedDbEnv(env as never)).toBe(false);
    const fallback: Record<string, string> = { DATABASE_URL: 'just-a-password', POSTGRES_URL: raw('intPw') };
    expect(applyRepairedDbEnv(fallback as never)).toBe(true);
    expect(fallback.DATABASE_URL).toBe(raw('intPw'));
  });

  it('warnings never carry the password or a URL, encoded or not', async () => {
    const { resolveWebDbUrl } = await import('../env');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const appPw = 'ap#p/w@1';
    resolveWebDbUrl({ NODE_ENV: 'production', DATABASE_URL_APP: `DATABASE_URL_APP=postgresql://restomatch_app.${REF}:${appPw}@${HOST}:6543/postgres` } as never);
    expect(warn).toHaveBeenCalled();
    for (const [msg] of warn.mock.calls) {
      expect(String(msg)).not.toContain(appPw);
      expect(String(msg)).not.toContain(encodeURIComponent(appPw));
      expect(String(msg)).not.toMatch(/postgres(ql)?:\/\//);
    }
    warn.mockRestore();
  });
});
