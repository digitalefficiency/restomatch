import { afterAll, describe, expect, it } from 'vitest';
import { eq, users, verificationTokens } from '@restomatch/db';
import { cleanup, makeUser, ownerDb, uniqueEmail } from '../../../join/__tests__/helpers';
import { LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODE_TTL_MS, issueLoginCode, verifyLoginCode } from '../loginCode';

/** W3-07b slice b: the 6-digit sign-in code. Add-only attack suite (warden). */
afterAll(async () => {
  await cleanup();
});

async function codeFor(email: string, now?: number): Promise<string> {
  const r = await issueLoginCode(email, now);
  if (!r) throw new Error('no code issued');
  return r.code;
}

describe('login code', () => {
  it('happy path: issue → verify once → the code is spent, the address verified', async () => {
    const email = uniqueEmail('login');
    const uid = await makeUser(email);
    await ownerDb.update(users).set({ emailVerified: null }).where(eq(users.id, uid));
    const code = await codeFor(email.toUpperCase()); // case-insensitive address
    const [row] = await ownerDb.select().from(verificationTokens).where(eq(verificationTokens.identifier, `login:${uid}`));
    expect(row?.token).not.toContain(code);
    expect(await verifyLoginCode(email, code)).toEqual({ ok: true, userId: uid });
    expect(await verifyLoginCode(email, code)).toMatchObject({ ok: false, reason: 'noCode' });
    const [u] = await ownerDb.select().from(users).where(eq(users.id, uid));
    expect(u?.emailVerified).toBeTruthy();
  });

  it('an unknown address gets no code and cannot sign in', async () => {
    expect(await issueLoginCode(uniqueEmail('ghost'))).toBeNull();
    expect(await verifyLoginCode(uniqueEmail('ghost'), '123456')).toMatchObject({ ok: false });
  });

  it("A's code never signs in B", async () => {
    const a = uniqueEmail('a');
    const b = uniqueEmail('b');
    await makeUser(a);
    await makeUser(b);
    const codeA = await codeFor(a);
    let codeB = await codeFor(b);
    while (codeB === codeA) codeB = await codeFor(b);
    expect(await verifyLoginCode(b, codeA)).toMatchObject({ ok: false, reason: 'wrongCode' });
  });

  it('a new code replaces the old one; an expired code is refused', async () => {
    const email = uniqueEmail('replace');
    await makeUser(email);
    const first = await codeFor(email);
    let second = await codeFor(email);
    while (second === first) second = await codeFor(email);
    expect(await verifyLoginCode(email, first)).toMatchObject({ reason: 'wrongCode' });
    const later = Date.now() + LOGIN_CODE_TTL_MS + 1000;
    expect(await verifyLoginCode(email, second, later)).toMatchObject({ reason: 'noCode' });
  });

  it(`locks after ${LOGIN_CODE_MAX_ATTEMPTS} wrong codes and kills the live code (durable, no limiter)`, async () => {
    const email = uniqueEmail('brute');
    await makeUser(email);
    const code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i += 1) {
      expect(await verifyLoginCode(email, wrong)).toMatchObject({ reason: 'wrongCode' });
    }
    expect(await verifyLoginCode(email, code)).toMatchObject({ reason: 'locked' });
    expect(await verifyLoginCode(email, code)).toMatchObject({ ok: false });
  });

  it('concurrent guesses cannot overshoot the ceiling', async () => {
    const email = uniqueEmail('burst');
    await makeUser(email);
    const code = await codeFor(email);
    const guesses = Array.from({ length: 12 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const res = await Promise.all(guesses.map((g) => verifyLoginCode(email, g)));
    expect(res.filter((r) => !r.ok && r.reason === 'wrongCode').length).toBeLessThanOrEqual(LOGIN_CODE_MAX_ATTEMPTS);
    expect((await verifyLoginCode(email, code)).ok).toBe(false);
  });
});
