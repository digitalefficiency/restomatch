import type { Database, UserRole } from '@restomatch/db';

export interface Session {
  userId: string;
  restaurantId: string | null;
  role: UserRole | null;
  /**
   * True when the user is 2FA-enrolled but has not yet presented the second
   * factor (Epic C session gate). A pending session is treated as
   * UNAUTHENTICATED by authedProcedure — it must complete /login/2fa first.
   */
  twoFactorPending?: boolean;
}

export type MemberSession = Session & {
  restaurantId: string;
  role: UserRole;
};

export interface AppContext {
  db: Database;
  /**
   * Owner/service connection for cross-tenant platform-admin queries (they must
   * bypass per-tenant RLS). Falls back to `db` when unset — correct today since
   * `db` is the owner connection until DATABASE_URL_APP is provisioned.
   */
  adminDb?: Database;
  session: Session | null;
}

export type AuthedContext = AppContext & { session: Session };
export type MemberContext = AppContext & { session: MemberSession };
