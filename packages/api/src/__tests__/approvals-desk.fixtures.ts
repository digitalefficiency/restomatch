/**
 * W2-04 test helpers: a tenant (fixtures.seedTenant) plus members of every
 * role, and invoices with gaps of exact ₪ so the bulk cap can be probed at the
 * agora. Not a test file (no `.test.`): imported by the approvals-* suites.
 */
import {
  discrepancies,
  invoices,
  matchRuns,
  memberships,
  users,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { seedTenant, type Tenant } from './fixtures';

export interface Desk extends Tenant {
  users: Record<UserRole, string>;
}

export async function seedDesk(db: Database, tag: string): Promise<Desk> {
  const T = await seedTenant(db, tag);
  const out: Record<string, string> = { owner: T.ownerUserId };
  for (const role of ['manager', 'bookkeeper', 'receiver', 'chef'] as const) {
    const [u] = await db
      .insert(users)
      .values({ email: `${role}-${tag}@desk.test`, name: `${role} ${tag}`, emailVerified: new Date() })
      .returning();
    await db.insert(memberships).values({ userId: u!.id, restaurantId: T.restaurantId, role });
    out[role] = u!.id;
  }
  return { ...T, users: out as Record<UserRole, string> };
}

export function callerAs(db: Database, T: Desk, role: UserRole, userId = T.users[role]) {
  const ctx: AppContext = { db, session: { userId, restaurantId: T.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

/** A matched (unpaid) invoice with a big enough total that the per-invoice cap never binds. */
export async function addInvoice(
  db: Database,
  T: Desk,
  n: string,
  opts: { totalInclVat?: string; status?: 'matched' | 'paid' } = {},
): Promise<{ invoiceId: string; matchRunId: string }> {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: T.restaurantId,
      supplierId: T.supplierId,
      invoiceNumber: `DESK-${n}`,
      invoiceDate: new Date('2026-10-20T00:00:00Z'),
      totalExclVat: '1000.00',
      vatAmount: '170.00',
      totalInclVat: opts.totalInclVat ?? '1170.00',
      status: opts.status ?? 'matched',
      source: 'photo',
      createdBy: T.ownerUserId,
    })
    .returning();
  const [mr] = await db
    .insert(matchRuns)
    .values({ restaurantId: T.restaurantId, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
    .returning();
  return { invoiceId: inv!.id, matchRunId: mr!.id };
}

export async function addGap(
  db: Database,
  T: Desk,
  matchRunId: string,
  g: {
    deltaAmount: string;
    type?: (typeof discrepancies.$inferInsert)['type'];
    severity?: 'info' | 'warn' | 'block';
    requiresRole?: UserRole | null;
  },
): Promise<string> {
  const [d] = await db
    .insert(discrepancies)
    .values({
      restaurantId: T.restaurantId,
      matchRunId,
      type: g.type ?? 'PRICE_HIGHER',
      severity: g.severity ?? 'warn',
      deltaAmount: g.deltaAmount,
      requiresRole: g.requiresRole === undefined ? 'manager' : g.requiresRole,
      resolutionStatus: 'open',
    })
    .returning();
  return d!.id;
}

/** The TRPCError message payload after a known prefix. */
export function payloadOf(err: unknown, prefix: string): unknown {
  const msg = (err as { message?: string }).message ?? '';
  if (!msg.startsWith(prefix)) throw new Error(`expected ${prefix}…, got ${msg}`);
  return JSON.parse(msg.slice(prefix.length));
}
