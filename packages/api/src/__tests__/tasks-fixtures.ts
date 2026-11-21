import { createDb, discrepancies, memberships, testDbUrl, users, type UserRole } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/** Shared seed for the W2-08 task-spine suites (tasks-*, nav-*). */
export const db = createDb(testDbUrl());

export interface Staffed extends Tenant {
  users: Record<UserRole, string>;
}

export async function seedStaffed(tag: string): Promise<Staffed> {
  const t = await seedTenant(db, tag);
  const out: Record<UserRole, string> = { owner: t.ownerUserId } as Record<UserRole, string>;
  for (const role of ['manager', 'bookkeeper', 'receiver', 'chef'] as const) {
    const [u] = await db.insert(users).values({ email: `${role}-${tag}@tasks.test` }).returning();
    await db.insert(memberships).values({ userId: u!.id, restaurantId: t.restaurantId, role });
    out[role] = u!.id;
  }
  return { ...t, users: out };
}

export async function addDiscrepancy(t: Tenant, v: { type?: string; severity?: 'info' | 'warn' | 'block'; delta?: string; role?: UserRole | null }) {
  const [d] = await db
    .insert(discrepancies)
    .values({
      restaurantId: t.restaurantId,
      matchRunId: t.matchRunId,
      invoiceLineId: t.invoiceLineId,
      type: (v.type ?? 'PRICE_HIGHER') as 'PRICE_HIGHER',
      severity: v.severity ?? 'warn',
      deltaAmount: v.delta ?? '10.00',
      requiresRole: v.role === undefined ? 'owner' : v.role,
      resolutionStatus: 'open',
    })
    .returning();
  return d!;
}

export function as(t: Staffed, role: UserRole, restaurantId = t.restaurantId) {
  const ctx: AppContext = { db, session: { userId: t.users[role], restaurantId, role } };
  return appRouter.createCaller(ctx);
}

export async function fresh() {
  await resetDb(db);
  await seedPlans(db);
}
