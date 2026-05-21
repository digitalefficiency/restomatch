import type { Database } from '@restomatch/db';

export interface Session {
  userId: string;
  restaurantId: string;
  role: 'owner' | 'manager' | 'receiver' | 'bookkeeper' | 'chef';
}

export interface AppContext {
  db: Database;
  session: Session | null;
}

export type AuthedContext = AppContext & { session: Session };
