import { afterAll, describe, expect, it } from 'vitest';
import { authenticators, eq, memberships } from '@restomatch/db';
import { cleanup, makeRestaurant, makeUser, ownerDb, uniqueEmail } from '../../../join/__tests__/helpers';
import {
  PASSKEY_BLOCKERS,
  assertPasskeysConfig,
  passkeyAllowedFor,
  passkeyGetUserInfo,
  passkeySignInAllowed,
  passkeysEnabled,
  relyingParty,
} from '../passkeys';

/** W3-07b passkeys: OFF by default; owner + bookkeeper only; register needs a live full session. Add-only (warden). */
afterAll(async () => {
  await ownerDb.delete(authenticators).where(eq(authenticators.providerAccountId, 'w307b-test'));
  await cleanup();
});

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
const URL_OK = { AUTH_URL: 'https://app.restomatch.example' };

describe('passkeys flag + relying party', () => {
  it('is ON only for PASSKEYS_ENABLED="1" with a valid AUTH_URL and no open blockers', () => {
    const none: string[] = [];
    expect(passkeysEnabled(env({ ...URL_OK }), none)).toBe(false);
    expect(passkeysEnabled(env({ ...URL_OK, PASSKEYS_ENABLED: 'true' }), none)).toBe(false);
    expect(passkeysEnabled(env({ ...URL_OK, PASSKEYS_ENABLED: '0' }), none)).toBe(false);
    expect(passkeysEnabled(env({ PASSKEYS_ENABLED: '1' }), none)).toBe(false); // no AUTH_URL
    expect(passkeysEnabled(env({ PASSKEYS_ENABLED: '1', AUTH_URL: 'http://evil.example' }), none)).toBe(false);
    expect(passkeysEnabled(env({ ...URL_OK, PASSKEYS_ENABLED: '1' }), none)).toBe(true);
  });

  it('M3/M4 guard: with blockers open, the flag stays OFF and asking for it refuses to start', () => {
    expect(PASSKEY_BLOCKERS.length).toBeGreaterThan(0);
    // Each named blocker is still listed, with the test that must pass before it goes.
    for (const id of ['M3', 'M4', 'L1', 'L2', 'L3', 'L4']) {
      const entry = PASSKEY_BLOCKERS.find((b) => b.startsWith(`${id}:`));
      expect(entry, `blocker ${id}`).toBeDefined();
      expect(entry).toMatch(/— test: \S/);
    }
    expect(passkeysEnabled(env({ ...URL_OK, PASSKEYS_ENABLED: '1' }))).toBe(false);
    expect(() => assertPasskeysConfig(env({ ...URL_OK, PASSKEYS_ENABLED: '1' }))).toThrow(/refused/);
    expect(() => assertPasskeysConfig(env({ ...URL_OK }))).not.toThrow(); // flag off: boots
    expect(() => assertPasskeysConfig(env({ PASSKEYS_ENABLED: '1' }), [])).toThrow(/AUTH_URL/);
    expect(() => assertPasskeysConfig(env({ ...URL_OK, PASSKEYS_ENABLED: '1' }), [])).not.toThrow();
  });

  it('M2: getUserInfo never looks up an e-mail from the request (no enumeration)', async () => {
    expect(await passkeyGetUserInfo()).toBeNull();
  });
  it('pins the RP id and origin to AUTH_URL, never to a request header', () => {
    expect(relyingParty(env(URL_OK))).toEqual({
      id: 'app.restomatch.example',
      origin: 'https://app.restomatch.example',
      name: 'RestoMatch',
    });
    expect(relyingParty(env({ AUTH_URL: 'http://localhost:3100' }))?.id).toBe('localhost');
  });
});

describe('passkey role gate', () => {
  it('allows owner and bookkeeper; refuses manager, receiver, chef, no membership and unknown users', async () => {
    const rid = await makeRestaurant();
    const ids: Record<string, string> = {};
    for (const role of ['owner', 'bookkeeper', 'manager', 'receiver', 'chef'] as const) {
      ids[role] = await makeUser(uniqueEmail(`pk-${role}`));
      await ownerDb.insert(memberships).values({ userId: ids[role]!, restaurantId: rid, role });
    }
    const loner = await makeUser(uniqueEmail('pk-none'));
    expect(await passkeyAllowedFor(ids.owner)).toBe(true);
    expect(await passkeyAllowedFor(ids.bookkeeper)).toBe(true);
    expect(await passkeyAllowedFor(ids.manager)).toBe(false);
    expect(await passkeyAllowedFor(ids.receiver)).toBe(false);
    expect(await passkeyAllowedFor(ids.chef)).toBe(false);
    expect(await passkeyAllowedFor(loner)).toBe(false);
    expect(await passkeyAllowedFor('00000000-0000-4000-8000-000000000000')).toBe(false);
    expect(await passkeyAllowedFor(undefined)).toBe(false);
  });
});

describe('passkey signIn callback (register vs sign-in)', () => {
  it('attack: an anonymous register (no user id) is refused', async () => {
    expect(await passkeySignInAllowed({ userId: undefined, credentialId: 'new-cred', liveSession: async () => null })).toBe(false);
  });

  it('attack: register with a revoked / missing live session is refused, and with a 2FA-pending one too', async () => {
    const rid = await makeRestaurant();
    const owner = await makeUser(uniqueEmail('pk-reg'));
    await ownerDb.insert(memberships).values({ userId: owner, restaurantId: rid, role: 'owner' });
    const base = { userId: owner, credentialId: 'brand-new-credential' };
    expect(await passkeySignInAllowed({ ...base, liveSession: async () => null })).toBe(false); // revoked cookie → auth() empty
    expect(await passkeySignInAllowed({ ...base, liveSession: async () => ({ id: owner, twoFactorPending: true }) })).toBe(false);
    expect(await passkeySignInAllowed({ ...base, liveSession: async () => ({ id: 'someone-else', twoFactorPending: false }) })).toBe(false);
    expect(await passkeySignInAllowed({ ...base, liveSession: async () => ({ id: owner, twoFactorPending: false }) })).toBe(true);
  });

  it('sign-in with a stored credential needs no session, but only for its own user', async () => {
    const rid = await makeRestaurant();
    const owner = await makeUser(uniqueEmail('pk-auth'));
    const other = await makeUser(uniqueEmail('pk-other'));
    for (const u of [owner, other]) await ownerDb.insert(memberships).values({ userId: u, restaurantId: rid, role: 'owner' });
    const cred = `cred-${Date.now()}`;
    await ownerDb.insert(authenticators).values({
      credentialID: cred,
      userId: owner,
      providerAccountId: 'w307b-test',
      credentialPublicKey: 'x',
      counter: 0,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
    });
    expect(await passkeySignInAllowed({ userId: owner, credentialId: cred, liveSession: async () => null })).toBe(true);
    expect(await passkeySignInAllowed({ userId: other, credentialId: cred, liveSession: async () => null })).toBe(false);
  });
});
