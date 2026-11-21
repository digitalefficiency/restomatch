import 'server-only';
import { and, auditLog, eq, gt, inArray, invitations, memberships, restaurants, users, type UserRole } from '@restomatch/db';
import { canonicalizeEmail } from '@restomatch/api';
import { authDb } from '@/lib/authDb';

/**
 * W3-07b: `/onboarding` detects invites already waiting for the signed-in
 * address and offers to join instead of creating a stray tenant. Identity zone
 * (owner auth connection): the user is not a member of the tenant yet, so the
 * checks here ARE the boundary — pending, unexpired, and addressed to the
 * session user's own e-mail (canonical match, as in team.acceptInvite).
 */
export interface PendingInvite {
  id: string;
  restaurantName: string;
  role: UserRole;
  inviterName: string | null;
}

async function userEmail(userId: string): Promise<string | null> {
  const [u] = await authDb.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.email ?? null;
}

export async function pendingInvitesFor(userId: string, now = Date.now()): Promise<PendingInvite[]> {
  const email = await userEmail(userId);
  if (!email) return [];
  const rows = await authDb
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      restaurantName: restaurants.name,
      invitedBy: invitations.invitedByUserId,
    })
    .from(invitations)
    .innerJoin(restaurants, eq(restaurants.id, invitations.restaurantId))
    .where(
      and(
        eq(invitations.email, email.trim().toLowerCase()),
        eq(invitations.status, 'pending'),
        gt(invitations.expiresAt, new Date(now)),
      ),
    );
  const inviterIds = [...new Set(rows.map((r) => r.invitedBy).filter((v): v is string => Boolean(v)))];
  const names = new Map(
    inviterIds.length
      ? (await authDb.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, inviterIds))).map(
          (u) => [u.id, u.name] as const,
        )
      : [],
  );
  const canon = canonicalizeEmail(email);
  return rows
    .filter((r) => canonicalizeEmail(r.email) === canon)
    .map((r) => ({ id: r.id, restaurantName: r.restaurantName, role: r.role, inviterName: (r.invitedBy ? names.get(r.invitedBy) : null)?.trim() || null }));
}

export type AcceptPendingResult = { ok: true; restaurantId: string } | { ok: false; reason: 'notFound' | 'wrongEmail' | 'used' | 'expired' };

/** Accept one pending invite BY ID for the session user. Role and restaurant come only from the row. */
export async function acceptPendingInvite(userId: string, invitationId: string, now = Date.now()): Promise<AcceptPendingResult> {
  if (!/^[0-9a-f-]{36}$/i.test(invitationId)) return { ok: false, reason: 'notFound' };
  const [inv] = await authDb.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1);
  if (!inv) return { ok: false, reason: 'notFound' };
  const email = await userEmail(userId);
  // Anti-hijack: same answer as "not found" would leak nothing more, but the
  // caller is signed in and already knows their own address — be explicit.
  if (!email || canonicalizeEmail(email) !== canonicalizeEmail(inv.email)) return { ok: false, reason: 'wrongEmail' };
  if (inv.status !== 'pending') return { ok: false, reason: 'used' };
  if (inv.expiresAt.getTime() <= now) return { ok: false, reason: 'expired' };

  const accepted = await authDb.transaction(async (tx) => {
    const flipped = await tx
      .update(invitations)
      .set({ status: 'accepted', acceptedAt: new Date(now), acceptedByUserId: userId, updatedAt: new Date(now) })
      .where(and(eq(invitations.id, inv.id), eq(invitations.status, 'pending')))
      .returning({ id: invitations.id });
    if (flipped.length === 0) return false; // a parallel accept won
    await tx
      .insert(memberships)
      .values({
        userId,
        restaurantId: inv.restaurantId,
        role: inv.role,
        preferredLocale: inv.preferredLocale === 'he' || inv.preferredLocale === 'en' ? inv.preferredLocale : null,
      })
      .onConflictDoNothing();
    // Same row shape as @restomatch/api recordAudit (not exported to web; the
    // export line in api/index.ts is orchestrator-gated). Owner connection.
    await tx.insert(auditLog).values({
      restaurantId: inv.restaurantId,
      userId,
      action: 'team.invite_accepted',
      entityType: 'invitation',
      entityId: inv.id,
      before: null as never,
      after: { role: inv.role, via: 'onboarding' } as never,
    });
    return true;
  });
  return accepted ? { ok: true, restaurantId: inv.restaurantId } : { ok: false, reason: 'used' };
}
