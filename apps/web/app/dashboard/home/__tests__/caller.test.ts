import { describe, expect, it } from 'vitest';
import { HOME_NAMESPACES, OWNER_MONEY_PROCEDURES, homeCaller, type Caller } from '../caller';

/** A stand-in caller: every namespace exists, so only the restriction can hide one. */
function fakeCaller(): Caller {
  const ns = (name: string) => new Proxy({}, { get: (_t, proc) => () => `${name}.${String(proc)}` });
  return new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' ? ns(prop) : undefined) }) as unknown as Caller;
}

describe('homeCaller — staff homes never reach the restaurant’s money', () => {
  it.each(['receiver', 'chef'] as const)('%s: owner.* (kpis, leakHero, leakSummary) is not reachable', (role) => {
    const c = homeCaller(fakeCaller(), role) as unknown as Record<string, unknown>;
    expect(c.owner).toBeUndefined();
    expect(c.approvals).toBeUndefined();
    expect(c.recovery).toBeUndefined();
    expect(c.payRun).toBeUndefined();
    for (const proc of OWNER_MONEY_PROCEDURES) expect(proc.startsWith('owner.')).toBe(true);
  });

  it('receiver: only receiving; chef: only inventory + recipes', () => {
    expect(HOME_NAMESPACES.receiver).toEqual(['receiving']);
    expect([...HOME_NAMESPACES.chef].sort()).toEqual(['inventory', 'recipes']);
    const r = homeCaller(fakeCaller(), 'receiver') as unknown as Record<string, Record<string, () => string>>;
    expect(r.receiving!.todayExpectations!()).toBe('receiving.todayExpectations');
  });

  it('finance homes keep owner.* (the hero is theirs)', () => {
    for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
      expect(HOME_NAMESPACES[role]).toContain('owner');
    }
  });
});
