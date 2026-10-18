import 'server-only';
import { eq, users } from '@restomatch/db';
import { authDb } from '@/lib/authDb';

/**
 * Whether a user is a platform operator. Mirrors adminProcedure: the
 * is_platform_admin flag OR the PLATFORM_ADMIN_EMAILS allowlist (bootstrap).
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [user] = await authDb
    .select({
      email: users.email,
      emailVerified: users.emailVerified,
      isAdmin: users.isPlatformAdmin,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return false;
  if (user.isAdmin) return true;
  // Allowlist requires a verified email (kept in lockstep with adminProcedure).
  if (user.emailVerified == null) return false;
  const allowlist = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(user.email.toLowerCase());
}
