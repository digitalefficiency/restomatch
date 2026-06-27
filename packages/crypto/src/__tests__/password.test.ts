import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../password';

describe('argon2id password hashing', () => {
  it('produces an argon2id PHC string and verifies the original password', async () => {
    const hash = await hashPassword('correct horse battery staple ₪');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple ₪')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-passw0rd!');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('uses a unique salt per call (same input → different hash)', async () => {
    const a = await hashPassword('same-input');
    const b = await hashPassword('same-input');
    expect(a).not.toEqual(b);
    expect(await verifyPassword(a, 'same-input')).toBe(true);
    expect(await verifyPassword(b, 'same-input')).toBe(true);
  });

  it('returns false (does not throw) on a malformed hash', async () => {
    expect(await verifyPassword('not-a-real-hash', 'whatever')).toBe(false);
  });

  it('returns false on empty inputs', async () => {
    expect(await verifyPassword('', 'x')).toBe(false);
    const hash = await hashPassword('non-empty');
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('throws when asked to hash an empty password', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });
});
