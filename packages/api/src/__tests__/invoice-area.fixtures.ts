/**
 * INV-00 test helpers (not a test file: no `.test.`), imported by the invoices-area suites:
 * two tenants with a member of every role (`approvals-desk.fixtures.ts` seedDesk), callers on
 * the RLS app role, and builders for the facts the area's reads describe. New helpers live
 * here and never in `fixtures.ts` (pull request 237 edits that file).
 */
import {
  applyAuditImmutableRls,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  testDbUrl,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { seedDesk, type Desk } from './approvals-desk.fixtures';
import { resetDb, seedPlans } from './fixtures';

export const TEST_DB_URL = testDbUrl();

/** The owner connection (seeding, resets) and the RLS app-role connection (every call under test). */
export async function areaDbs(): Promise<{ ownerDb: Database; appDb: Database }> {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  return { ownerDb: createDb(TEST_DB_URL), appDb: createDb(await ensureRlsAppRole(TEST_DB_URL)) };
}

/** A clean database with two tenants, A and B, each with a member of every role. */
export async function seedTwo(ownerDb: Database, tag: string): Promise<{ A: Desk; B: Desk }> {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  const A = await seedDesk(ownerDb, `${tag}A`);
  const B = await seedDesk(ownerDb, `${tag}B`);
  return { A, B };
}

/** A caller of `role` in tenant T, as that role's own member, on the RLS app role. */
export function callerOn(appDb: Database, T: Desk, role: UserRole, userId: string = T.users[role]) {
  const ctx: AppContext = { db: appDb, session: { userId, restaurantId: T.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

/** Every key of a payload, at any depth (for the "roles only" deep scan). */
export function deepKeys(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) for (const x of v) deepKeys(x, out);
  else if (v && typeof v === 'object' && !(v instanceof Date)) {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      deepKeys(x, out);
    }
  }
  return out;
}

/** Keys that would carry a person's identity; none may appear in a new read (owner decision 4). */
export const IDENTITY_KEY = /^(userId|user_id|name|email|actorId|actorName|resolvedBy|createdBy|escalatedBy|receivedBy)$/i;
