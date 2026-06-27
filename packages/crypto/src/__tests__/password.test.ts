import { describe, expect, it } from 'vitest';
import { ARGON2ID_OPTIONS, hashPassword, needsRehash, verifyPassword } from '../password';

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

describe('needsRehash (transparent re-hash on param change)', () => {
  it('does NOT flag a hash minted with the current parameters', async () => {
    const hash = await hashPassword('keep-me-as-is');
    expect(needsRehash(hash)).toBe(false);
  });

  it('flags a hash made with a WEAKER memory cost', () => {
    const weaker = ARGON2ID_OPTIONS.memoryCost - 1024;
    const stored = `$argon2id$v=19$m=${weaker},t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g`;
    expect(needsRehash(stored)).toBe(true);
  });

  it('flags a hash made with fewer iterations', () => {
    const stored = `$argon2id$v=19$m=${ARGON2ID_OPTIONS.memoryCost},t=1,p=1$c29tZXNhbHQ$c29tZWhhc2g`;
    expect(needsRehash(stored)).toBe(true);
  });

  it('flags an older argon2 version', () => {
    const stored = `$argon2id$v=16$m=${ARGON2ID_OPTIONS.memoryCost},t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g`;
    expect(needsRehash(stored)).toBe(true);
  });

  it('flags a non-argon2id (foreign/legacy) hash and empty input', () => {
    expect(needsRehash('$2b$12$abcdefghijklmnopqrstuv')).toBe(true); // bcrypt
    expect(needsRehash('$argon2i$v=19$m=19456,t=2,p=1$x$y')).toBe(true); // argon2i, not id
    expect(needsRehash('')).toBe(true);
  });

  it('does NOT flag a STRONGER hash (more memory than current target)', () => {
    const stronger = ARGON2ID_OPTIONS.memoryCost + 8192;
    const stored = `$argon2id$v=19$m=${stronger},t=3,p=1$c29tZXNhbHQ$c29tZWhhc2g`;
    expect(needsRehash(stored)).toBe(false);
  });
});
