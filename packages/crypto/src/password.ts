import { hash, verify } from '@node-rs/argon2';
import type { Algorithm, Options, Version } from '@node-rs/argon2';

// @node-rs/argon2 ships its Algorithm/Version codes as ambient `const enum`s,
// which TS forbids reading as *values* under isolatedModules/verbatimModuleSyntax.
// We import the enum *types* only and pin the numeric codes directly so the
// algorithm choice stays explicit and reviewable.
const ALGORITHM_ARGON2ID = 2 as Algorithm; // Algorithm.Argon2id
const VERSION_0X13 = 1 as Version; // Version.V0x13 (argon2 v19)

/**
 * argon2id password hashing primitive.
 *
 * This module is intentionally standalone and is NOT wired into the auth flow
 * yet (Epic D3.7). Epic B (`apps/web/lib/passwords.ts`) will consume it once the
 * credential-login work begins. It is node-runtime only — never import it from
 * `auth.config.ts` / `middleware.ts` (the edge bundle), so the native argon2
 * binding stays out of the edge build.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet recommendation for
 * argon2id (m=19 MiB, t=2, p=1). They are exported so Epic B can detect and
 * transparently rehash credentials if the cost factors are raised later.
 */
export const ARGON2ID_OPTIONS = {
  algorithm: ALGORITHM_ARGON2ID,
  version: VERSION_0X13,
  /** Memory cost in KiB (19 MiB). */
  memoryCost: 19_456,
  /** Iterations. */
  timeCost: 2,
  /** Degree of parallelism. */
  parallelism: 1,
} satisfies Options;

/** Hash a plaintext password into a self-describing argon2id PHC string. */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('password must be a non-empty string');
  }
  return hash(plain, ARGON2ID_OPTIONS);
}

/**
 * Verify a plaintext password against a stored argon2id hash. Returns `false`
 * (never throws) for a non-matching password or a malformed/foreign hash, so
 * callers cannot leak the distinction between "wrong password" and "bad hash".
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  if (!storedHash || !plain) return false;
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
