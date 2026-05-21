import type { Database, UserRole } from '@restomatch/db';

export interface Session {
  userId: string;
  restaurantId: string | null;
  role: UserRole | null;
}

export type MemberSession = Session & {
  restaurantId: string;
  role: UserRole;
};

export interface AppContext {
  db: Database;
  session: Session | null;
}

export type AuthedContext = AppContext & { session: Session };
export type MemberContext = AppContext & { session: MemberSession };
