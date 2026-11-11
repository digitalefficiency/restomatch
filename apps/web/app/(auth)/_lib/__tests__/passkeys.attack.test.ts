import { afterAll, describe, expect, it } from 'vitest';
import { memberships } from '@restomatch/db';
import { cleanup, makeRestaurant, makeUser, ownerDb, uniqueEmail } from '../../../join/__tests__/helpers';
import { passkeyAllowedFor, passkeysEnabled } from '../passkeys';

/** W3-07b passkeys: OFF by default; owner + bookkeeper only. Add-only (warden). */
afterAll(cleanup);

describe('passkeys flag', () => {
  it('is OFF unless PASSKEYS_ENABLED is exactly "1"', () => {
    expect(passkeysEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(passkeysEnabled({ PASSKEYS_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(false);
    expect(passkeysEnabled({ PASSKEYS_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(passkeysEnabled({ PASSKEYS_ENABLED: '1' } as NodeJS.ProcessEnv)).toBe(true);
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
