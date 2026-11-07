import { describe, expect, it } from 'vitest';
import {
  CLAIM_LINK_TTL_MS,
  CLAIM_TOKEN_LENGTH,
  claimPortalSecret,
  hashClaimToken,
  signClaimToken,
  verifyClaimToken,
} from '../claimPortal/token';
import { claimLinkUrl } from '../claimPortal/service';

const ENV = { CLAIM_PORTAL_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv;
const R = '11111111-2222-4333-8444-555555555555';
const S = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW = new Date('2026-10-25T09:40:00.000Z');

function mint(now = NOW, env = ENV) {
  return signClaimToken({ restaurantId: R, supplierId: S, now }, env);
}

describe('claim portal token (H-06ʰ)', () => {
  it('round-trips restaurant, supplier and a fixed 72 h lifetime', () => {
    const { token, issuedAt, expiresAt } = mint();
    expect(token).toHaveLength(CLAIM_TOKEN_LENGTH);
    expect(expiresAt.getTime() - issuedAt.getTime()).toBe(CLAIM_LINK_TTL_MS);
    const v = verifyClaimToken(token, NOW, ENV);
    expect(v).toEqual({ ok: true, claims: { restaurantId: R, supplierId: S, issuedAt, expiresAt } });
  });

  it('rounds issuedAt UP to the second, so a line sent earlier in that second is inside the letter', () => {
    const { issuedAt } = mint(new Date('2026-10-25T09:40:00.250Z'));
    expect(issuedAt.toISOString()).toBe('2026-10-25T09:40:01.000Z');
  });

  it('is EXPIRED exactly at 72 h and valid one second before', () => {
    const { token, expiresAt } = mint();
    expect(verifyClaimToken(token, new Date(expiresAt.getTime() - 1000), ENV).ok).toBe(true);
    expect(verifyClaimToken(token, expiresAt, ENV)).toEqual({ ok: false, error: 'EXPIRED' });
  });

  it('refuses a link "issued" in the future (beyond 5 min skew) as NOT_FOUND', () => {
    const { token } = mint(new Date(NOW.getTime() + 10 * 60 * 1000));
    expect(verifyClaimToken(token, NOW, ENV)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('every single-character tamper of payload or signature is NOT_FOUND', () => {
    const { token } = mint();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 3; i < token.length; i++) {
      if (token[i] === '.') continue;
      const c = token[i]!;
      const swap = alphabet[(alphabet.indexOf(c) + 1) % alphabet.length]!;
      const forged = token.slice(0, i) + swap + token.slice(i + 1);
      expect(verifyClaimToken(forged, NOW, ENV).ok, `position ${i}`).toBe(false);
    }
  });

  it('swapping restaurant or supplier inside a validly-shaped payload fails the signature', () => {
    const a = mint();
    const b = signClaimToken({ restaurantId: S, supplierId: R, now: NOW }, ENV);
    const [, , sigA] = a.token.split('.');
    const [, payloadB] = b.token.split('.');
    expect(verifyClaimToken(`c1.${payloadB}.${sigA}`, NOW, ENV)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('a token minted with another secret is NOT_FOUND', () => {
    const { token } = mint(NOW, { CLAIM_PORTAL_SECRET: 'y'.repeat(40) } as NodeJS.ProcessEnv);
    expect(verifyClaimToken(token, NOW, ENV)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('the portal is OFF without a secret of ≥ 32 chars: no verify, no mint', () => {
    const { token } = mint();
    for (const env of [{}, { CLAIM_PORTAL_SECRET: '' }, { CLAIM_PORTAL_SECRET: 'z'.repeat(31) }] as NodeJS.ProcessEnv[]) {
      expect(claimPortalSecret(env)).toBeNull();
      expect(verifyClaimToken(token, NOW, env)).toEqual({ ok: false, error: 'NOT_FOUND' });
      expect(() => mint(NOW, env)).toThrow(/off/);
    }
  });

  it('malformed shapes are NOT_FOUND without throwing', () => {
    const { token } = mint();
    const bad: unknown[] = [
      '',
      'c1',
      token.slice(0, -1),
      `${token}A`,
      token.replace('c1.', 'c2.'),
      token.replace(/\./g, '_'),
      `${token.slice(0, 50)}=${token.slice(51)}`,
      'c1.' + 'A'.repeat(48) + '.' + 'A'.repeat(43),
      'x'.repeat(10_000),
      undefined,
      null,
      42,
    ];
    for (const t of bad) expect(verifyClaimToken(t as string, NOW, ENV).ok).toBe(false);
  });

  it('refuses a non-uuid id at mint time', () => {
    expect(() => signClaimToken({ restaurantId: 'nope', supplierId: S, now: NOW }, ENV)).toThrow();
  });

  it('hashes tokens for limiter keys (hex, never the raw token) and builds the /s/c URL', () => {
    const { token } = mint();
    const h = hashClaimToken(token);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(token);
    expect(claimLinkUrl('https://app.example///', token)).toBe(`https://app.example/s/c/${token}`);
  });
});
