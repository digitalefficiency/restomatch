import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryRevocationStore,
  isSessionRevoked,
  revokeSession,
  setRevocationStoreForTests,
  type RevocationStore,
} from '../sessionRevocation';

afterEach(() => setRevocationStoreForTests(undefined));

describe('session revocation (sign-out deny-list)', () => {
  it('a revoked sid stays revoked; other sessions are untouched', async () => {
    setRevocationStoreForTests(new MemoryRevocationStore());
    await revokeSession('sid-laptop');
    expect(await isSessionRevoked('sid-laptop')).toBe(true);
    // The same user's phone keeps its session (unlike token_version).
    expect(await isSessionRevoked('sid-phone')).toBe(false);
  });

  it('the entry expires with the session lifetime (no unbounded growth)', async () => {
    let now = 1_000_000;
    setRevocationStoreForTests(new MemoryRevocationStore(() => now));
    await revokeSession('sid-a', 60);
    now += 59_000;
    expect(await isSessionRevoked('sid-a')).toBe(true);
    now += 2_000;
    expect(await isSessionRevoked('sid-a')).toBe(false);
  });

  it('fails OPEN on a store outage (never signs everyone out) and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: RevocationStore = {
      add: () => Promise.reject(new Error('redis down')),
      has: () => Promise.reject(new Error('redis down')),
    };
    setRevocationStoreForTests(broken);
    await expect(revokeSession('sid-x')).resolves.toBeUndefined();
    expect(await isSessionRevoked('sid-x')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
