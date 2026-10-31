import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import { createAppQueryClient, onRouteChange } from '@/lib/trpc/queryClient';
import { forbiddenOutcome, upLinkFor } from '../access';
import { decideAfterSignIn } from '../reauthDecision';
import { abandonReauth, completeReauth, pendingRetries, requestReauth } from '../reauth';

/**
 * W1-04 review fixes (money safety of the re-auth replay + review findings
 * 4, 5, 7, 8). Each test failed against the previous implementation.
 */

const trpcError = (code: string, httpStatus = 400) => Object.assign(new Error(code), { data: { code, httpStatus } });

afterEach(() => abandonReauth());

describe('BLOCKER 1/2: a mutation is NEVER replayed after re-auth', () => {
  it('an UNAUTHORIZED mutation rejects to its caller, parks nothing, and does not run again after sign-in', async () => {
    const qc = createAppQueryClient();
    let signedIn = false;
    const fn = vi.fn(async () => {
      if (!signedIn) throw trpcError('UNAUTHORIZED', 401);
      return 'po-created';
    });
    const mutation = qc.getMutationCache().build(qc, { mutationFn: fn });
    await expect(mutation.execute({ supplierId: 's1' })).rejects.toThrow('UNAUTHORIZED');
    expect(pendingRetries(), 'a money decision must not be parked for replay').toBe(0);
    signedIn = true;
    completeReauth();
    await new Promise((r) => setTimeout(r, 20));
    expect(fn, 'the PO must be created at most once — by the user re-tapping').toHaveBeenCalledTimes(1);
  });

  it('queries are replayed once, deduped by key (a re-render cannot stack replays)', async () => {
    const a = vi.fn();
    requestReauth(a, 'k1');
    requestReauth(a, 'k1');
    requestReauth(a, 'k1');
    expect(pendingRetries()).toBe(1);
    completeReauth();
    expect(a).toHaveBeenCalledTimes(1);
  });
});

describe('BLOCKER 3 + MINOR 5/6: what happens after a sign-in', () => {
  const owner = { id: 'u1', restaurantId: 'r-haifa' };
  it('the same user in the same branch resumes (queries replay)', () => {
    expect(decideAfterSignIn(owner, { id: 'u1', restaurantId: 'r-haifa', pending: false })).toEqual({ kind: 'resume' });
  });
  it('the same user landed in another branch: switch back BEFORE anything replays', () => {
    expect(decideAfterSignIn(owner, { id: 'u1', restaurantId: 'r-main', pending: false })).toEqual({
      kind: 'switchBack',
      restaurantId: 'r-haifa',
    });
  });
  it('a different user, or an unknown page owner, reloads home — nothing is replayed', () => {
    expect(decideAfterSignIn(owner, { id: 'u2', restaurantId: 'r-haifa', pending: false })).toEqual({ kind: 'reload' });
    expect(decideAfterSignIn(null, { id: 'u1', restaurantId: 'r-haifa', pending: false })).toEqual({ kind: 'reload' });
  });
  it('signed out still / 2FA pending wait in the sheet', () => {
    expect(decideAfterSignIn(owner, null)).toEqual({ kind: 'stillOut' });
    expect(decideAfterSignIn(owner, { id: 'u1', restaurantId: 'r-haifa', pending: true })).toEqual({ kind: 'twoFactor' });
  });
});

describe('MAJOR 4: the forbidden page never redirect-loops', () => {
  const allowed = ['owner', 'manager'] as const;
  it('DB role allows but the session (JWT) role still forbids → offer a session refresh, never redirect', () => {
    expect(forbiddenOutcome([...allowed], 'manager', 'chef')).toBe('refreshSession');
  });
  it('both allow → safe to go back; neither allows → 403', () => {
    expect(forbiddenOutcome([...allowed], 'manager', 'manager')).toBe('redirect');
    expect(forbiddenOutcome([...allowed], 'chef', 'chef')).toBe('forbidden');
    expect(forbiddenOutcome([...allowed], 'chef', 'manager')).toBe('forbidden');
  });
});

describe('MINOR 7: the 404 up-link is role-aware', () => {
  it('never offers a parent the role cannot open', () => {
    expect(upLinkFor('/dashboard/invoices/x', 'receiver')).toBeNull();
    expect(upLinkFor('/dashboard/invoices/x', 'owner')).toBe('/dashboard/approvals');
    expect(upLinkFor('/dashboard/orders/x', 'manager')).toBe('/dashboard/orders');
    expect(upLinkFor('/dashboard/nope', 'owner')).toBeNull();
  });
});

describe('MINOR 8: fresh server initialData wins on revisit', () => {
  it('a client navigation drops inactive cached queries, so the next page uses its server rows', async () => {
    const qc = createAppQueryClient();
    const key = [['orders', 'list'], { type: 'query' }];
    const first = new QueryObserver(qc, { queryKey: key, queryFn: async () => 'server', initialData: 'status: sent' });
    const unsub = first.subscribe(() => {});
    unsub(); // the user leaves the orders list
    onRouteChange(qc);
    const second = new QueryObserver(qc, { queryKey: key, queryFn: async () => 'server', initialData: 'status: received' });
    expect(second.getCurrentResult().data).toBe('status: received');
  });
});
