import { createDb, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import type { Tenant } from './fixtures';

/** Shared by the W2-09 owner-*.test.ts files: a tRPC caller for a seeded tenant at a role. */
export const db = createDb(testDbUrl());
export function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}
export const ALL_ROLES: Session['role'][] = ['owner', 'manager', 'bookkeeper', 'receiver', 'chef'];
export const FINANCE: Session['role'][] = ['owner', 'manager', 'bookkeeper'];
