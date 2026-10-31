import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter } from '../index';
import { CAP, CAPS } from '../lib/capabilities';
import { TIERS, can, publicProcedure, requireCap, router, type ProcMeta } from '../trpc';
import type { UserRole } from '@restomatch/db';
import type { AppContext } from '../context';

/**
 * G-07 — every procedure declares who it is for (`meta.tier`, set by the tier
 * exports in trpc.ts, or `meta.cap` via `can()`), and no mutation sits on the
 * bare member tier without a written reason. Pure: appRouter introspection, no DB.
 */
interface ProcDef {
  _def: { type: 'query' | 'mutation' | 'subscription'; meta?: ProcMeta };
}
function procedures(): Array<[string, ProcDef]> {
  const def = (appRouter as unknown as { _def: { procedures?: Record<string, ProcDef> } })._def;
  if (!def.procedures) throw new Error('appRouter._def.procedures missing — tRPC internals changed');
  return Object.entries(def.procedures).sort(([a], [b]) => a.localeCompare(b));
}

/** Public procedures — the immutable leads router, plan list, public pricing. */
const PUBLIC_ALLOW: Record<string, string> = {
  'leads.create': 'immutable leads.ts — the public lead form (rate-limited at the route)',
  'plans.list': 'public pricing table',
  'growth.pricing': 'public pricing page',
};

/**
 * Mutations on the bare `member` tier (any role of the restaurant). Each needs a
 * reason; a new one fails this test until it moves to a role tier / `can()` or
 * is added here with a reason.
 */
const MEMBER_MUTATION_ALLOW: Record<string, string> = {
  'settings.setMyLocale': 'self-service: the caller’s own UI locale',
  'receiverLangs.setMyLocale': 'self-service: the caller’s own receiving language',
  'receiverLangs.localNames':
    'read-shaped mutation (translates names on demand, cached); feature-gated, invoice reads re-checked against INVOICE_READER_ROLES inside',
  'scans.upload': 'every member may photograph a delivery document (receiver dock, chef walk-in); no ₪ returned',
  'approvals.approve': 'deciderProcedure (owner|manager|bookkeeper) + ensureCanAct → ACT_ON; adopts can("discrepancy.decide") in W2-04',
  'approvals.reject': 'deciderProcedure + ensureCanAct (ACT_ON); W2-04',
  'approvals.escalate': 'deciderProcedure + ensureCanAct (ACT_ON); W2-04',
  'approvals.reopen': 'deciderProcedure + ensureCanAct (ACT_ON); W2-04',
};

describe('procedure walk', () => {
  it('every procedure declares meta.tier or meta.cap, and the tier is a known one', () => {
    const missing: string[] = [];
    for (const [path, p] of procedures()) {
      const meta = p._def.meta ?? {};
      if (!meta.tier && !meta.cap) missing.push(path);
      if (meta.tier) expect(TIERS, path).toContain(meta.tier);
      if (meta.cap) expect(CAPS, path).toContain(meta.cap);
    }
    expect(missing).toEqual([]);
  });

  it('public procedures are exactly the allow-list', () => {
    const pub = procedures()
      .filter(([, p]) => p._def.meta?.tier === 'public')
      .map(([path]) => path);
    expect(pub.sort()).toEqual(Object.keys(PUBLIC_ALLOW).sort());
  });

  it('no mutation on the bare member tier outside the allow-list (each with a reason)', () => {
    const bare = procedures()
      .filter(([, p]) => p._def.type === 'mutation' && p._def.meta?.tier === 'member' && !p._def.meta?.cap)
      .map(([path]) => path);
    expect(bare.sort()).toEqual(Object.keys(MEMBER_MUTATION_ALLOW).sort());
    for (const reason of Object.values(MEMBER_MUTATION_ALLOW)) expect(reason.length).toBeGreaterThan(10);
  });
});

describe('CAP invariants', () => {
  it('every capability has at least one role, and the owner holds every capability', () => {
    for (const cap of CAPS) {
      expect(CAP[cap].length, cap).toBeGreaterThan(0);
      expect(CAP[cap], cap).toContain('owner');
    }
  });

  it('money.view ⊇ price.view, contract.view and ledger.view holders', () => {
    for (const cap of ['price.view', 'contract.view', 'ledger.view'] as const) {
      for (const role of CAP[cap]) expect(CAP['money.view'], `${cap}:${role}`).toContain(role);
    }
  });

  it('order.money.view ⊇ money.view holders (orders-scoped ₪ is the wider one)', () => {
    for (const role of CAP['money.view']) expect(CAP['order.money.view']).toContain(role);
  });

  it('everyone who can write an order can see the orders and their prices', () => {
    for (const cap of ['order.draft', 'order.send', 'order.cancel'] as const) {
      for (const role of CAP[cap]) {
        expect(CAP['order.view'], `${cap}:${role}`).toContain(role);
        expect(CAP['order.money.view'], `${cap}:${role}`).toContain(role);
      }
    }
  });
});

describe('can() / requireCap()', () => {
  const probe = router({
    // can() is typed for member-or-higher bases; a public base (same runtime
    // builder) lets this pure test run the middleware without a DB transaction.
    viaCan: can('order.send', publicProcedure as unknown as Parameters<typeof can>[1]).query(() => 'ok'),
    viaUse: publicProcedure.use(requireCap('money.view')).query(() => 'ok'),
  });
  const callerAs = (role: UserRole) =>
    probe.createCaller({
      db: undefined as never,
      session: { userId: 'u', restaurantId: 'r', role },
    } as AppContext);

  it('records meta.cap and keeps the base tier', () => {
    const def = (probe as unknown as { _def: { procedures: Record<string, ProcDef> } })._def.procedures;
    expect(def.viaCan!._def.meta).toEqual({ tier: 'public', cap: 'order.send' });
    // can() on the default (member) base keeps tier: 'member'.
    const memberCan = router({ x: can('order.view').query(() => 1) });
    const md = (memberCan as unknown as { _def: { procedures: Record<string, ProcDef> } })._def.procedures;
    expect(md.x!._def.meta).toEqual({ tier: 'member', cap: 'order.view' });
  });

  it('lets a holder through and rejects others with FORBIDDEN + a stable appCode', async () => {
    await expect(callerAs('chef').viaCan()).resolves.toBe('ok');
    await expect(callerAs('owner').viaUse()).resolves.toBe('ok');
    for (const [role, proc] of [
      ['receiver', 'viaCan'],
      ['bookkeeper', 'viaCan'],
      ['chef', 'viaUse'],
      ['receiver', 'viaUse'],
    ] as const) {
      const err = await callerAs(role)[proc]().catch((e: unknown) => e);
      expect(err, `${role}.${proc}`).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
      expect((err as TRPCError & { cause: { appCode: string; appParams: unknown } }).cause).toMatchObject({
        appCode: 'auth.forbidden',
        appParams: { capability: proc === 'viaCan' ? 'order.send' : 'money.view' },
      });
    }
  });

  it('rejects a caller with no session', async () => {
    const anon = probe.createCaller({ db: undefined as never, session: null } as AppContext);
    await expect(anon.viaCan()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
