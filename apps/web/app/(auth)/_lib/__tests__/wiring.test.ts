import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * W3-07b source pins (conductor review round 3): the auth.ts boot guard runs
 * BEFORE NextAuth() is built, the Passkey provider gets our getUserInfo, and
 * the login-code e-mail is sent in the page language (receiver locales too).
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('auth.ts wiring', () => {
  const src = read('../../../../auth.ts');
  it('calls assertPasskeysConfig() at module load, before NextAuth({…})', () => {
    const guard = src.indexOf('\nassertPasskeysConfig();');
    const nextAuth = src.indexOf('= NextAuth({');
    expect(guard).toBeGreaterThan(-1);
    expect(nextAuth).toBeGreaterThan(guard);
  });
  it('passes the enumeration-safe getUserInfo to Passkey()', () => {
    expect(src).toMatch(/Passkey\(\{[^}]*getUserInfo: passkeyGetUserInfo/);
  });
  it('a locked code sign-in throws the limiter error (one answer for any address)', () => {
    expect(src).toMatch(/res\.reason === 'locked'\) throw new LoginRateLimited\(\)/);
  });
});

describe('login code e-mail language', () => {
  it('uses getAppLocale (ar/ru/th/ti), not the he/en-folded getLocale', () => {
    const src = read('../../../login/_lib/sendLoginCode.ts');
    expect(src).toContain('await getAppLocale()');
    expect(src).not.toMatch(/await getLocale\(\)/);
  });
});
