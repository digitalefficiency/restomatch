import { describe, expect, it, vi } from 'vitest';
import { goTarget, resolveGo, type GoDeps } from '../goResolver';

const MEMBER = '11111111-1111-4111-8111-111111111111';
const ACTIVE = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';

function deps(members: string[]): GoDeps & { switched: string[] } {
  const switched: string[] = [];
  return {
    switched,
    checkMembership: vi.fn(async (id: string) => {
      if (!members.includes(id)) throw Object.assign(new Error('branch not found'), { code: 'NOT_FOUND' });
      return { restaurantId: id };
    }),
    switchTo: vi.fn(async (id: string) => {
      switched.push(id);
    }),
  };
}

describe('/dashboard/go resolver (ia-nav-08/-09)', () => {
  it('a member r: switches the branch, then 303s to `to`', async () => {
    const d = deps([MEMBER, ACTIVE]);
    const res = await resolveGo({ r: MEMBER, to: '/dashboard/approvals?sel=inv-1', activeRestaurantId: ACTIVE }, d);
    expect(res).toEqual({ location: '/dashboard/approvals?sel=inv-1', outcome: 'switched' });
    expect(d.switched).toEqual([MEMBER]);
  });

  it('REGRESSION: a non-member r is refused — the session branch is never switched', async () => {
    const d = deps([MEMBER, ACTIVE]);
    const res = await resolveGo({ r: STRANGER, to: '/dashboard/approvals', activeRestaurantId: ACTIVE }, d);
    expect(res.outcome).toBe('refused');
    expect(d.switchTo).not.toHaveBeenCalled();
    const url = new URL(res.location, 'https://app.test');
    expect(url.pathname).toBe('/dashboard/forbidden');
    expect(url.searchParams.get('reason')).toBe('notMember');
    expect(url.searchParams.get('from')).toBe('/dashboard/approvals');
  });

  it('a malformed r is refused without even asking the server', async () => {
    const d = deps([MEMBER]);
    for (const r of ["' or 1=1 --", 'not-a-uuid', `${MEMBER}x`]) {
      const res = await resolveGo({ r, to: '/dashboard', activeRestaurantId: ACTIVE }, d);
      expect(res.outcome, r).toBe('refused');
    }
    expect(d.checkMembership).not.toHaveBeenCalled();
    expect(d.switchTo).not.toHaveBeenCalled();
  });

  it('the active branch (or no r) just opens `to`', async () => {
    const d = deps([ACTIVE]);
    expect(await resolveGo({ r: ACTIVE, to: '/dashboard/orders', activeRestaurantId: ACTIVE }, d)).toEqual({
      location: '/dashboard/orders',
      outcome: 'same',
    });
    expect(await resolveGo({ r: null, to: '/dashboard/orders', activeRestaurantId: ACTIVE }, d)).toEqual({
      location: '/dashboard/orders',
      outcome: 'noBranch',
    });
    expect(d.switchTo).not.toHaveBeenCalled();
  });

  it('`to` is validated: no open redirect, no leaving /dashboard, no resolver loop', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/login', '/api/trpc/x', '/dashboard/go?r=x', '', null]) {
      expect(goTarget(bad), String(bad)).toBe('/dashboard');
    }
    expect(goTarget('/dashboard/orders/new?supplierId=abc&from=last')).toBe('/dashboard/orders/new?supplierId=abc&from=last');
  });

  it('a refused link to an unsafe `to` still points the forbidden page at a safe path', async () => {
    const res = await resolveGo({ r: STRANGER, to: 'https://evil.com', activeRestaurantId: ACTIVE }, deps([]));
    expect(new URL(res.location, 'https://app.test').searchParams.get('from')).toBe('/dashboard');
  });
});
