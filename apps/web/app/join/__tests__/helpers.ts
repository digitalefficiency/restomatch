import { createHash, randomBytes } from 'node:crypto';
import {
  createDb,
  eq,
  inArray,
  invitations,
  memberships,
  restaurants,
  testDbUrl,
  users,
  verificationTokens,
  type Database,
  type UserRole,
} from '@restomatch/db';

/** Owner connection on the test DB (bypasses RLS) — seeding + assertions only. */
export const ownerDb: Database = createDb(testDbUrl());

const createdUsers: string[] = [];
const createdRestaurants: string[] = [];
let seq = 0;

export function uniqueEmail(tag: string): string {
  return `w307b-${tag}-${Date.now()}-${seq++}@restaurant.example`;
}

export async function makeRestaurant(name = 'מסעדת בדיקה'): Promise<string> {
  const [r] = await ownerDb.insert(restaurants).values({ name }).returning({ id: restaurants.id });
  createdRestaurants.push(r!.id);
  return r!.id;
}

export async function makeUser(email: string, name: string | null = 'Inviter'): Promise<string> {
  const [u] = await ownerDb.insert(users).values({ email, name, emailVerified: new Date() }).returning({ id: users.id });
  createdUsers.push(u!.id);
  return u!.id;
}

/** A pending invite; returns the RAW token (only its hash is stored, as in team.invite). */
export async function makeInvite(opts: {
  restaurantId: string;
  email: string;
  role?: UserRole;
  invitedBy?: string | null;
  expiresInMs?: number;
  status?: 'pending' | 'accepted' | 'revoked' | 'expired';
}): Promise<{ token: string; id: string }> {
  const token = randomBytes(32).toString('base64url');
  const [inv] = await ownerDb
    .insert(invitations)
    .values({
      restaurantId: opts.restaurantId,
      email: opts.email,
      role: opts.role ?? 'receiver',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      invitedByUserId: opts.invitedBy ?? null,
      status: opts.status ?? 'pending',
      expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 7 * 24 * 3600 * 1000)),
    })
    .returning({ id: invitations.id });
  return { token, id: inv!.id };
}

export async function userByEmail(email: string) {
  const [u] = await ownerDb.select().from(users).where(eq(users.email, email)).limit(1);
  if (u) createdUsers.push(u.id);
  return u ?? null;
}

export async function membershipsOf(userId: string) {
  return ownerDb.select().from(memberships).where(eq(memberships.userId, userId));
}

export async function cleanup(): Promise<void> {
  if (createdRestaurants.length) {
    const invs = await ownerDb
      .select({ id: invitations.id })
      .from(invitations)
      .where(inArray(invitations.restaurantId, createdRestaurants));
    for (const { id } of invs) {
      for (const prefix of ['join:', 'join-fail:']) {
        await ownerDb.delete(verificationTokens).where(eq(verificationTokens.identifier, `${prefix}${id}`));
      }
    }
    await ownerDb.delete(restaurants).where(inArray(restaurants.id, createdRestaurants));
  }
  if (createdUsers.length) {
    const ids = [...new Set(createdUsers)];
    const ident = ids.flatMap((id) => [`login:${id}`, `login-fail:${id}`]);
    await ownerDb.delete(verificationTokens).where(inArray(verificationTokens.identifier, ident));
    await ownerDb.delete(users).where(inArray(users.id, ids));
  }
}
