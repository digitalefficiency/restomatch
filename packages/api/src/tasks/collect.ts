import { TRPCError } from '@trpc/server';
import type { UserRole } from '@restomatch/db';
import type { MemberContext } from '../context';
import { isFeatureOn } from '../lib/featureGate';
import { MAX_CLAIMS } from '../recovery/service';
import { approvalsRouter } from '../routers/approvals';
import { inventoryRouter } from '../routers/inventory';
import { ownerRouter } from '../routers/owner';
import { payRunRouter } from '../routers/payRun';
import { receivingRouter } from '../routers/receiving';
import { recoveryRouter } from '../routers/recovery';
import { suppliersRouter } from '../routers/suppliers';
import { israelDay, rankTasks } from './rank';
import {
  claimTasks,
  countTasks,
  decisionTasks,
  deliveryTasks,
  orderTasks,
  payRunTasks,
  vatTasks,
} from './sources';
import type { Task, TasksResult } from './types';

export type SourceKey = 'decision' | 'orders' | 'claims' | 'vat' | 'payRun' | 'deliveries' | 'count';

/**
 * Which sources each role's spine reads (G-07 `VISIBLE_TO` replaces this map
 * when it lands). Receiver and chef never read a money source: no `owner.*`,
 * no approvals, no claims (page.tsx keeps the same invariant for the homes).
 */
export const SOURCES_BY_ROLE: Record<UserRole, readonly SourceKey[]> = {
  owner: ['decision', 'claims', 'vat', 'payRun'],
  manager: ['decision', 'orders', 'claims', 'deliveries', 'count'],
  bookkeeper: ['decision', 'vat', 'payRun'],
  receiver: ['deliveries'],
  chef: ['orders', 'count'],
};

/**
 * Roles that may see ₪ in tasks and badges. TODO(G-07): `CAP['money.view']`.
 * The chef's ₪ on orders/recipes screens is not a task figure.
 */
export function canViewMoney(role: UserRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'bookkeeper';
}

/** Strip every ₪ from a task (server-side, for roles without money.view). */
export function redactTask(t: Task): Task {
  const detail = t.detail
    ? Object.fromEntries(Object.entries(t.detail).filter(([k]) => !/agorot|ils/i.test(k)))
    : undefined;
  return { ...t, ilsAgorot: null, ...(detail ? { detail } : {}) };
}

/**
 * Build the viewer's tasks. Each source calls the procedure its own page reads
 * (same ctx, same tenant transaction; each sub-call is a savepoint, so one
 * failing source never poisons the rest). A disabled feature is "no tasks", not
 * a failure; a failure is reported in `failed` (the home shows an error state,
 * never "הכל טופל").
 */
export async function collectTasks(ctx: MemberContext, opts: { now?: Date; only?: readonly SourceKey[] } = {}): Promise<TasksResult> {
  const now = opts.now ?? new Date();
  const today = israelDay(now);
  const role = ctx.session.role;
  const rid = ctx.session.restaurantId;
  const sub = { db: ctx.db, adminDb: ctx.adminDb, session: { ...ctx.session } };
  const wanted = SOURCES_BY_ROLE[role].filter((s) => !opts.only || opts.only.includes(s));
  const on = (key: Parameters<typeof isFeatureOn>[2]) => isFeatureOn(ctx.db, rid, key);

  const run: Record<SourceKey, () => Promise<Task[]>> = {
    // TODO(G-12a): awaitingDecision(ctx, { scope: 'mine' }) — the one-line swap; tasks-parity pins it.
    decision: async () => decisionTasks(await approvalsRouter.createCaller(sub).queueSummary(), today),
    orders: async () => orderTasks(await suppliersRouter.createCaller(sub).list(), now, today),
    claims: async () => ((await on('recovery')) ? claimTasks(await recoveryRouter.createCaller(sub).list({ limit: MAX_CLAIMS }), now, today) : []),
    vat: async () => ((await on('vatAtRisk')) ? vatTasks(await ownerRouter.createCaller(sub).vatAtRisk({ period: 'open' })) : []),
    payRun: async () => payRunTasks(await payRunRouter.createCaller(sub).month()),
    deliveries: async () => deliveryTasks(await receivingRouter.createCaller(sub).todayExpectations({ includeLate: true }), now, today),
    count: async () => ((await on('inventoryCount')) ? countTasks(await inventoryRouter.createCaller(sub).current(), today) : []),
  };

  const tasks: Task[] = [];
  const failed: string[] = [];
  // Sequential on purpose: one tenant transaction, one connection.
  for (const key of wanted) {
    try {
      tasks.push(...(await run[key]()));
    } catch (err) {
      // A FORBIDDEN here is a role/flag the map above got wrong — surface it in tests, not as "all clear".
      if (err instanceof TRPCError && err.code === 'FORBIDDEN') console.warn(`[tasks] ${key} forbidden for ${role}`);
      failed.push(key);
    }
  }
  const visible = canViewMoney(role) ? tasks : tasks.map(redactTask);
  return { tasks: rankTasks(visible, today), restaurantClear: visible.length === 0 && failed.length === 0, failed };
}
